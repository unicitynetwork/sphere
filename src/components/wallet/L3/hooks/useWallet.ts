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
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { NametagService } from "../services/NametagService";
import { RegistryService } from "../services/RegistryService";
import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { TokenSplitExecutor, type SplitPersistenceCallbacks } from "../services/transfer/TokenSplitExecutor";
import { TokenSplitCalculator } from "../services/transfer/TokenSplitCalculator";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import { IpfsStorageService } from "../services/IpfsStorageService";
import { useServices } from "../../../../contexts/useServices";
import type { NostrService } from "../services/NostrService";
import { OutboxRecoveryService } from "../services/OutboxRecoveryService";
import { TokenRecoveryService } from "../services/TokenRecoveryService";
import { L1_KEYS } from "../../L1/hooks/useL1Wallet";
import { isNametagCorrupted } from "../../../../utils/tokenValidation";

export const KEYS = {
  IDENTITY: ["wallet", "identity"],
  TOKENS: ["wallet", "tokens"],
  PRICES: ["market", "prices"],
  REGISTRY: ["market", "registry"],
  AGGREGATED: ["wallet", "aggregated"],
  NAMETAG: ["wallet", "nametag"],
};

const walletRepo = WalletRepository.getInstance();
const registryService = RegistryService.getInstance();

