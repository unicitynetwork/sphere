/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WalletProvider - Centralized wallet state management
 *
 * CPU OPTIMIZATION: This provider centralizes all wallet-related state,
 * event listeners, and React Query subscriptions that were previously
 * duplicated across 11 useWallet() hook instances.
 *
 * Benefits:
 * - 44 event listeners → 4 (91% reduction)
 * - Single background validation loop instead of 11
 * - Single set of React Query subscriptions
 *
 * @see CPU_PERFORMANCE_ANALYSIS.md
 */

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AggregatedAsset, Token, TokenStatus } from '../components/wallet/L3/data/model';
import { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress';
import { Token as SdkToken } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TransferCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment';
import { ServiceProvider } from '../components/wallet/L3/services/ServiceProvider';
import { waitInclusionProofWithDevBypass } from '../utils/devTools';
import { ApiService } from '../components/wallet/L3/services/api';
import {
  getTokensForAddress,
  getNametagForAddress,
  clearNametagForAddress,
  addToken as addTokenToInventory,
  removeToken as removeTokenFromInventory,
  dispatchWalletUpdated,
  inventorySync,
  saveTokenImmediately,
  removeTokenImmediately,
} from '../components/wallet/L3/services/InventorySyncService';
import { tokenToTxf, getCurrentStateHash } from '../components/wallet/L3/services/TxfSerializer';
import { NametagService } from '../components/wallet/L3/services/NametagService';
import { RegistryService } from '../components/wallet/L3/services/RegistryService';
import { v4 as uuidv4 } from 'uuid';
import { TokenSplitExecutor, type SplitPersistenceCallbacks } from '../components/wallet/L3/services/transfer/TokenSplitExecutor';
import { TokenSplitCalculator } from '../components/wallet/L3/services/transfer/TokenSplitCalculator';
import { IpfsStorageService, SyncPriority } from '../components/wallet/L3/services/IpfsStorageService';
import { useServices } from './useServices';
import type { NostrService } from '../components/wallet/L3/services/NostrService';
import { InventoryBackgroundLoopsManager } from '../components/wallet/L3/services/InventoryBackgroundLoops';
import type { NostrDeliveryQueueEntry } from '../components/wallet/L3/services/types/QueueTypes';
import { TokenRecoveryService } from '../components/wallet/L3/services/TokenRecoveryService';
import { L1_KEYS } from '../components/wallet/L1/hooks/useL1Wallet';
import { isNametagCorrupted } from '../utils/tokenValidation';
import { getTokenValidationService } from '../components/wallet/L3/services/TokenValidationService';
import { OutboxRepository } from '../repositories/OutboxRepository';
import { addSentTransaction } from '../services/TransactionHistoryService';
import { STORAGE_KEY_GENERATORS } from '../config/storageKeys';
import { QUERY_KEYS } from '../config/queryKeys';
import {
  WalletContext,
  type WalletContextValue,
  getInitialSyncTriggered,
  setInitialSyncTriggered,
} from './WalletContextTypes';

// Sync lifecycle event names (type-safe constants)
const SYNC_EVENTS = {
  START: 'inventory-sync-start',
  END: 'inventory-sync-end',
} as const;

const registryService = RegistryService.getInstance();

/**
 * Compute deterministic hash of token list for change detection
 * Used to avoid expensive spent checks when token list hasn't changed.
 * Uses djb2 hash algorithm (fast, good distribution).
 */
function computeTokenListHash(tokens: Token[]): string {
  if (tokens.length === 0) {
    return 'EMPTY';
  }

  const signatures = tokens
    .map(t => {
      let stateHash = '';
      try {
        const parsed = JSON.parse(t.jsonData || '{}');
        stateHash = parsed.state?.stateHash || '';
      } catch {
        // Ignore parse errors
      }
      return `${t.id}|${t.amount}|${t.status}|${t.coinId}|${stateHash}`;
    })
    .sort()
    .join('::');

  let hash = 5381;
  for (let i = 0; i < signatures.length; i++) {
    const char = signatures.charCodeAt(i);
    hash = ((hash << 5) + hash) + char;
  }

  return (hash >>> 0).toString(16);
}

/**
 * WalletProvider - Centralizes wallet state and event handling
 *
 * This provider should be placed inside ServicesProvider in the component tree.
 */
export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const { identityManager, nostrService } = useServices();
  const nametagService = NametagService.getInstance(identityManager);

  // Debounce timer ref for wallet-updated events
  const walletUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const WALLET_UPDATE_DEBOUNCE_MS = 200;

  // Track token list hash to detect actual changes
  const lastTokenHashRef = useRef<string>('');

  // Prevent refetch during active inventory sync
  const skipRefetchDuringSyncRef = useRef<boolean>(false);

  // Track if wallet-updated events were skipped during sync
  const pendingUpdateDuringSyncRef = useRef<boolean>(false);

  // Rate-limit consecutive spent checks - INCREASED from 2s to 10s (Phase 4)
  const lastSpentCheckTimeRef = useRef<number>(0);
  const MIN_SPENT_CHECK_INTERVAL_MS = 10000; // 10 second minimum between checks

  // Validation cooldown - ADDED (Phase 4)
  const VALIDATION_COOLDOWN_MS = 30000; // 30 seconds between validations
  const lastValidationCompleteTimeRef = useRef<number>(0);

  // Track background token validation state
  const [isValidatingTokens, setIsValidatingTokens] = useState(false);
  const isValidatingRef = useRef(false);

  // ============================================================
  // CENTRALIZED EVENT LISTENERS (CPU Optimization)
  // These listeners are now created ONCE instead of 11 times
  // ============================================================

  useEffect(() => {
    const handleWalletUpdate = () => {
      if (skipRefetchDuringSyncRef.current) {
        console.log('⏭️  [WalletContext] Skipping wallet-updated refetch during active inventory sync (marked pending)');
        pendingUpdateDuringSyncRef.current = true;
        return;
      }

      const timeSinceLastCheck = Date.now() - lastSpentCheckTimeRef.current;
      if (timeSinceLastCheck < MIN_SPENT_CHECK_INTERVAL_MS) {
        console.log(
          `⏭️  [WalletContext] Skipping refetch (${timeSinceLastCheck}ms < ${MIN_SPENT_CHECK_INTERVAL_MS}ms minimum)`
        );
        return;
      }

      if (walletUpdateDebounceRef.current) {
        clearTimeout(walletUpdateDebounceRef.current);
      }

      walletUpdateDebounceRef.current = setTimeout(() => {
        walletUpdateDebounceRef.current = null;
        lastSpentCheckTimeRef.current = Date.now();
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.TOKENS });
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.AGGREGATED });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NAMETAG });
      }, WALLET_UPDATE_DEBOUNCE_MS);
    };

    const handleWalletLoaded = () => {
      console.log('📢 [WalletContext] wallet-loaded event received, refreshing queries...');
      lastTokenHashRef.current = '';
      lastSpentCheckTimeRef.current = 0;
      lastValidationCompleteTimeRef.current = 0;

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.IDENTITY });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.NAMETAG });
      queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.TOKENS });
      queryClient.refetchQueries({ queryKey: QUERY_KEYS.AGGREGATED });
    };

    window.addEventListener('wallet-updated', handleWalletUpdate);
    window.addEventListener('wallet-loaded', handleWalletLoaded);
    return () => {
      window.removeEventListener('wallet-updated', handleWalletUpdate);
      window.removeEventListener('wallet-loaded', handleWalletLoaded);
      if (walletUpdateDebounceRef.current) {
        clearTimeout(walletUpdateDebounceRef.current);
      }
    };
  }, [queryClient]);

  // Sync lifecycle event listeners
  useEffect(() => {
    let lockTimeout: ReturnType<typeof setTimeout> | null = null;
    const SYNC_LOCK_TIMEOUT_MS = 60000;

    const handleSyncStart = () => {
      skipRefetchDuringSyncRef.current = true;
      console.log('🔒 [WalletContext] Locking refetch during active inventory sync');

      lockTimeout = setTimeout(() => {
        if (skipRefetchDuringSyncRef.current) {
          console.warn('⚠️ [WalletContext] Sync lock timeout - forcibly unlocking after 60s');
          skipRefetchDuringSyncRef.current = false;
        }
      }, SYNC_LOCK_TIMEOUT_MS);
    };

    const handleSyncEnd = () => {
      skipRefetchDuringSyncRef.current = false;
      if (lockTimeout) {
        clearTimeout(lockTimeout);
        lockTimeout = null;
      }
      console.log('🔓 [WalletContext] Unlocking refetch after inventory sync completes');
      pendingUpdateDuringSyncRef.current = false;
    };

    window.addEventListener(SYNC_EVENTS.START, handleSyncStart);
    window.addEventListener(SYNC_EVENTS.END, handleSyncEnd);

    return () => {
      window.removeEventListener(SYNC_EVENTS.START, handleSyncStart);
      window.removeEventListener(SYNC_EVENTS.END, handleSyncEnd);
      if (lockTimeout) clearTimeout(lockTimeout);
    };
  }, [queryClient]);

  // ============================================================
  // REACT QUERY SUBSCRIPTIONS (Centralized)
  // ============================================================

  const identityQuery = useQuery({
    queryKey: QUERY_KEYS.IDENTITY,
    queryFn: async () => {
      const identity = await identityManager.getCurrentIdentity();
      return identity;
    },
    staleTime: Infinity,
  });

  const nametagQuery = useQuery({
    queryKey: [...QUERY_KEYS.NAMETAG, identityQuery.data?.address],
    queryFn: () => {
      const identity = identityQuery.data;
      if (!identity?.address) return null;

      console.log(`📦 [nametagQuery] Loading nametag for address: ${identity.address.slice(0, 30)}...`);
      const nametagData = getNametagForAddress(identity.address);

      if (isNametagCorrupted(nametagData)) {
        console.warn('🚨 Corrupted nametag detected, clearing from local and IPFS', {
          address: identity.address.slice(0, 20) + '...',
          name: nametagData?.name,
          corruption: 'token is empty or missing required fields',
        });

        try {
          clearNametagForAddress(identity.address);
          const storageService = IpfsStorageService.getInstance(identityManager);
          storageService.clearCorruptedNametagAndSync().catch((err) => {
            console.error('Background IPFS nametag clear failed:', err);
          });
          console.log('✅ Initiated nametag clear from local and IPFS');
        } catch (error) {
          console.error('Failed to clear corrupted nametag:', error);
        }

        return null;
      }

      return nametagData?.name || null;
    },
    enabled: !!identityQuery.data?.address,
    staleTime: Infinity,
  });

  // Initialize inventory sync when identity is available (ONCE per page load)
  const identityAddress = identityQuery.data?.address;
  const identityPublicKey = identityQuery.data?.publicKey;
  const identityIpnsName = identityQuery.data?.ipnsName;

  useEffect(() => {
    if (!getInitialSyncTriggered()) {
      console.log('🔍 [WalletContext] Checking sync preconditions:', {
        hasAddress: !!identityAddress,
        hasPublicKey: !!identityPublicKey,
        hasIpnsName: !!identityIpnsName,
        ipnsName: identityIpnsName?.slice(0, 20),
        flagState: getInitialSyncTriggered()
      });
    }

    if (identityAddress && identityPublicKey && identityIpnsName && !getInitialSyncTriggered()) {
      setInitialSyncTriggered(true);
      console.log('🔄 [WalletContext] Triggering initial inventory sync (once per page load)');
      inventorySync({
        address: identityAddress,
        publicKey: identityPublicKey,
        ipnsName: identityIpnsName,
      }).catch(err => {
        console.error('❌ [WalletContext] Initial inventory sync failed:', err);
      });
    }
  }, [identityAddress, identityPublicKey, identityIpnsName]);

  // Load cached token hash from localStorage
  useEffect(() => {
    const address = identityQuery.data?.address;
    if (address) {
      const cachedHash = localStorage.getItem(STORAGE_KEY_GENERATORS.tokenListHash(address));
      if (cachedHash && cachedHash !== lastTokenHashRef.current) {
        lastTokenHashRef.current = cachedHash;
        console.log(`📦 [WalletContext] Loaded cached token hash for address: ${cachedHash}`);
      }
    }
  }, [identityQuery.data?.address]);

  // IPNS WebSocket updates listener
  useEffect(() => {
    let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const SYNC_DEBOUNCE_MS = 500;

    const handleIpnsRemoteUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      console.log(`[IPNS-WS] Remote update detected: seq=${detail?.sequence}, triggering sync...`);

      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
      }

      syncDebounceTimer = setTimeout(() => {
        const identity = identityQuery.data;
        if (identity?.address && identity?.publicKey && identity?.ipnsName) {
          console.log('[IPNS-WS] Triggering inventory sync from WebSocket update');
          inventorySync({
            address: identity.address,
            publicKey: identity.publicKey,
            ipnsName: identity.ipnsName,
          }).catch(err => {
            console.error('[IPNS-WS] Inventory sync failed:', err);
          });
        }
      }, SYNC_DEBOUNCE_MS);
    };

    window.addEventListener('ipns-remote-update', handleIpnsRemoteUpdate);

    return () => {
      window.removeEventListener('ipns-remote-update', handleIpnsRemoteUpdate);
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    };
  }, [identityQuery.data]);

  const registryQuery = useQuery({
    queryKey: QUERY_KEYS.REGISTRY,
    queryFn: async () => {
      await registryService.ensureInitialized();
      return true;
    },
    staleTime: Infinity,
  });

  // PRICE QUERY - Phase 3b: Reduced polling from 60s to 5min, staleTime from 30s to 2min
  const pricesQuery = useQuery({
    queryKey: QUERY_KEYS.PRICES,
    queryFn: ApiService.fetchPrices,
    refetchInterval: 5 * 60 * 1000, // 5 minutes (was 60000)
    staleTime: 2 * 60 * 1000, // 2 minutes (was 30000)
    refetchOnMount: false, // Added: prevent mount refetch storms
  });

  const tokensQuery = useQuery({
    queryKey: [...QUERY_KEYS.TOKENS, identityQuery.data?.address],
    queryFn: async () => {
      const identity = identityQuery.data;
      if (!identity?.address) return [];

      console.log(`📦 [tokensQuery] QUERY FN INVOKED for address: ${identity.address.slice(0, 30)}...`);
      let tokens = getTokensForAddress(identity.address);
      console.log(`📦 [tokensQuery] Got ${tokens.length} tokens from localStorage`);

      const outboxRepo = OutboxRepository.getInstance();
      const pendingEntries = outboxRepo.getPendingEntries();
      if (pendingEntries.length > 0) {
        const pendingTokenIds = new Set(pendingEntries.map(e => e.sourceTokenId));
        const tokensInTransit = tokens.filter(t => pendingTokenIds.has(t.id));

        if (tokensInTransit.length > 0) {
          console.log(`📦 Found ${tokensInTransit.length} token(s) with pending outbox entries (in transit)`);
          tokens = tokens.filter(t => !pendingTokenIds.has(t.id));
        }
      }

      console.log(`📦 [tokensQuery] Returning ${tokens.length} tokens after filtering`);
      return tokens;
    },
    enabled: !!identityQuery.data?.address,
    staleTime: Infinity,
  });

  // ============================================================
  // BACKGROUND VALIDATION (Single instance instead of 11)
  // ============================================================

  useEffect(() => {
    const identity = identityQuery.data;
    const tokens = tokensQuery.data;

    if (!identity?.address || !identity?.publicKey || !tokens || tokens.length === 0 || isValidatingRef.current) {
      return;
    }

    // Phase 4: Validation cooldown check
    const timeSinceLastValidation = Date.now() - lastValidationCompleteTimeRef.current;
    if (timeSinceLastValidation < VALIDATION_COOLDOWN_MS && lastValidationCompleteTimeRef.current > 0) {
      console.log(`⏭️ [backgroundValidation] Cooldown active (${timeSinceLastValidation}ms < ${VALIDATION_COOLDOWN_MS}ms)`);
      return;
    }

    const currentTokenHash = computeTokenListHash(tokens);
    const tokenListUnchanged = currentTokenHash === lastTokenHashRef.current;

    if (tokenListUnchanged) {
      return;
    }

    isValidatingRef.current = true;
    setIsValidatingTokens(true);

    const runBackgroundValidation = async () => {
      console.log(`🔄 [backgroundValidation] Running spent check for ${tokens.length} token(s) in background...`);

      try {
        const validationService = getTokenValidationService();
        validationService.clearUnspentCacheEntries();

        const spentCheck = await validationService.checkSpentTokens(
          tokens,
          identity.publicKey,
          { batchSize: 10 }
        );

        console.log(`🔄 [backgroundValidation] Spent check complete: ${spentCheck.spentTokens.length} spent, ${tokens.length - spentCheck.spentTokens.length} valid`);

        if (spentCheck.spentTokens.length > 0) {
          console.warn(`⚠️ [backgroundValidation] Found ${spentCheck.spentTokens.length} spent token(s)`);

          for (const spent of spentCheck.spentTokens) {
            console.log(`  💀 Removing spent token: ${spent.tokenId.slice(0, 16)}...`);

            if (identity.ipnsName) {
              await removeTokenFromInventory(
                identity.address,
                identity.publicKey,
                identity.ipnsName,
                spent.tokenId,
                spent.stateHash
              ).catch(err => {
                console.error(`Failed to remove spent token ${spent.tokenId.slice(0, 8)}:`, err);
              });
            }
          }

          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TOKENS });
        }

        lastTokenHashRef.current = currentTokenHash;
        localStorage.setItem(STORAGE_KEY_GENERATORS.tokenListHash(identity.address), currentTokenHash);
        lastValidationCompleteTimeRef.current = Date.now(); // Phase 4: Update cooldown

      } catch (err) {
        console.warn('🔄 [backgroundValidation] Failed to check spent tokens:', err);
      } finally {
        isValidatingRef.current = false;
        setIsValidatingTokens(false);
      }
    };

    runBackgroundValidation();
  }, [identityQuery.data, tokensQuery.data, queryClient]);

  const aggregatedAssetsQuery = useQuery({
    queryKey: [
      ...QUERY_KEYS.AGGREGATED,
      tokensQuery.dataUpdatedAt,
    ],
    queryFn: async () => {
      await registryService.ensureInitialized();

      const tokens = tokensQuery.data || [];
      const prices = pricesQuery.data || {};
      const groupedTokens: Record<string, Token[]> = {};

      tokens.forEach((token) => {
        if (
          token.status === TokenStatus.BURNED ||
          token.status === TokenStatus.TRANSFERRED
        ) {
          return;
        }

        const key = token.coinId || token.id;
        if (!groupedTokens[key]) groupedTokens[key] = [];
        groupedTokens[key].push(token);
      });

      const assets: AggregatedAsset[] = Object.keys(groupedTokens).map(
        (key) => {
          const group = groupedTokens[key];
          const firstToken = group[0];

          const def = registryService.getCoinDefinition(key);

          let totalAmount = BigInt(0);
          group.forEach((t) => {
            if (t.amount) totalAmount += BigInt(t.amount);
          });

          const symbol = def?.symbol || firstToken.symbol || 'UNK';
          const name = def?.name || firstToken.name || 'Unknown Token';
          const priceKey =
            symbol.toLowerCase() === 'btc'
              ? 'bitcoin'
              : symbol.toLowerCase() === 'eth'
              ? 'ethereum'
              : symbol.toLowerCase() === 'sol'
              ? 'solana'
              : 'tether';

          const decimals = def?.decimals || 0;

          const priceData = priceKey ? prices[priceKey] : null;
          const iconUrl = def
            ? registryService.getIconUrl(def)
            : firstToken.iconUrl;

          return new AggregatedAsset({
            coinId: key,
            symbol: symbol,
            name: name,
            totalAmount: totalAmount.toString(),
            decimals: decimals,
            tokenCount: group.length,
            iconUrl: iconUrl,
            priceUsd: priceData?.priceUsd || 0,
            priceEur: priceData?.priceEur || 0,
            change24h: priceData?.change24h || 0,
          });
        }
      );

      return assets.sort((a, b) => {
        const valA = a.priceUsd * a.getAmountAsDecimal();
        const valB = b.priceUsd * b.getAmountAsDecimal();
        return valB - valA;
      });
    },
    enabled: !!registryQuery.data && !!tokensQuery.data && !!pricesQuery.data,
  });

  // ============================================================
  // MUTATIONS
  // ============================================================

  const createWalletMutation = useMutation({
    mutationFn: async () => {
      const identity = await identityManager.generateNewIdentity();
      return identity;
    },
    onSuccess: async () => {
      await queryClient.removeQueries({ queryKey: QUERY_KEYS.IDENTITY });
      await queryClient.removeQueries({ queryKey: QUERY_KEYS.TOKENS });
      await queryClient.removeQueries({ queryKey: QUERY_KEYS.NAMETAG });
      await queryClient.removeQueries({ queryKey: QUERY_KEYS.AGGREGATED });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.IDENTITY });
    },
  });

  const restoreWalletMutation = useMutation({
    mutationFn: async (mnemonic: string) => {
      const identity = await identityManager.deriveIdentityFromMnemonic(mnemonic);
      return identity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  const mintNametagMutation = useMutation({
    mutationFn: async (nametag: string) => {
      const result = await nametagService.mintNametagAndPublish(nametag);

      if (result.status === 'error') {
        throw new Error(result.message);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  const sendTokenMutation = useMutation({
    mutationFn: async (params: { recipientNametag: string; token: Token }) => {
      const { recipientNametag, token } = params;
      console.log(
        `Starting transfer of ${token.symbol} to ${recipientNametag}`
      );

      const identity = await identityManager.getCurrentIdentity();
      if (!identity) throw new Error('Wallet locked or missing');

      const secret = Buffer.from(identity.privateKey, 'hex');

      const recipientPubkey = await nostrService.queryPubkeyByNametag(
        recipientNametag
      );
      if (!recipientPubkey)
        throw new Error(`Recipient ${recipientNametag} not found on Nostr`);

      const recipientProxyAddress = await ProxyAddress.fromNameTag(
        recipientNametag
      );

      if (!token.jsonData) throw new Error('Token data missing');
      const sourceToken = await SdkToken.fromJSON(token.jsonData);

      const signingService = await SigningService.createFromSecret(secret);
      const salt = window.crypto.getRandomValues(Buffer.alloc(32));

      const transferCommitment = await TransferCommitment.create(
        sourceToken,
        recipientProxyAddress,
        salt,
        null,
        null,
        signingService
      );

      console.log(`🔑 [Transfer] RequestId committed: ${transferCommitment.requestId.toString()}`);
      console.log(`   - sourceToken stateHash: ${(await sourceToken.state.calculateHash()).toJSON()}`);
      console.log(`   - signingService.publicKey: ${Buffer.from(signingService.publicKey).toString('hex')}`);

      const client = ServiceProvider.stateTransitionClient;
      const response = await client.submitTransferCommitment(
        transferCommitment
      );

      if (response.status !== 'SUCCESS') {
        throw new Error(`Transfer failed: ${response.status}`);
      }

      const inclusionProof = await waitInclusionProofWithDevBypass(
        transferCommitment
      );

      const transferTx = transferCommitment.toTransaction(inclusionProof);

      const payload = JSON.stringify({
        sourceToken: sourceToken.toJSON(),
        transferTx: transferTx.toJSON(),
      });

      const sent = await nostrService.sendTokenTransfer(
        recipientPubkey,
        payload
      );

      if (!sent) throw new Error('Failed to send p2p message via Nostr');

      const txf = tokenToTxf(token);
      if (!txf) {
        console.warn('Cannot convert token to TXF for inventory removal');
      } else {
        const stateHash = getCurrentStateHash(txf) ?? '';
        if (stateHash && identity.publicKey && identity.ipnsName) {
          await removeTokenFromInventory(
            identity.address,
            identity.publicKey,
            identity.ipnsName,
            token.id,
            stateHash
          );
        }
      }

      return true;
    },
  });

  const sendAmountMutation = useMutation({
    mutationFn: async (params: {
      recipientNametag: string;
      amount: string;
      coinId: string;
      eventId?: string;
    }) => {
      const targetAmount = BigInt(params.amount);
      const { recipientNametag } = params;

      console.log(
        `🚀 Starting SMART SEND: ${params.amount} of ${params.coinId} to ${recipientNametag}`
      );

      const identity = await identityManager.getCurrentIdentity();
      if (!identity) throw new Error('Wallet locked');

      const secret = Buffer.from(identity.privateKey, 'hex');
      const signingService = await SigningService.createFromSecret(secret);

      const recipientPubkey = await nostrService.queryPubkeyByNametag(
        recipientNametag
      );
      if (!recipientPubkey)
        throw new Error(`Recipient @${recipientNametag} not found on Nostr`);

      const recipientAddress = await ProxyAddress.fromNameTag(recipientNametag);

      const calculator = new TokenSplitCalculator();
      const allTokens = getTokensForAddress(identity.address);

      const plan = await calculator.calculateOptimalSplit(
        allTokens,
        targetAmount,
        params.coinId
      );

      if (!plan)
        throw new Error('Insufficient funds or no suitable tokens found');

      console.log('📋 Transfer Plan:', {
        direct: plan.tokensToTransferDirectly.length,
        split: plan.requiresSplit ? 'YES' : 'NO',
        splitAmount: plan.splitAmount?.toString(),
        remainder: plan.remainderAmount?.toString(),
      });

      for (const item of plan.tokensToTransferDirectly) {
        console.log(`➡️ Sending whole token ${item.uiToken.id.slice(0, 8)}...`);
        await executeDirectTransfer(
          item.sdkToken,
          item.uiToken.id,
          recipientAddress,
          recipientPubkey,
          signingService,
          nostrService,
          recipientNametag
        );
      }

      if (plan.requiresSplit) {
        console.log('✂️ Executing split...');

        const { OutboxRepository } = await import('../repositories/OutboxRepository');
        const outboxRepo = OutboxRepository.getInstance();

        const walletAddress = identity.address;
        outboxRepo.setCurrentAddress(walletAddress);

        const outboxContext = {
          walletAddress,
          recipientNametag,
          recipientPubkey,
          ownerPublicKey: identity.publicKey,
        };

        const executor = new TokenSplitExecutor();

        const ipfsService = IpfsStorageService.getInstance(identityManager);
        const persistenceCallbacks: SplitPersistenceCallbacks = {
          onTokenMinted: async (
            sdkToken: SdkToken<any>,
            isChangeToken: boolean,
            options?: { skipSync?: boolean }
          ) => {
            if (isChangeToken && identity.ipnsName) {
              if (options?.skipSync) {
                const uiToken = await createUiTokenFromSdk(sdkToken, params.coinId);
                saveTokenImmediately(identity.address, uiToken);
                // CRITICAL: Even in skipSync mode, we must update the UI to show the change token
                // The IPFS sync is deferred but the UI should reflect the new token immediately
                dispatchWalletUpdated();
                console.log(`🔒 Change token saved (sync deferred, UI updated)`);
              } else {
                await saveChangeTokenToWallet(sdkToken, params.coinId, {
                  address: identity.address,
                  publicKey: identity.publicKey,
                  ipnsName: identity.ipnsName,
                });
                dispatchWalletUpdated();
                console.log(`🔒 Change token saved with sync dispatch`);
              }
            }
          },
          onPreTransferSync: async () => {
            try {
              if (!identity.ipnsName) {
                console.error(`❌ Pre-transfer sync: No IPNS name available`);
                return false;
              }

              const result = await inventorySync({
                address: identity.address,
                publicKey: identity.publicKey,
                ipnsName: identity.ipnsName,
                skipExtendedVerification: true,
              });

              if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
                console.log(`☁️ Pre-transfer IPFS sync completed (tokens backed up)`);
                return true;
              }

              console.error(`❌ Pre-transfer IPFS sync failed: ${result.errorMessage}`);
              return false;
            } catch (err) {
              console.error(`❌ Pre-transfer IPFS sync error:`, err);
              return false;
            }
          },
        };

        const splitResult = await executor.executeSplitPlan(
          plan,
          recipientAddress,
          signingService,
          async (burnedId) => {
            // INSTANT mode: Remove burned token immediately from localStorage
            // This avoids triggering a full inventory sync during the split operation
            console.log(`🔥 [BURN CALLBACK] Looking for token with id=${burnedId.slice(0, 8)}... in ${allTokens.length} tokens`);
            const burnedToken = allTokens.find(t => t.id === burnedId);
            if (burnedToken) {
              console.log(`🔥 [BURN CALLBACK] Found token: ${burnedToken.id.slice(0, 8)}...`);
              const txf = tokenToTxf(burnedToken);
              if (!txf) {
                console.warn(`Cannot convert burned token ${burnedId.slice(0, 8)} to TXF`);
              } else {
                const stateHash = getCurrentStateHash(txf) ?? '';
                const sdkTokenId = txf.genesis?.data?.tokenId;
                if (stateHash && sdkTokenId) {
                  // Use immediate removal for INSTANT mode - no full sync
                  const removed = removeTokenImmediately(identity.address, sdkTokenId, stateHash);
                  if (removed) {
                    console.log(`🔥 Burned token ${sdkTokenId.slice(0, 8)}... removed immediately`);
                    // Update UI to show the source token is being processed
                    dispatchWalletUpdated();
                  } else {
                    console.warn(`🔥 Failed to remove burned token ${sdkTokenId.slice(0, 8)}... from localStorage`);
                  }
                } else {
                  console.warn(`🔥 [BURN CALLBACK] Missing stateHash=${!!stateHash} or sdkTokenId=${!!sdkTokenId}`);
                }
              }
            } else {
              console.warn(`🔥 [BURN CALLBACK] Token NOT FOUND! burnedId=${burnedId}`);
              console.warn(`🔥 [BURN CALLBACK] Available IDs (first 5): ${allTokens.slice(0, 5).map(t => t.id.slice(0, 8)).join(', ')}`);
            }
          },
          outboxContext,
          persistenceCallbacks,
          { instant: true } // INSTANT_SPLIT_LITE: Skip waiting for transfer proof before Nostr delivery
        );

        if (plan.splitAmount) {
          const def = registryService.getCoinDefinition(params.coinId);
          const iconUrl = def ? registryService.getIconUrl(def) || undefined : undefined;
          addSentTransaction(
            plan.splitAmount.toString(),
            params.coinId,
            def?.symbol || 'UNK',
            iconUrl,
            recipientNametag
          );
        }

        // INSTANT mode: Nostr delivery was already done inside executeSplitPlan
        // Skip redundant delivery loop to avoid tx.toJSON() errors on placeholder objects
        if (!splitResult.nostrDelivered) {
          let deliveryQueue: ReturnType<typeof InventoryBackgroundLoopsManager.prototype.getDeliveryQueue> | null = null;
          try {
            const loopsManager = InventoryBackgroundLoopsManager.getInstance();
            if (loopsManager.isReady()) {
              deliveryQueue = loopsManager.getDeliveryQueue();
            }
          } catch {
            // Loops manager not initialized
          }

          for (let i = 0; i < splitResult.tokensForRecipient.length; i++) {
            const token = splitResult.tokensForRecipient[i];
            const tx = splitResult.recipientTransferTxs[i];
            const outboxEntryId = splitResult.outboxEntryIds[i];

            const sourceTokenString = JSON.stringify(token.toJSON());
            const transferTxString = JSON.stringify(tx.toJSON());

            const stateHashResult = await token.state.calculateHash();
            const stateHash = stateHashResult.toString();

            const payload = JSON.stringify({
              sourceToken: sourceTokenString,
              transferTx: transferTxString,
              tokenId: token.id.toString(),
              stateHash,
            });

            if (deliveryQueue) {
              const queueEntry: NostrDeliveryQueueEntry = {
                id: crypto.randomUUID(),
                outboxEntryId: outboxEntryId || '',
                recipientPubkey,
                recipientNametag,
                payloadJson: payload,
                retryCount: 0,
                createdAt: Date.now(),
              };

              await deliveryQueue.queueForDelivery(queueEntry);
              console.log(`📨 Queued split token for Nostr delivery (queue ID: ${queueEntry.id.slice(0, 8)})`);

              if (outboxEntryId) {
                console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... queued for delivery`);
              }
            } else {
              console.log('📨 Sending split token via Nostr (direct)...');
              await nostrService.sendTokenTransfer(recipientPubkey, payload, undefined, undefined, params.eventId);

              if (outboxEntryId) {
                outboxRepo.updateStatus(outboxEntryId, 'NOSTR_SENT');
                outboxRepo.updateStatus(outboxEntryId, 'COMPLETED');
                console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... sent via Nostr (direct)`);
              }
            }
          }
        } else {
          console.log('⚡ INSTANT mode: Nostr delivery already completed in executor, skipping redundant delivery');
        }

        if (splitResult.splitGroupId) {
          outboxRepo.removeSplitGroup(splitResult.splitGroupId);
        }

        // INSTANT mode: Fire-and-forget IPFS sync (don't block the user)
        // Standard mode: Await the sync for consistency
        if (splitResult.nostrDelivered) {
          console.log('⚡ INSTANT mode: Starting background IPFS sync (fire-and-forget)');
          ipfsService.syncNow({
            priority: SyncPriority.MEDIUM,
            callerContext: 'post-split-sync',
          }).catch(err => {
            console.warn('⚠️ Background IPFS sync after split failed:', err);
          });
        } else {
          await ipfsService.syncNow({
            priority: SyncPriority.MEDIUM,
            callerContext: 'post-split-sync',
          }).catch(err => {
            console.warn('⚠️ Final IPFS sync after split failed:', err);
          });
        }
      }

      return true;
    },
  });

  /**
   * INSTANT_SEND: Execute transfer with Nostr-first delivery
   *
   * Critical path (2-3s): commitment → outbox → Nostr delivery
   * Background lanes (fire-and-forget): aggregator, IPFS sync
   *
   * Per TOKEN_INVENTORY_SPEC.md v3.5 Section 13
   */
  const executeInstantSend = async (
    sourceToken: SdkToken<any>,
    uiId: string,
    recipientAddress: ProxyAddress,
    recipientPubkey: string,
    signingService: SigningService,
    recipientNametag: string
  ): Promise<string> => {
    const { OutboxRepository } = await import('../repositories/OutboxRepository');
    const { createOutboxEntry } = await import('../components/wallet/L3/services/types/OutboxTypes');
    const { getPaymentSessionManager } = await import('../components/wallet/L3/services/PaymentSessionManager');
    const outboxRepo = OutboxRepository.getInstance();
    const sessionManager = getPaymentSessionManager();

    const startTime = performance.now();

    const identity = await identityManager.getCurrentIdentity();
    if (!identity) throw new Error('Wallet locked');

    outboxRepo.setCurrentAddress(identity.address);

    // Phase A: Create commitment (synchronous crypto, ~10ms)
    console.log(`⚡ [INSTANT_SEND] Phase A: Creating commitment...`);
    const salt = Buffer.alloc(32);
    window.crypto.getRandomValues(salt);

    const transferCommitment = await TransferCommitment.create(
      sourceToken,
      recipientAddress,
      salt,
      null,
      null,
      signingService
    );

    let amount = '0';
    let coinId = '';
    const coinsOpt = sourceToken.coins;
    if (coinsOpt) {
      const rawCoins = coinsOpt.coins;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        coinId = firstItem[0]?.toString() || '';
        const val = firstItem[1];
        if (Array.isArray(val)) {
          amount = val[1]?.toString() || '0';
        } else if (val) {
          amount = val.toString();
        }
      }
    }

    // Phase B: Persist to outbox (localStorage, ~1ms)
    console.log(`⚡ [INSTANT_SEND] Phase B: Saving to outbox...`);
    const outboxEntry = createOutboxEntry(
      'DIRECT_TRANSFER',
      uiId,
      recipientNametag,
      recipientPubkey,
      JSON.stringify((recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress),
      amount,
      coinId,
      Buffer.from(salt).toString('hex'),
      JSON.stringify(sourceToken.toJSON()),
      JSON.stringify(transferCommitment.toJSON())
    );

    outboxRepo.addEntry(outboxEntry);
    outboxRepo.updateEntry(outboxEntry.id, { status: 'READY_TO_SEND' });

    // Phase C: Create payment session
    console.log(`⚡ [INSTANT_SEND] Phase C: Creating payment session...`);
    const session = sessionManager.createSession({
      direction: 'SEND',
      sourceTokenId: uiId,
      recipientNametag,
      recipientPubkey,
      amount,
      coinId,
      salt: Buffer.from(salt).toString('hex'),
    });

    sessionManager.advancePhase(session.id, 'COMMITMENT_CREATED', {
      commitmentJson: JSON.stringify(transferCommitment.toJSON()),
      outboxEntryId: outboxEntry.id,
    });

    // Phase D: Build Nostr payload (commitment data for recipient to submit)
    console.log(`⚡ [INSTANT_SEND] Phase D: Building Nostr payload...`);

    // Calculate state hash for tracking
    const stateHashResult = await sourceToken.state.calculateHash();
    const stateHash = stateHashResult.toString();

    const payload = JSON.stringify({
      sourceToken: JSON.stringify(sourceToken.toJSON()),
      // transferTx is required for receiver to finalize the transfer
      transferTx: JSON.stringify(transferCommitment.toJSON()),
      // Also include as commitmentData for backward compatibility (recipient can submit if needed)
      commitmentData: JSON.stringify(transferCommitment.toJSON()),
      tokenId: sourceToken.id.toString(),
      stateHash,
    });

    // Phase E: Queue for Nostr delivery
    console.log(`⚡ [INSTANT_SEND] Phase E: Queueing for Nostr delivery...`);
    let deliveryQueue: ReturnType<typeof InventoryBackgroundLoopsManager.prototype.getDeliveryQueue> | null = null;
    try {
      const loopsManager = InventoryBackgroundLoopsManager.getInstance();
      if (loopsManager.isReady()) {
        deliveryQueue = loopsManager.getDeliveryQueue();
      }
    } catch {
      // Loops manager not initialized
    }

    if (!deliveryQueue) {
      // Fallback: Direct Nostr send (not using queue)
      console.log(`⚡ [INSTANT_SEND] Using direct Nostr send (queue not available)...`);
      const sent = await nostrService.sendTokenTransfer(recipientPubkey, payload);
      if (!sent) {
        sessionManager.markFailed(
          session.id,
          'NOSTR_DELIVERY_FAILED',
          'Failed to send via Nostr (direct)',
          false
        );
        throw new Error('Failed to send via Nostr');
      }
      sessionManager.advancePhase(session.id, 'NOSTR_DELIVERED');
    } else {
      // Use delivery queue for better error handling
      const queueEntryId = crypto.randomUUID();
      await deliveryQueue.queueForDelivery({
        id: queueEntryId,
        outboxEntryId: outboxEntry.id,
        recipientPubkey,
        recipientNametag,
        payloadJson: payload,
        retryCount: 0,
        createdAt: Date.now(),
        paymentSessionId: session.id,
        commitmentJson: JSON.stringify(transferCommitment.toJSON()),
      });

      // Phase F: Wait for Nostr confirmation (critical path, 1-2s)
      console.log(`⚡ [INSTANT_SEND] Phase F: Waiting for Nostr confirmation...`);
      // Note: If Nostr delivery fails, error propagates up - payment session already marked failed by queue
      const nostrEventId = await deliveryQueue.waitForDelivery(queueEntryId, 30000);
      outboxRepo.updateEntry(outboxEntry.id, {
        status: 'NOSTR_SENT',
        nostrEventId,
      });
      console.log(`⚡ [INSTANT_SEND] Nostr delivery confirmed: ${nostrEventId.slice(0, 8)}...`);
    }

    // Phase G: Launch background lanes (fire-and-forget)
    console.log(`⚡ [INSTANT_SEND] Phase G: Launching background lanes...`);

    // Background IPFS sync (non-blocking)
    if (identity.ipnsName) {
      inventorySync({
        address: identity.address,
        publicKey: identity.publicKey,
        ipnsName: identity.ipnsName,
        skipExtendedVerification: true,
      }).then(result => {
        if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
          sessionManager.updateBackgroundStatus(session.id, undefined, 'SYNCED');
          console.log(`⚡ [INSTANT_SEND] Background IPFS sync completed`);
        } else {
          sessionManager.updateBackgroundStatus(session.id, undefined, 'FAILED');
          console.warn(`⚡ [INSTANT_SEND] Background IPFS sync failed: ${result.errorMessage}`);
        }
      }).catch(err => {
        sessionManager.updateBackgroundStatus(session.id, undefined, 'FAILED');
        console.warn(`⚡ [INSTANT_SEND] Background IPFS sync error:`, err);
      });
    }

    // Background token removal (non-blocking)
    const allTokens = getTokensForAddress(identity.address);
    const tokenToRemove = allTokens.find(t => t.id === uiId);
    if (tokenToRemove && identity.publicKey && identity.ipnsName) {
      const txf = tokenToTxf(tokenToRemove);
      if (txf) {
        const tokenStateHash = getCurrentStateHash(txf) ?? '';
        removeTokenFromInventory(
          identity.address,
          identity.publicKey,
          identity.ipnsName,
          uiId,
          tokenStateHash
        ).then(() => {
          console.log(`⚡ [INSTANT_SEND] Background token removal completed`);
        }).catch(err => {
          console.warn(`⚡ [INSTANT_SEND] Background token removal failed:`, err);
        });
      }
    }

    // Mark outbox entry as completed (background lanes don't affect this)
    outboxRepo.updateEntry(outboxEntry.id, { status: 'COMPLETED' });

    const criticalPathMs = performance.now() - startTime;
    console.log(`⚡ [INSTANT_SEND] Critical path completed in ${criticalPathMs.toFixed(0)}ms`);

    // Mark session as completed
    sessionManager.advancePhase(session.id, 'COMPLETED');

    return session.id;
  };

  /**
   * Execute direct token transfer
   *
   * Supports two modes:
   * - Standard (instant=false): Full blocking flow with proof before Nostr
   * - INSTANT_SEND (instant=true, DEFAULT): Nostr-first, background aggregator/IPFS
   *
   * @param sourceToken - SDK token to transfer
   * @param uiId - UI token ID
   * @param recipientAddress - Recipient's proxy address
   * @param recipientPubkey - Recipient's Nostr pubkey
   * @param signingService - Signing service for commitment
   * @param nostr - Nostr service instance
   * @param recipientNametag - Recipient's human-readable nametag
   * @param options - Transfer options (instant mode, etc.)
   */
  const executeDirectTransfer = async (
    sourceToken: SdkToken<any>,
    uiId: string,
    recipientAddress: ProxyAddress,
    recipientPubkey: string,
    signingService: SigningService,
    nostr: NostrService,
    recipientNametag: string,
    options?: { instant?: boolean }
  ) => {
    const instant = options?.instant ?? true;  // DEFAULT: instant mode enabled

    if (instant) {
      return executeInstantSend(
        sourceToken,
        uiId,
        recipientAddress,
        recipientPubkey,
        signingService,
        recipientNametag
      );
    }

    // Standard (legacy) blocking flow below
    const { OutboxRepository } = await import('../repositories/OutboxRepository');
    const { createOutboxEntry } = await import('../components/wallet/L3/services/types/OutboxTypes');
    const outboxRepo = OutboxRepository.getInstance();

    const identity = await identityManager.getCurrentIdentity();
    if (!identity) throw new Error('Wallet locked');

    outboxRepo.setCurrentAddress(identity.address);

    const salt = Buffer.alloc(32);
    window.crypto.getRandomValues(salt);

    const transferCommitment = await TransferCommitment.create(
      sourceToken,
      recipientAddress,
      salt,
      null,
      null,
      signingService
    );

    let amount = '0';
    let coinId = '';
    const coinsOpt = sourceToken.coins;
    if (coinsOpt) {
      const rawCoins = coinsOpt.coins;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        coinId = firstItem[0]?.toString() || '';
        const val = firstItem[1];
        if (Array.isArray(val)) {
          amount = val[1]?.toString() || '0';
        } else if (val) {
          amount = val.toString();
        }
      }
    }

    const outboxEntry = createOutboxEntry(
      'DIRECT_TRANSFER',
      uiId,
      recipientNametag,
      recipientPubkey,
      JSON.stringify((recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress),
      amount,
      coinId,
      Buffer.from(salt).toString('hex'),
      JSON.stringify(sourceToken.toJSON()),
      JSON.stringify(transferCommitment.toJSON())
    );

    outboxRepo.addEntry(outboxEntry);
    console.log(`📤 Outbox: Created entry ${outboxEntry.id.slice(0, 8)}... for direct transfer`);

    const isIpfsEnabled = import.meta.env.VITE_ENABLE_IPFS !== 'false';
    if (isIpfsEnabled) {
      try {
        if (!identity.ipnsName) {
          outboxRepo.removeEntry(outboxEntry.id);
          throw new Error(`Failed to sync outbox to IPFS - no IPNS name available`);
        }

        const syncResult = await inventorySync({
          address: identity.address,
          publicKey: identity.publicKey,
          ipnsName: identity.ipnsName,
          skipExtendedVerification: true,
        });

        if (syncResult.status !== 'SUCCESS' && syncResult.status !== 'PARTIAL_SUCCESS') {
          outboxRepo.removeEntry(outboxEntry.id);
          throw new Error(`Failed to sync outbox to IPFS - aborting transfer: ${syncResult.errorMessage}`);
        }

        console.log(`📤 Outbox entry synced to IPFS: ${syncResult.lastCid?.slice(0, 12)}...`);
      } catch (err) {
        outboxRepo.removeEntry(outboxEntry.id);
        throw err;
      }
    } else {
      console.log(`📤 IPFS disabled - skipping outbox sync`);
    }

    outboxRepo.updateEntry(outboxEntry.id, { status: 'READY_TO_SUBMIT' });

    const client = ServiceProvider.stateTransitionClient;
    const res = await client.submitTransferCommitment(transferCommitment);

    if (res.status !== 'SUCCESS' && res.status !== 'REQUEST_ID_EXISTS') {
      try {
        const allTokens = getTokensForAddress(identity.address);
        const uiToken = allTokens.find(t => t.id === uiId);
        if (uiToken && identity?.publicKey) {
          const recoveryService = TokenRecoveryService.getInstance();
          const recovery = await recoveryService.handleTransferFailure(
            uiToken,
            res.status,
            identity.publicKey
          );
          console.log(`📤 Transfer failed: ${res.status}, recovery: ${recovery.action}`);

          if (recovery.tokenRestored || recovery.tokenRemoved) {
            dispatchWalletUpdated();
          }
        }
      } catch (recoveryErr) {
        console.error(`📤 Token recovery failed:`, recoveryErr);
      }

      outboxRepo.updateEntry(outboxEntry.id, {
        status: 'FAILED',
        lastError: `Aggregator error: ${res.status}`,
      });
      throw new Error(`Direct transfer failed: ${res.status}`);
    }

    outboxRepo.updateEntry(outboxEntry.id, { status: 'SUBMITTED' });
    console.log(`📤 Transfer submitted to aggregator (status: ${res.status})`);

    const proof = await waitInclusionProofWithDevBypass(
      transferCommitment
    );

    const tx = transferCommitment.toTransaction(proof);

    outboxRepo.updateEntry(outboxEntry.id, {
      status: 'PROOF_RECEIVED',
      inclusionProofJson: JSON.stringify(proof.toJSON()),
      transferTxJson: JSON.stringify(tx.toJSON()),
    });
    console.log(`📤 Inclusion proof received`);

    const sourceTokenString = JSON.stringify(sourceToken.toJSON());
    const transferTxString = JSON.stringify(tx.toJSON());

    const payload = JSON.stringify({
      sourceToken: sourceTokenString,
      transferTx: transferTxString,
    });

    await nostr.sendTokenTransfer(recipientPubkey, payload);

    outboxRepo.updateEntry(outboxEntry.id, { status: 'NOSTR_SENT' });
    console.log(`📤 Token sent via Nostr to ${recipientNametag}`);

    const allTokens = getTokensForAddress(identity.address);
    const tokenToRemove = allTokens.find(t => t.id === uiId);
    if (tokenToRemove && identity.publicKey && identity.ipnsName) {
      const txf = tokenToTxf(tokenToRemove);
      if (!txf) {
        console.warn(`Cannot convert transferred token ${uiId.slice(0, 8)} to TXF`);
      } else {
        const stateHash = getCurrentStateHash(txf) ?? '';
        if (!stateHash) {
          console.log(`📤 Token ${uiId.slice(0, 8)}... has no stateHash - will match by tokenId only`);
        }
        await removeTokenFromInventory(
          identity.address,
          identity.publicKey,
          identity.ipnsName,
          uiId,
          stateHash
        ).catch(err => {
          console.error(`Failed to remove transferred token ${uiId.slice(0, 8)}:`, err);
        });
      }
    }

    outboxRepo.updateEntry(outboxEntry.id, { status: 'COMPLETED' });
    console.log(`📤 Direct transfer completed - outbox entry ${outboxEntry.id.slice(0, 8)}... marked complete`);
  };

  // Helper functions
  const createUiTokenFromSdk = async (sdkToken: SdkToken<any>, coinId: string): Promise<Token> => {
    let amount = '0';
    const coinsOpt = sdkToken.coins;
    if (coinsOpt) {
      const rawCoins = coinsOpt.coins;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        const val = firstItem[1];
        if (Array.isArray(val)) {
          amount = val[1]?.toString() || '0';
        } else if (val) {
          amount = val.toString();
        }
      }
    }

    const def = registryService.getCoinDefinition(coinId);
    const iconUrl = def ? registryService.getIconUrl(def) : undefined;

    const sdkJson = sdkToken.toJSON() as any;

    const txfJson = {
      ...sdkJson,
      version: sdkJson.version || '2.0',
      transactions: sdkJson.transactions || [],
      nametags: sdkJson.nametags || [],
      _integrity: sdkJson._integrity || {
        genesisDataJSONHash: '0000' + '0'.repeat(60),
      },
    };

    return new Token({
      id: uuidv4(),
      name: def?.symbol || 'Change Token',
      symbol: def?.symbol || 'UNK',
      type: 'Fungible',
      jsonData: JSON.stringify(txfJson),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl ? iconUrl : undefined,
      timestamp: Date.now(),
    });
  };

  const saveChangeTokenToWallet = async (
    sdkToken: SdkToken<any>,
    coinId: string,
    identity: { address: string; publicKey: string; ipnsName: string }
  ) => {
    let amount = '0';
    const coinsOpt = sdkToken.coins;
    const coinData = coinsOpt;
    if (coinData) {
      const rawCoins = coinData.coins;
      let val: unknown = null;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        val = firstItem[1];
      }

      if (Array.isArray(val)) {
        amount = val[1]?.toString() || '0';
      } else if (val) {
        amount = (val as { toString(): string }).toString();
      }
    }

    const def = registryService.getCoinDefinition(coinId);
    const iconUrl = def ? registryService.getIconUrl(def) : undefined;

    const sdkJson = sdkToken.toJSON() as any;

    const sdkKeys = Object.keys(sdkJson);
    const hasGenesis = !!sdkJson.genesis;
    const hasState = !!sdkJson.state;
    const hasTransactions = Array.isArray(sdkJson.transactions);
    const txCount = hasTransactions ? (sdkJson.transactions as unknown[]).length : 0;

    console.log(`📦 SDK toJSON() output for change token:`, {
      keys: sdkKeys,
      hasGenesis,
      hasState,
      hasTransactions,
      transactionCount: txCount,
      firstTx: txCount > 0 ? {
        keys: Object.keys((sdkJson.transactions as any[])[0] || {}),
        hasInclusionProof: !!(sdkJson.transactions as any[])[0]?.inclusionProof,
      } : null,
    });

    if (!sdkJson.genesis || !sdkJson.state) {
      console.error(`❌ Change token missing required TXF fields!`, {
        hasGenesis: !!sdkJson.genesis,
        hasState: !!sdkJson.state,
        keys: Object.keys(sdkJson),
      });
    } else {
      console.log(`✅ Change token has valid TXF structure (genesis + state + ${txCount} tx)`);
    }

    const txfJson = {
      ...sdkJson,
      version: sdkJson.version || '2.0',
      transactions: sdkJson.transactions || [],
      nametags: sdkJson.nametags || [],
      _integrity: sdkJson._integrity || {
        genesisDataJSONHash: '0000' + '0'.repeat(60),
      },
    };

    const finalTxCount = Array.isArray(txfJson.transactions) ? txfJson.transactions.length : 0;
    console.log(`📦 Final TXF structure: ${finalTxCount} transactions preserved`);

    const genesisTokenId = (sdkJson.genesis as any)?.data as any | undefined;
    const tokenId = genesisTokenId?.tokenId as string | undefined;

    const uiToken = new Token({
      id: uuidv4(),
      name: def?.symbol || 'Change Token',
      symbol: def?.symbol || 'UNK',
      type: 'Fungible',
      jsonData: JSON.stringify(txfJson),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl ? iconUrl : undefined,
      timestamp: Date.now(),
    });

    console.log(`💾 Saving change token: ${amount} ${def?.symbol}, tokenId: ${tokenId?.slice(0, 8) || 'unknown'}...`);

    await addTokenToInventory(
      identity.address,
      identity.publicKey,
      identity.ipnsName,
      uiToken,
      { local: true }
    ).catch(err => {
      console.error(`Failed to save change token:`, err);
      throw err;
    });
  };

  const getSeedPhrase = async (): Promise<string[] | null> => {
    const identity = await identityManager.getCurrentIdentity();
    if (!identity?.mnemonic) return null;
    return identity.mnemonic.split(' ');
  };

  const getL1Address = async (): Promise<string | null> => {
    return identityManager.getL1Address();
  };

  const getUnifiedKeyManager = () => {
    return identityManager.getUnifiedKeyManager();
  };

  const checkNametagAvailability = async (nametag: string): Promise<boolean> => {
    return await nametagService.isNametagAvailable(nametag);
  };

  const contextValue: WalletContextValue = {
    identity: identityQuery.data,
    isLoadingIdentity: identityQuery.isLoading,
    l1Address: identityQuery.data?.l1Address || null,
    nametag: nametagQuery.data,
    isLoadingNametag: nametagQuery.isLoading,
    assets: aggregatedAssetsQuery.data || [],
    isLoadingAssets: aggregatedAssetsQuery.isLoading,
    assetsUpdatedAt: aggregatedAssetsQuery.dataUpdatedAt,
    tokens: tokensQuery.data || [],
    tokensUpdatedAt: tokensQuery.dataUpdatedAt,
    isValidatingTokens,
    createWallet: createWalletMutation.mutateAsync,
    restoreWallet: restoreWalletMutation.mutateAsync,
    mintNametag: mintNametagMutation.mutateAsync,
    sentToken: sendTokenMutation.mutateAsync,
    sendAmount: sendAmountMutation.mutateAsync,
    isSending: sendAmountMutation.isPending || sendTokenMutation.isPending,
    getSeedPhrase,
    getL1Address,
    getUnifiedKeyManager,
    checkNametagAvailability,
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
};
