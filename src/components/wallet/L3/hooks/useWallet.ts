/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AggregatedAsset, Token, TokenStatus } from "../data/model";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { ServiceProvider } from "../services/ServiceProvider";
import { waitInclusionProofWithDevBypass } from "../../../../utils/devTools";
import { ApiService } from "../services/api";
import {
  getTokensForAddress,
  getNametagForAddress,
  clearNametagForAddress,
  addToken as addTokenToInventory,
  removeToken as removeTokenFromInventory,
  dispatchWalletUpdated,
  inventorySync
} from "../services/InventorySyncService";
import { tokenToTxf, getCurrentStateHash } from "../services/TxfSerializer";
import { NametagService } from "../services/NametagService";
import { RegistryService } from "../services/RegistryService";
import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { TokenSplitExecutor, type SplitPersistenceCallbacks } from "../services/transfer/TokenSplitExecutor";
import { TokenSplitCalculator } from "../services/transfer/TokenSplitCalculator";
import { IpfsStorageService, SyncPriority } from "../services/IpfsStorageService";
import { IdentityManager } from "../services/IdentityManager";
import { NostrService } from "../services/NostrService";
import { InventoryBackgroundLoopsManager } from "../services/InventoryBackgroundLoops";
import type { NostrDeliveryQueueEntry } from "../services/types/QueueTypes";
import { TokenRecoveryService } from "../services/TokenRecoveryService";
import { L1_KEYS } from "../../L1/hooks/useL1Wallet";
import { isNametagCorrupted } from "../../../../utils/tokenValidation";
import { getTokenValidationService } from "../services/TokenValidationService";
import { OutboxRepository } from "../../../../repositories/OutboxRepository";
import { addSentTransaction } from "../../../../services/TransactionHistoryService";
import { STORAGE_KEY_GENERATORS } from "../../../../config/storageKeys";
import { QUERY_KEYS } from "../../../../config/queryKeys";

// Re-export for backward compatibility
export const KEYS = QUERY_KEYS;

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
  // Handle empty list explicitly
  if (tokens.length === 0) {
    return 'EMPTY';
  }

  // Create signature of each token including state hash (critical for boomerang detection)
  const signatures = tokens
    .map(t => {
      // Extract state hash from jsonData if available
      let stateHash = '';
      try {
        const parsed = JSON.parse(t.jsonData || '{}');
        stateHash = parsed.state?.stateHash || '';
      } catch {
        // Ignore parse errors
      }

      // Include state hash to detect token evolution (transfers, burns, etc.)
      return `${t.id}|${t.amount}|${t.status}|${t.coinId}|${stateHash}`;
    })
    .sort()
    .join('::');

  // djb2 hash with unsigned 32-bit result
  let hash = 5381;
  for (let i = 0; i < signatures.length; i++) {
    const char = signatures.charCodeAt(i);
    hash = ((hash << 5) + hash) + char;
  }

  // Force unsigned 32-bit integer (prevents negative values)
  return (hash >>> 0).toString(16);
}

// Module-level flag to prevent multiple useWallet instances from triggering initial sync
// Each useWallet has its own useEffect, but sync should only run once on page load
let _initialSyncTriggered = false;