export const useWallet = () => {
  const queryClient = useQueryClient();
  const { identityManager, nostrService } = useServices();
  const nametagService = NametagService.getInstance(identityManager);

  useEffect(() => {
    const handleWalletUpdate = () => {
      queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
      queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
    };

    // Handle wallet-loaded event (triggered after wallet creation/restoration)
    // This ensures identity, nametag, and L1 wallet queries are refreshed
    const handleWalletLoaded = () => {
      console.log("📢 useWallet: wallet-loaded event received, refreshing queries...");
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
    };
  }, [queryClient]);

  // Initialize IPFS storage service for automatic token sync (disabled by default)
  useEffect(() => {
    if (import.meta.env.VITE_ENABLE_IPFS === 'true') {
      const storageService = IpfsStorageService.getInstance(identityManager);
      storageService.startAutoSync();
    }
  }, [identityManager]);

  const identityQuery = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: async () => {
      const identity = await identityManager.getCurrentIdentity();
      return identity;
    },
    staleTime: 5000, // Allow refetch after 5 seconds instead of never
  });

  const nametagQuery = useQuery({
    queryKey: [...KEYS.NAMETAG, identityQuery.data?.address],
    queryFn: () => {
      const identity = identityQuery.data;
      if (!identity?.address) return null;

      // Ensure wallet is loaded/created for current identity (loads nametag from storage)
      const currentWallet = walletRepo.getWallet();
      if (!currentWallet || currentWallet.address !== identity.address) {
        const loaded = walletRepo.loadWalletForAddress(identity.address);
        if (!loaded) {
          // No existing wallet, create one (same as tokensQuery does)
          walletRepo.createWallet(identity.address);
        }
      }

      // Get nametag from repository
      const nametagData = walletRepo.getNametag();

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
          walletRepo.clearNametag(); // Clear local immediately

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
  });

  // Initialize IPFS storage service ONLY when fully authenticated
  // This prevents race condition where old wallet data is synced while user is on onboarding screen
  useEffect(() => {
    const identity = identityQuery.data;
    const nametag = nametagQuery.data;

    // Only start auto-sync when user is fully authenticated (has both identity AND nametag)
    if (identity && nametag) {
      const storageService = IpfsStorageService.getInstance(identityManager);
      storageService.startAutoSync();
    }
  }, [identityQuery.data, nametagQuery.data, identityManager]);

  // Recover any incomplete transfers from outbox on startup and enable periodic retry
  // This runs when identity is loaded and services are available
  useEffect(() => {
    const identity = identityQuery.data;
    if (!identity?.address || !nostrService) return;

    const recoveryService = OutboxRecoveryService.getInstance();
    recoveryService.setIdentityManager(identityManager);

    // Run initial recovery
    const pendingCount = recoveryService.getPendingCount(identity.address);
    if (pendingCount > 0) {
      console.log(`📤 useWallet: Found ${pendingCount} pending outbox entries, starting recovery...`);
    }

    recoveryService.recoverPendingTransfers(identity.address, nostrService)
      .then((result) => {
        if (result.recovered > 0 || result.failed > 0) {
          console.log(`📤 useWallet: Initial recovery - ${result.recovered} recovered, ${result.failed} failed`);
          // Refresh tokens after recovery
          queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
          queryClient.invalidateQueries({ queryKey: KEYS.AGGREGATED });
        }

        // Start periodic retry after initial recovery
        recoveryService.startPeriodicRetry(identity.address, nostrService);
      })
      .catch((error) => {
        console.error("📤 useWallet: Initial recovery failed:", error);
        // Still start periodic retry even if initial recovery failed
        recoveryService.startPeriodicRetry(identity.address, nostrService);
      });

    // Cleanup on unmount or identity change
    return () => {
      recoveryService.stopPeriodicRetry();
    };
  }, [identityQuery.data, nostrService, identityManager, queryClient]);

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
    refetchInterval: 60000,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  const tokensQuery = useQuery({
    // Include identity address in query key to prevent race conditions when switching identities
    queryKey: [...KEYS.TOKENS, identityQuery.data?.address],
    queryFn: async () => {
      const identity = identityQuery.data;
      if (!identity?.address) return [];

      // Load wallet for current address if not already loaded
      const currentWallet = walletRepo.getWallet();
      if (!currentWallet || currentWallet.address !== identity.address) {
        const loaded = walletRepo.loadWalletForAddress(identity.address);
        if (!loaded) {
          // No existing wallet, create one
          walletRepo.createWallet(identity.address);
        }
      }

      // Verify wallet still matches identity after load
      const wallet = walletRepo.getWallet();
      if (!wallet || wallet.address !== identity.address) {
        console.warn(`Wallet address mismatch after load: wallet=${wallet?.address}, identity=${identity.address}`);
        return [];
      }

      return walletRepo.getTokens();
    },
    enabled: !!identityQuery.data?.address,
  });

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
      walletRepo.createWallet(identity.address);
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
      walletRepo.createWallet(identity.address);
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

      // Remove the token from the wallet repository
      walletRepo.removeToken(token.id);

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
      queryClient.invalidateQueries({ queryKey: KEYS.AGGREGATED });
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

      const recipientTokenId = await TokenId.fromNameTag(recipientNametag);
      const recipientAddress = await ProxyAddress.fromTokenId(recipientTokenId);

      // 2. CALCULATE PLAN
      const calculator = new TokenSplitCalculator();
      const allTokens = walletRepo.getTokens();

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
      }

      // 4. EXECUTE SPLIT
      if (plan.requiresSplit) {
        console.log("✂️ Executing split...");

        // Import outbox repository for tracking
        const { OutboxRepository } = await import("../../../../repositories/OutboxRepository");
        const outboxRepo = OutboxRepository.getInstance();

        // Get wallet address for outbox context
        const wallet = walletRepo.getWallet();
        const walletAddress = wallet?.address || "";
        if (walletAddress) {
          outboxRepo.setCurrentAddress(walletAddress);
        }

        // Create outbox context for tracking
        const outboxContext = walletAddress ? {
          walletAddress,
          recipientNametag,
          recipientPubkey,
          ownerPublicKey: identity.publicKey,
        } : undefined;

        const executor = new TokenSplitExecutor();

        // Create persistence callbacks for save-before-submit pattern
        // This ensures change tokens are saved IMMEDIATELY after minting
        // before any further aggregator submissions (critical for crash safety)
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        const persistenceCallbacks: SplitPersistenceCallbacks = {
          onTokenMinted: async (sdkToken: SdkToken<any>, isChangeToken: boolean) => {
            if (isChangeToken) {
              // Save change token IMMEDIATELY after mint proof received
              // This is the critical safety point - token is now persisted locally
              saveChangeTokenToWallet(sdkToken, params.coinId);

              // CRITICAL: Force immediate cache refresh to ensure IPFS sync sees this token
              // Without this, the 100ms debounce in refreshWallet() can cause the token
              // to be missed if onPreTransferSync is called immediately after
              walletRepo.forceRefreshCache();

              console.log(`🔒 Change token saved immediately after mint (crash-safe)`);
            }
          },
          onPreTransferSync: async () => {
            // Sync to IPFS before submitting transfer to aggregator
            // This ensures we have a backup before the final commitment
            // CRITICAL: Must retry if sync is already in progress to ensure
            // the change token (just saved) is included in the sync
            const MAX_RETRIES = 10;
            const RETRY_DELAY_MS = 1000;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                const result = await ipfsService.syncNow();

                if (result.success) {
                  console.log(`☁️ Pre-transfer IPFS sync completed (tokens backed up)`);
                  return true;
                }

                // Sync failed - check if it was because another sync is in progress
                if (result.error === "Sync already in progress" || result.error === "Another tab is syncing") {
                  console.log(`⏳ Pre-transfer sync: waiting for in-progress sync (attempt ${attempt}/${MAX_RETRIES})...`);
                  // Wait for current sync to complete, then retry
                  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                  continue;
                }

                // Other error - log and fail
                console.error(`❌ Pre-transfer IPFS sync failed: ${result.error}`);
                return false;
              } catch (err) {
                console.error(`❌ Pre-transfer IPFS sync error (attempt ${attempt}):`, err);
                if (attempt === MAX_RETRIES) {
                  return false;
                }
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
              }
            }

            console.error(`❌ Pre-transfer IPFS sync failed after ${MAX_RETRIES} attempts`);
            return false;
          },
        };

        const splitResult = await executor.executeSplitPlan(
          plan,
          recipientAddress,
          signingService,
          (burnedId) => walletRepo.removeToken(burnedId, undefined, true), // Skip history for split
          outboxContext,
          persistenceCallbacks
        );

        // Add transaction history for the actual sent amount
        if (plan.splitAmount) {
          const def = registryService.getCoinDefinition(params.coinId);
          const iconUrl = def ? registryService.getIconUrl(def) || undefined : undefined;
          walletRepo.addSentTransaction(
            plan.splitAmount.toString(),
            params.coinId,
            def?.symbol || 'UNK',
            iconUrl,
            recipientNametag
          );
        }

        for (let i = 0; i < splitResult.tokensForRecipient.length; i++) {
          const token = splitResult.tokensForRecipient[i];
          const tx = splitResult.recipientTransferTxs[i];
          const outboxEntryId = splitResult.outboxEntryIds[i];

          const sourceTokenString = JSON.stringify(token.toJSON());
          const transferTxString = JSON.stringify(tx.toJSON());

          const payload = JSON.stringify({
            sourceToken: sourceTokenString,
            transferTx: transferTxString,
          });

          console.log("📨 Sending split token via Nostr...");
          await nostrService.sendTokenTransfer(recipientPubkey, payload, undefined, undefined, params.eventId);

          // Update outbox: Nostr sent
          if (outboxEntryId) {
            outboxRepo.updateStatus(outboxEntryId, "NOSTR_SENT");
            console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... sent via Nostr`);
          }
        }

        // NOTE: Change tokens are now saved IMMEDIATELY via persistenceCallbacks.onTokenMinted
        // during the mint phase, not here after the split completes (crash-safe pattern)

        // Mark all outbox entries as completed
        for (const outboxEntryId of splitResult.outboxEntryIds) {
          if (outboxEntryId) {
            outboxRepo.updateStatus(outboxEntryId, "COMPLETED");
            console.log(`📤 Outbox: Split transfer ${outboxEntryId.slice(0, 8)}... completed`);
          }
        }

        // Clean up split group
        if (splitResult.splitGroupId) {
          outboxRepo.removeSplitGroup(splitResult.splitGroupId);
        }

        // Final IPFS sync after split completion (sync outbox status updates)
        // Note: ipfsService already created above for persistence callbacks
        await ipfsService.syncNow().catch(err => {
          console.warn("⚠️ Final IPFS sync after split failed:", err);
        });
      }

      return true;
    },
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
        queryClient.invalidateQueries({ queryKey: KEYS.AGGREGATED });
      }, 200);
    },
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

    // Get wallet address for outbox repository
    const wallet = walletRepo.getWallet();
    if (wallet?.address) {
      outboxRepo.setCurrentAddress(wallet.address);
    }

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

    // 5. CRITICAL: Sync to IPFS and WAIT for success
    try {
      const ipfsService = IpfsStorageService.getInstance(identityManager);
      const syncResult = await ipfsService.syncNow();

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

    // 6. Update status: ready to submit
    outboxRepo.updateEntry(outboxEntry.id, { status: "READY_TO_SUBMIT" });

    // 7. NOW safe to submit to aggregator (idempotent - REQUEST_ID_EXISTS is OK)
    const client = ServiceProvider.stateTransitionClient;
    const res = await client.submitTransferCommitment(transferCommitment);

    if (res.status !== "SUCCESS" && res.status !== "REQUEST_ID_EXISTS") {
      // Recover token before marking outbox as failed
      try {
        const uiToken = walletRepo.getTokens().find(t => t.id === uiId);
        const identity = await identityManager.getCurrentIdentity();
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
            window.dispatchEvent(new Event("wallet-updated"));
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

    // 13. Archive and remove token from active wallet
    walletRepo.removeToken(uiId, recipientNametag);

    // 14. Mark outbox entry as completed
    outboxRepo.updateEntry(outboxEntry.id, { status: "COMPLETED" });
    console.log(`📤 Direct transfer completed - outbox entry ${outboxEntry.id.slice(0, 8)}... marked complete`);

    // 15. Final IPFS sync to update outbox status
    try {
      const ipfsService = IpfsStorageService.getInstance(identityManager);
      await ipfsService.syncNow();
    } catch (err) {
      console.warn(`📤 Final IPFS sync after transfer failed:`, err);
      // Non-critical - token is transferred, outbox will be cleaned up later
    }
  };

  const saveChangeTokenToWallet = (sdkToken: SdkToken<any>, coinId: string) => {
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
    walletRepo.addToken(uiToken, true); // Skip history for change token
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

    tokens: tokensQuery.data || [],
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