export const useWallet = () => {
  const queryClient = useQueryClient();
  const identityManager = IdentityManager.getInstance();
  const nostrService = NostrService.getInstance();
  const nametagService = NametagService.getInstance(identityManager);

  // Debounce timer ref for wallet-updated events
  // This coalesces multiple rapid events (e.g., during batch token receipt) into a single refetch
  const walletUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const WALLET_UPDATE_DEBOUNCE_MS = 200;

  // Track token list hash to detect actual changes (avoid redundant spent checks)
  // Persisted to localStorage to survive page reloads
  const lastTokenHashRef = useRef<string>('');

  // Prevent refetch during active inventory sync
  const skipRefetchDuringSyncRef = useRef<boolean>(false);

  // Track if wallet-updated events were skipped during sync (need refetch when sync ends)
  const pendingUpdateDuringSyncRef = useRef<boolean>(false);

  // Rate-limit consecutive spent checks
  const lastSpentCheckTimeRef = useRef<number>(0);
  const MIN_SPENT_CHECK_INTERVAL_MS = 2000; // 2 second minimum between checks

  // Track background token validation state (for UI indicator)
  const [isValidatingTokens, setIsValidatingTokens] = useState(false);

  useEffect(() => {
    const handleWalletUpdate = () => {
      // Skip if we're in the middle of inventory sync, but mark as pending
      if (skipRefetchDuringSyncRef.current) {
        console.log('⏭️  [useWallet] Skipping wallet-updated refetch during active inventory sync (marked pending)');
        pendingUpdateDuringSyncRef.current = true;
        return;
      }

      // Rate-limit consecutive spent checks
      const timeSinceLastCheck = Date.now() - lastSpentCheckTimeRef.current;
      if (timeSinceLastCheck < MIN_SPENT_CHECK_INTERVAL_MS) {
        console.log(
          `⏭️  [useWallet] Skipping refetch (${timeSinceLastCheck}ms < ${MIN_SPENT_CHECK_INTERVAL_MS}ms minimum)`
        );
        return;
      }

      // Debounce: coalesce multiple wallet-updated events within 200ms window
      // This prevents 20+ spent checks during batch token receipt
      if (walletUpdateDebounceRef.current) {
        clearTimeout(walletUpdateDebounceRef.current);
      }

      walletUpdateDebounceRef.current = setTimeout(() => {
        walletUpdateDebounceRef.current = null;
        lastSpentCheckTimeRef.current = Date.now(); // Record check time
        queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
        queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
        // Also invalidate nametag query - critical for Unicity ID invalidation flow
        queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
      }, WALLET_UPDATE_DEBOUNCE_MS);
    };

    // Handle wallet-loaded event (triggered after wallet creation/restoration)
    // This ensures identity, nametag, and L1 wallet queries are refreshed
    // Note: wallet-loaded is NOT debounced as it's a one-time event
    const handleWalletLoaded = () => {
      console.log("📢 useWallet: wallet-loaded event received, refreshing queries...");

      // Reset token hash to force spent check on wallet load
      // Prevents stale hash from skipping validation after identity change or IPFS sync
      lastTokenHashRef.current = '';
      lastSpentCheckTimeRef.current = 0; // Also reset rate limit

      queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
      queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
      queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
      queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
      queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
    };

    window.addEventListener("wallet-updated", handleWalletUpdate);
    window.addEventListener("wallet-loaded", handleWalletLoaded);
    return () => {
      window.removeEventListener("wallet-updated", handleWalletUpdate);
      window.removeEventListener("wallet-loaded", handleWalletLoaded);
      // Clear any pending debounce timer on cleanup
      if (walletUpdateDebounceRef.current) {
        clearTimeout(walletUpdateDebounceRef.current);
      }
    };
  }, [queryClient]);

  // NOTE: IPFS auto-sync initialization is now in the useEffect at lines 173-181
  // that waits for identity to be loaded (prevents race conditions)

  const identityQuery = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: async () => {
      const identity = await identityManager.getCurrentIdentity();
      return identity;
    },
    staleTime: Infinity, // Identity rarely changes - only refetch on explicit invalidation
  });

  const nametagQuery = useQuery({
    queryKey: [...KEYS.NAMETAG, identityQuery.data?.address],
    queryFn: () => {
      const identity = identityQuery.data;
      if (!identity?.address) return null;

      // Get nametag from InventorySyncService (no wallet concept needed)
      console.log(`📦 [nametagQuery] Loading nametag for address: ${identity.address.slice(0, 30)}...`);
      const nametagData = getNametagForAddress(identity.address);

      // CRITICAL: Check for corrupted nametag and treat as "no nametag exists"
      // This allows the user to create a new Unicity ID if their data is corrupted
      if (isNametagCorrupted(nametagData)) {
        console.warn("🚨 Corrupted nametag detected, clearing from local and IPFS", {
          address: identity.address.slice(0, 20) + "...",
          name: nametagData?.name,
          corruption: "token is empty or missing required fields",
        });

        // Clear from both local and IPFS storage (breaks import loop)
        // Note: This is a sync queryFn - IPFS clear happens in background
        try {
          clearNametagForAddress(identity.address); // Clear local immediately

          // Trigger IPFS clear in background (don't await in queryFn)
          // This publishes clean state to IPFS, overwriting the corrupted nametag
          const storageService = IpfsStorageService.getInstance(identityManager);
          storageService.clearCorruptedNametagAndSync().catch((err) => {
            console.error("Background IPFS nametag clear failed:", err);
          });

          console.log("✅ Initiated nametag clear from local and IPFS");
        } catch (error) {
          console.error("Failed to clear corrupted nametag:", error);
        }

        return null; // Treat as "no nametag exists" - user can create new Unicity ID
      }

      return nametagData?.name || null;
    },
    enabled: !!identityQuery.data?.address,
    staleTime: Infinity, // Only refetch on explicit invalidation (no auto-refetch)
  });

  // Initialize inventory sync when identity is available
  // This triggers IPFS sync to recover tokens and nametag from remote storage.
  // Uses InventorySyncService.inventorySync() instead of deprecated IpfsStorageService.startAutoSync()
  // Extract primitive values to prevent effect from re-running when object reference changes
  const identityAddress = identityQuery.data?.address;
  const identityPublicKey = identityQuery.data?.publicKey;
  const identityIpnsName = identityQuery.data?.ipnsName;

  useEffect(() => {
    // Run inventory sync when user has identity - this will recover nametag and tokens from IPFS
    // Use module-level flag to ensure only ONE instance triggers the initial sync
    // (multiple useWallet hooks are mounted across the app)
    if (identityAddress && identityPublicKey && identityIpnsName && !_initialSyncTriggered) {
      _initialSyncTriggered = true;
      console.log('🔄 [useWallet] Triggering initial inventory sync (once per page load)');
      // Trigger sync to merge local and remote state
      inventorySync({
        address: identityAddress,
        publicKey: identityPublicKey,
        ipnsName: identityIpnsName,
      }).catch(err => {
        console.error('❌ [useWallet] Initial inventory sync failed:', err);
      });
    }
  }, [identityAddress, identityPublicKey, identityIpnsName]);

  // Load cached token hash from localStorage when identity changes
  // This allows skipping spent checks on page reload when token list hasn't changed
  useEffect(() => {
    const address = identityQuery.data?.address;
    if (address) {
      const cachedHash = localStorage.getItem(STORAGE_KEY_GENERATORS.tokenListHash(address));
      // Only update and log if hash actually changed (prevents spam from multiple useWallet instances)
      if (cachedHash && cachedHash !== lastTokenHashRef.current) {
        lastTokenHashRef.current = cachedHash;
        console.log(`📦 [useWallet] Loaded cached token hash for address: ${cachedHash}`);
      }
    }
  }, [identityQuery.data?.address]);

  // NOTE: OutboxRecoveryService lifecycle is now managed centrally in ServicesProvider.tsx
  // This prevents the repeated start/stop cycles that occurred when multiple components
  // using useWallet() each had their own lifecycle management.

  // Listen for inventory sync lifecycle events with failsafe timeout
  useEffect(() => {
    let lockTimeout: ReturnType<typeof setTimeout> | null = null;
    const SYNC_LOCK_TIMEOUT_MS = 60000; // 60 seconds failsafe

    const handleSyncStart = () => {
      skipRefetchDuringSyncRef.current = true;
      console.log('🔒 [useWallet] Locking refetch during active inventory sync');

      // Failsafe: Auto-unlock after 60 seconds if sync crashes
      lockTimeout = setTimeout(() => {
        if (skipRefetchDuringSyncRef.current) {
          console.warn('⚠️ [useWallet] Sync lock timeout - forcibly unlocking after 60s');
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
      console.log('🔓 [useWallet] Unlocking refetch after inventory sync completes');

      // NOTE: We no longer trigger refetch here because:
      // 1. dispatchWalletUpdated() in InventorySyncService already calls invalidateWalletQueries()
      // 2. Multiple useWallet instances each have their own handleSyncEnd, causing cascading refetches
      // Just clear the pending flag without triggering another refetch
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

  // Ensure registry is loaded before aggregating assets
  const registryQuery = useQuery({
    queryKey: KEYS.REGISTRY,
    queryFn: async () => {
      await registryService.ensureInitialized();
      return true;
    },
    staleTime: Infinity, // Registry doesn't change during session
  });

  const pricesQuery = useQuery({
    queryKey: KEYS.PRICES,
    queryFn: ApiService.fetchPrices,
    refetchInterval: 5 * 60_000, // 5 min — SDK handles primary price updates
    staleTime: 60_000,
  });

  const tokensQuery = useQuery({
    // Include identity address in query key to prevent race conditions when switching identities
    queryKey: [...KEYS.TOKENS, identityQuery.data?.address],
    queryFn: async () => {
      const identity = identityQuery.data;
      if (!identity?.address) return [];

      // Get tokens directly from InventorySyncService (no wallet concept needed)
      // Returns immediately - spent check runs in background
      console.log(`📦 [tokensQuery] QUERY FN INVOKED for address: ${identity.address.slice(0, 30)}...`);
      let tokens = getTokensForAddress(identity.address);
      console.log(`📦 [tokensQuery] Got ${tokens.length} tokens from localStorage`);

      // Check for tokens with pending outbox entries (in-transit transfers)
      // These should be filtered out as they're being transferred
      const outboxRepo = OutboxRepository.getInstance();
      const pendingEntries = outboxRepo.getPendingEntries();
      if (pendingEntries.length > 0) {
        const pendingTokenIds = new Set(pendingEntries.map(e => e.sourceTokenId));
        const tokensInTransit = tokens.filter(t => pendingTokenIds.has(t.id));

        if (tokensInTransit.length > 0) {
          console.log(`📦 Found ${tokensInTransit.length} token(s) with pending outbox entries (in transit)`);
          for (const token of tokensInTransit) {
            console.log(`  🚀 Token ${token.id.slice(0, 16)}... is in transit (has outbox entry)`);
          }
          // Filter out tokens that are in transit (have pending outbox entries)
          tokens = tokens.filter(t => !pendingTokenIds.has(t.id));
        }
      }

      console.log(`📦 [tokensQuery] Returning ${tokens.length} tokens after filtering`);
      return tokens;
    },
    enabled: !!identityQuery.data?.address,
    staleTime: Infinity, // Only refetch on explicit invalidation - data comes from localStorage
  });

  // Background spent token validation - runs after tokens are displayed
  // This validates tokens against aggregator without blocking the UI
  const isValidatingRef = useRef(false);
  useEffect(() => {
    const identity = identityQuery.data;
    const tokens = tokensQuery.data;

    // Skip if no identity, no tokens, or already validating
    if (!identity?.address || !identity?.publicKey || !tokens || tokens.length === 0 || isValidatingRef.current) {
      return;
    }

    // Hash-based change detection to avoid redundant spent checks
    const currentTokenHash = computeTokenListHash(tokens);
    const tokenListUnchanged = currentTokenHash === lastTokenHashRef.current;

    if (tokenListUnchanged) {
      console.log(`⏩ [backgroundValidation] Token list hash unchanged (${currentTokenHash}), skipping spent check`);
      return;
    }

    // Mark as validating to prevent concurrent runs
    isValidatingRef.current = true;
    setIsValidatingTokens(true);

    const runBackgroundValidation = async () => {
      console.log(`🔄 [backgroundValidation] Running spent check for ${tokens.length} token(s) in background...`);

      try {
        const validationService = getTokenValidationService();

        // Clear UNSPENT cache entries to force fresh aggregator check
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

          // Refetch tokens after removing spent ones
          queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
        }

        // Update hash after successful validation (in memory and localStorage)
        lastTokenHashRef.current = currentTokenHash;
        localStorage.setItem(STORAGE_KEY_GENERATORS.tokenListHash(identity.address), currentTokenHash);

      } catch (err) {
        console.warn('🔄 [backgroundValidation] Failed to check spent tokens:', err);
      } finally {
        isValidatingRef.current = false;
        setIsValidatingTokens(false);
      }
    };

    // Run validation in background (non-blocking)
    runBackgroundValidation();
  }, [identityQuery.data, tokensQuery.data, queryClient]);

  const aggregatedAssetsQuery = useQuery({
    queryKey: [
      ...KEYS.AGGREGATED,
      tokensQuery.dataUpdatedAt,
      // Don't include pricesQuery.dataUpdatedAt to avoid refetch on price updates
      // Prices will update automatically when pricesQuery.data changes
    ],
    queryFn: async () => {
      // Wait for registry to be ready
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

          const symbol = def?.symbol || firstToken.symbol || "UNK";
          const name = def?.name || firstToken.name || "Unknown Token";
          const priceKey =
            symbol.toLowerCase() === "btc"
              ? "bitcoin"
              : symbol.toLowerCase() === "eth"
              ? "ethereum"
              : symbol.toLowerCase() === "sol"
              ? "solana"
              : "tether";

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
    // Wait for both registry, tokens, and prices to be ready
    enabled: !!registryQuery.data && !!tokensQuery.data && !!pricesQuery.data,
  });

  const createWalletMutation = useMutation({
    mutationFn: async () => {
      const identity = await identityManager.generateNewIdentity();
      // No need to create wallet - InventorySyncService handles storage automatically
      return identity;
    },
    onSuccess: async () => {
      // Remove ALL wallet-related queries to prevent race conditions
      await queryClient.removeQueries({ queryKey: KEYS.IDENTITY });
      await queryClient.removeQueries({ queryKey: KEYS.TOKENS });
      await queryClient.removeQueries({ queryKey: KEYS.NAMETAG });
      await queryClient.removeQueries({ queryKey: KEYS.AGGREGATED });

      // Now invalidate to trigger fresh fetch
      await queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
    },
  });

  const restoreWalletMutation = useMutation({
    mutationFn: async (mnemonic: string) => {
      const identity = await identityManager.deriveIdentityFromMnemonic(mnemonic);
      // No need to create wallet - InventorySyncService handles storage automatically
      return identity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
  });

  const mintNametagMutation = useMutation({
    mutationFn: async (nametag: string) => {
      const result = await nametagService.mintNametagAndPublish(nametag);

      if (result.status === "error") {
        throw new Error(result.message);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
  });

  const sendTokenMutation = useMutation({
    mutationFn: async (params: { recipientNametag: string; token: Token }) => {
      const { recipientNametag, token } = params;
      console.log(
        `Starting transfer of ${token.symbol} to ${recipientNametag}`
      );

      const identity = await identityManager.getCurrentIdentity();
      if (!identity) throw new Error("Wallet locked or missing");

      const secret = Buffer.from(identity.privateKey, "hex");

      const recipientPubkey = await nostrService.queryPubkeyByNametag(
        recipientNametag
      );
      if (!recipientPubkey)
        throw new Error(`Recipient ${recipientNametag} not found on Nostr`);

      const recipientProxyAddress = await ProxyAddress.fromNameTag(
        recipientNametag
      );

      if (!token.jsonData) throw new Error("Token data missing");
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

      // Log the RequestId being committed (for spent detection debugging)
      console.log(`🔑 [Transfer] RequestId committed: ${transferCommitment.requestId.toString()}`);
      console.log(`   - sourceToken stateHash: ${(await sourceToken.state.calculateHash()).toJSON()}`);
      console.log(`   - signingService.publicKey: ${Buffer.from(signingService.publicKey).toString("hex")}`);

      const client = ServiceProvider.stateTransitionClient;
      const response = await client.submitTransferCommitment(
        transferCommitment
      );

      if (response.status !== "SUCCESS") {
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

      if (!sent) throw new Error("Failed to send p2p message via Nostr");

      // Remove the token from inventory
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
    // NOTE: No onSuccess invalidation needed - removeTokenFromInventory() calls
    // inventorySync() which calls dispatchWalletUpdated() → invalidateWalletQueries()
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

      // 1. PREPARE IDENTITY & RECIPIENT
      const identity = await identityManager.getCurrentIdentity();
      if (!identity) throw new Error("Wallet locked");

      const secret = Buffer.from(identity.privateKey, "hex");
      const signingService = await SigningService.createFromSecret(secret);

      const recipientPubkey = await nostrService.queryPubkeyByNametag(
        recipientNametag
      );
      if (!recipientPubkey)
        throw new Error(`Recipient @${recipientNametag} not found on Nostr`);

      const recipientAddress = await ProxyAddress.fromNameTag(recipientNametag);

      // 2. CALCULATE PLAN
      const calculator = new TokenSplitCalculator();
      const allTokens = getTokensForAddress(identity.address);

      const plan = await calculator.calculateOptimalSplit(
        allTokens,
        targetAmount,
        params.coinId
      );

      if (!plan)
        throw new Error("Insufficient funds or no suitable tokens found");

      console.log("📋 Transfer Plan:", {
        direct: plan.tokensToTransferDirectly.length,
        split: plan.requiresSplit ? "YES" : "NO",
        splitAmount: plan.splitAmount?.toString(),
        remainder: plan.remainderAmount?.toString(),
      });

      // 3. EXECUTE DIRECT TRANSFERS
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

        // Record direct transfer to transaction history
        const def = registryService.getCoinDefinition(params.coinId);
        const iconUrl = def ? registryService.getIconUrl(def) || undefined : undefined;
        addSentTransaction(
          item.amount.toString(),
          params.coinId,
          def?.symbol || 'UNK',
          iconUrl,
          recipientNametag
        );
      }

      // 4. EXECUTE SPLIT
      if (plan.requiresSplit) {
        console.log("✂️ Executing split...");

        // Import outbox repository for tracking
        const { OutboxRepository } = await import("../../../../repositories/OutboxRepository");
        const outboxRepo = OutboxRepository.getInstance();

        // Use identity address for outbox context (no wallet concept)
        const walletAddress = identity.address;
        outboxRepo.setCurrentAddress(walletAddress);

        // Create outbox context for tracking
        const outboxContext = {
          walletAddress,
          recipientNametag,
          recipientPubkey,
          ownerPublicKey: identity.publicKey,
        };

        const executor = new TokenSplitExecutor();

        // Create persistence callbacks for save-before-submit pattern
        // This ensures change tokens are saved IMMEDIATELY after minting
        // before any further aggregator submissions (critical for crash safety)
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        const persistenceCallbacks: SplitPersistenceCallbacks = {
          onTokenMinted: async (sdkToken: SdkToken<any>, isChangeToken: boolean) => {
            if (isChangeToken && identity.ipnsName) {
              // Save change token IMMEDIATELY after mint proof received
              // This is the critical safety point - token is now persisted locally
              await saveChangeTokenToWallet(sdkToken, params.coinId, {
                address: identity.address,
                publicKey: identity.publicKey,
                ipnsName: identity.ipnsName,
              });

              // CRITICAL: Dispatch wallet-updated to ensure UI and IPFS sync sees this token
              // Without this, the token may be missed if onPreTransferSync is called immediately after
              dispatchWalletUpdated();

              console.log(`🔒 Change token saved immediately after mint (crash-safe)`);
            }
          },
          onPreTransferSync: async () => {
            // Sync to IPFS before submitting transfer to aggregator
            // This ensures we have a backup before the final commitment
            // Uses HIGH priority so it jumps ahead of auto-syncs in the queue
            try {
              const result = await ipfsService.syncNow({
                priority: SyncPriority.HIGH,
                timeout: 60000,
                callerContext: 'pre-transfer-sync',
              });

              if (result.success) {
                console.log(`☁️ Pre-transfer IPFS sync completed (tokens backed up)`);
                return true;
              }

              console.error(`❌ Pre-transfer IPFS sync failed: ${result.error}`);
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
            // Remove burned token from inventory
            const burnedToken = allTokens.find(t => t.id === burnedId);
            if (burnedToken) {
              const txf = tokenToTxf(burnedToken);
              if (!txf) {
                console.warn(`Cannot convert burned token ${burnedId.slice(0, 8)} to TXF`);
              } else {
                const stateHash = getCurrentStateHash(txf) ?? '';
                if (stateHash && identity.publicKey && identity.ipnsName) {
                  await removeTokenFromInventory(
                    identity.address,
                    identity.publicKey,
                    identity.ipnsName,
                    burnedId,
                    stateHash
                  ).catch(err => {
                    console.error(`Failed to remove burned token ${burnedId.slice(0, 8)}:`, err);
                  });
                }
              }
            }
          },
          outboxContext,
          persistenceCallbacks
        );

        // Add transaction history for the actual sent amount
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

        // Queue tokens for delivery via NostrDeliveryQueue (12-way parallel with retry)
        // Try to get the delivery queue, fall back to direct send if not available
        let deliveryQueue: ReturnType<typeof InventoryBackgroundLoopsManager.prototype.getDeliveryQueue> | null = null;
        try {
          const loopsManager = InventoryBackgroundLoopsManager.getInstance();
          if (loopsManager.isReady()) {
            deliveryQueue = loopsManager.getDeliveryQueue();
          }
        } catch {
          // Loops manager not initialized, will use direct send
        }

        for (let i = 0; i < splitResult.tokensForRecipient.length; i++) {
          const token = splitResult.tokensForRecipient[i];
          const tx = splitResult.recipientTransferTxs[i];
          const outboxEntryId = splitResult.outboxEntryIds[i];

          const sourceTokenString = JSON.stringify(token.toJSON());
          const transferTxString = JSON.stringify(tx.toJSON());

          // Extract stateHash for multi-version tracking (Amendment 2)
          const stateHashResult = await token.state.calculateHash();
          const stateHash = stateHashResult.toString();

          const payload = JSON.stringify({
            sourceToken: sourceTokenString,
            transferTx: transferTxString,
            tokenId: token.id.toString(),
            stateHash,
          });

          if (deliveryQueue) {
            // Queue for background delivery with automatic retry
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

            // Mark outbox as pending delivery (queue will finalize)
            if (outboxEntryId) {
              // Keep as PROOF_RECEIVED - the queue's finalizeCompletedTransfers will mark COMPLETED
              console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... queued for delivery`);
            }
          } else {
            // Fallback: Direct send (no delivery queue available)
            console.log("📨 Sending split token via Nostr (direct)...");
            await nostrService.sendTokenTransfer(recipientPubkey, payload, undefined, undefined, params.eventId);

            // Update outbox: Nostr sent
            if (outboxEntryId) {
              outboxRepo.updateStatus(outboxEntryId, "NOSTR_SENT");
              outboxRepo.updateStatus(outboxEntryId, "COMPLETED");
              console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... sent via Nostr (direct)`);
            }
          }
        }

        // NOTE: Change tokens are now saved IMMEDIATELY via persistenceCallbacks.onTokenMinted
        // during the mint phase, not here after the split completes (crash-safe pattern)

        // Clean up split group
        // For delivery queue: entries stay as PROOF_RECEIVED until queue finalizes
        // For direct send: entries were already marked COMPLETED above
        if (splitResult.splitGroupId) {
          outboxRepo.removeSplitGroup(splitResult.splitGroupId);
        }

        // Final IPFS sync after split completion (sync outbox status updates)
        // Note: ipfsService already created above for persistence callbacks
        await ipfsService.syncNow({
          priority: SyncPriority.MEDIUM,
          callerContext: 'post-split-sync',
        }).catch(err => {
          console.warn("⚠️ Final IPFS sync after split failed:", err);
        });
      }

      return true;
    },
    // NOTE: No onSuccess invalidation needed - dispatchWalletUpdated() is called
    // when change token is saved (persistenceCallbacks.onTokenMinted) and after
    // inventorySync completes. Redundant invalidation removed.
  });

  const executeDirectTransfer = async (
    sourceToken: SdkToken<any>,
    uiId: string,
    recipientAddress: any,
    recipientPubkey: string,
    signingService: any,
    nostr: NostrService,
    recipientNametag: string
  ) => {
    const { OutboxRepository } = await import("../../../../repositories/OutboxRepository");
    const { createOutboxEntry } = await import("../services/types/OutboxTypes");
    const outboxRepo = OutboxRepository.getInstance();

    // Get identity for outbox repository (no wallet concept)
    const identity = await identityManager.getCurrentIdentity();
    if (!identity) throw new Error("Wallet locked");

    outboxRepo.setCurrentAddress(identity.address);

    // 1. Generate salt and create commitment
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

    // 2. Extract amount and coinId from source token
    let amount = "0";
    let coinId = "";
    const coinsOpt = sourceToken.coins;
    if (coinsOpt) {
      const rawCoins = coinsOpt.coins;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        coinId = firstItem[0]?.toString() || "";
        const val = firstItem[1];
        if (Array.isArray(val)) {
          amount = val[1]?.toString() || "0";
        } else if (val) {
          amount = val.toString();
        }
      }
    }

    // 3. Create outbox entry BEFORE any network calls (CRITICAL)
    const outboxEntry = createOutboxEntry(
      "DIRECT_TRANSFER",
      uiId,
      recipientNametag,
      recipientPubkey,
      JSON.stringify(recipientAddress.toJSON ? recipientAddress.toJSON() : recipientAddress),
      amount,
      coinId,
      Buffer.from(salt).toString("hex"),
      JSON.stringify(sourceToken.toJSON()),
      JSON.stringify(transferCommitment.toJSON())
    );

    // 4. Save to localStorage
    outboxRepo.addEntry(outboxEntry);
    console.log(`📤 Outbox: Created entry ${outboxEntry.id.slice(0, 8)}... for direct transfer`);

    // 5. Sync to IPFS if enabled (skip if IPFS is disabled)
    const isIpfsEnabled = import.meta.env.VITE_ENABLE_IPFS !== 'false';
    if (isIpfsEnabled) {
      // Uses HIGH priority so it jumps ahead of auto-syncs in the queue
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        const syncResult = await ipfsService.syncNow({
          priority: SyncPriority.HIGH,
          timeout: 60000,
          callerContext: 'outbox-pre-transfer',
        });

        if (!syncResult.success) {
          // Remove outbox entry since we didn't start the transfer
          outboxRepo.removeEntry(outboxEntry.id);
          throw new Error(`Failed to sync outbox to IPFS - aborting transfer: ${syncResult.error}`);
        }

        console.log(`📤 Outbox entry synced to IPFS: ${syncResult.cid?.slice(0, 12)}...`);
      } catch (err) {
        // Remove outbox entry if IPFS sync failed
        outboxRepo.removeEntry(outboxEntry.id);
        throw err;
      }
    } else {
      console.log(`📤 IPFS disabled - skipping outbox sync`);
    }

    // 6. Update status: ready to submit
    outboxRepo.updateEntry(outboxEntry.id, { status: "READY_TO_SUBMIT" });

    // 7. NOW safe to submit to aggregator (idempotent - REQUEST_ID_EXISTS is OK)
    const client = ServiceProvider.stateTransitionClient;
    const res = await client.submitTransferCommitment(transferCommitment);

    if (res.status !== "SUCCESS" && res.status !== "REQUEST_ID_EXISTS") {
      // Recover token before marking outbox as failed
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

          // Refresh wallet UI if token was modified
          if (recovery.tokenRestored || recovery.tokenRemoved) {
            dispatchWalletUpdated();
          }
        }
      } catch (recoveryErr) {
        console.error(`📤 Token recovery failed:`, recoveryErr);
      }

      outboxRepo.updateEntry(outboxEntry.id, {
        status: "FAILED",
        lastError: `Aggregator error: ${res.status}`,
      });
      throw new Error(`Direct transfer failed: ${res.status}`);
    }

    // 8. Update status: submitted
    outboxRepo.updateEntry(outboxEntry.id, { status: "SUBMITTED" });
    console.log(`📤 Transfer submitted to aggregator (status: ${res.status})`);

    // 9. Wait for inclusion proof (with dev mode bypass if enabled)
    const proof = await waitInclusionProofWithDevBypass(
      transferCommitment
    );

    const tx = transferCommitment.toTransaction(proof);

    // 10. Update status: proof received
    outboxRepo.updateEntry(outboxEntry.id, {
      status: "PROOF_RECEIVED",
      inclusionProofJson: JSON.stringify(proof.toJSON()),
      transferTxJson: JSON.stringify(tx.toJSON()),
    });
    console.log(`📤 Inclusion proof received`);

    // 11. Send via Nostr
    const sourceTokenString = JSON.stringify(sourceToken.toJSON());
    const transferTxString = JSON.stringify(tx.toJSON());

    const payload = JSON.stringify({
      sourceToken: sourceTokenString,
      transferTx: transferTxString,
    });

    await nostr.sendTokenTransfer(recipientPubkey, payload);

    // 12. Update status: Nostr sent
    outboxRepo.updateEntry(outboxEntry.id, { status: "NOSTR_SENT" });
    console.log(`📤 Token sent via Nostr to ${recipientNametag}`);

    // 13. Archive and remove token from active inventory
    const allTokens = getTokensForAddress(identity.address);
    const tokenToRemove = allTokens.find(t => t.id === uiId);
    if (tokenToRemove && identity.publicKey && identity.ipnsName) {
      const txf = tokenToTxf(tokenToRemove);
      if (!txf) {
        console.warn(`Cannot convert transferred token ${uiId.slice(0, 8)} to TXF`);
      } else {
        const stateHash = getCurrentStateHash(txf) ?? '';
        if (stateHash) {
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
    }

    // 14. Mark outbox entry as completed
    outboxRepo.updateEntry(outboxEntry.id, { status: "COMPLETED" });
    console.log(`📤 Direct transfer completed - outbox entry ${outboxEntry.id.slice(0, 8)}... marked complete`);

    // 15. Final IPFS sync to update outbox status
    try {
      const ipfsService = IpfsStorageService.getInstance(identityManager);
      await ipfsService.syncNow({
        priority: SyncPriority.MEDIUM,
        callerContext: 'post-transfer-sync',
      });
    } catch (err) {
      console.warn(`📤 Final IPFS sync after transfer failed:`, err);
      // Non-critical - token is transferred, outbox will be cleaned up later
    }
  };

  const saveChangeTokenToWallet = async (sdkToken: SdkToken<any>, coinId: string, identity: { address: string; publicKey: string; ipnsName: string }) => {
    let amount = "0";
    const coinsOpt = sdkToken.coins;
    const coinData = coinsOpt;
    if (coinData) {
      const rawCoins = coinData.coins;
      let val: any = null;
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        val = firstItem[1];
      }

      if (Array.isArray(val)) {
        amount = val[1]?.toString() || "0";
      } else if (val) {
        amount = val.toString();
      }
    }

    const def = registryService.getCoinDefinition(coinId);
    const iconUrl = def ? registryService.getIconUrl(def) : undefined;

    // Get SDK token JSON and validate TXF structure
    const sdkJson = sdkToken.toJSON() as any;

    // DETAILED LOGGING: Understand SDK output structure
    const sdkKeys = Object.keys(sdkJson);
    const hasGenesis = !!sdkJson.genesis;
    const hasState = !!sdkJson.state;
    const hasTransactions = Array.isArray(sdkJson.transactions);
    const txCount = hasTransactions ? sdkJson.transactions.length : 0;

    console.log(`📦 SDK toJSON() output for change token:`, {
      keys: sdkKeys,
      hasGenesis,
      hasState,
      hasTransactions,
      transactionCount: txCount,
      // Log first transaction's structure if exists
      firstTx: txCount > 0 ? {
        keys: Object.keys(sdkJson.transactions[0] || {}),
        hasInclusionProof: !!sdkJson.transactions[0]?.inclusionProof,
      } : null,
    });

    // Ensure the JSON has required TXF structure (genesis, state)
    // This is critical for IPFS sync to work properly
    if (!sdkJson.genesis || !sdkJson.state) {
      console.error(`❌ Change token missing required TXF fields!`, {
        hasGenesis: !!sdkJson.genesis,
        hasState: !!sdkJson.state,
        keys: Object.keys(sdkJson),
      });
      // Still try to save - maybe the fields are named differently
    } else {
      console.log(`✅ Change token has valid TXF structure (genesis + state + ${txCount} tx)`);
    }

    // Ensure TXF compatibility fields exist
    // IMPORTANT: We spread sdkJson first, so its transactions are preserved
    // The explicit transactions line below only provides a fallback if undefined
    const txfJson = {
      ...sdkJson,
      version: sdkJson.version || "2.0",
      transactions: sdkJson.transactions || [],
      nametags: sdkJson.nametags || [],
      _integrity: sdkJson._integrity || {
        genesisDataJSONHash: "0000" + "0".repeat(60),
      },
    };

    // Verify transactions were preserved
    const finalTxCount = Array.isArray(txfJson.transactions) ? txfJson.transactions.length : 0;
    console.log(`📦 Final TXF structure: ${finalTxCount} transactions preserved`);

    // Extract token ID for logging
    const genesisTokenId = sdkJson.genesis?.data?.tokenId;

    const uiToken = new Token({
      id: uuidv4(),
      name: def?.symbol || "Change Token",
      symbol: def?.symbol || "UNK",
      type: "Fungible",
      jsonData: JSON.stringify(txfJson),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl ? iconUrl : undefined,
      timestamp: Date.now(),
    });

    console.log(`💾 Saving change token: ${amount} ${def?.symbol}, tokenId: ${genesisTokenId?.slice(0, 8) || 'unknown'}...`);

    // Add token via InventorySyncService
    await addTokenToInventory(
      identity.address,
      identity.publicKey,
      identity.ipnsName,
      uiToken,
      { local: true } // Local-only to prevent IPFS sync during split (will sync after)
    ).catch(err => {
      console.error(`Failed to save change token:`, err);
      throw err; // Re-throw to fail the split if token save fails
    });
  };

  const getSeedPhrase = async (): Promise<string[] | null> => {
    const identity = await identityManager.getCurrentIdentity();
    if (!identity?.mnemonic) return null;
    return identity.mnemonic.split(' ');
  };

  // Get L1 address from unified wallet (if available)
  const getL1Address = async (): Promise<string | null> => {
    return identityManager.getL1Address();
  };

  // Get UnifiedKeyManager for advanced operations
  const getUnifiedKeyManager = () => {
    return identityManager.getUnifiedKeyManager();
  };

  const checkNametagAvailability = async (nametag: string): Promise<boolean> => {
    return await nametagService.isNametagAvailable(nametag);
  };

  return {
    identity: identityQuery.data,
    isLoadingIdentity: identityQuery.isLoading,

    // L1 address (from unified wallet)
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
};
