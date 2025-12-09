/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AggregatedAsset, Token, TokenStatus } from "../data/model";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { ServiceProvider } from "../services/ServiceProvider";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { ApiService } from "../services/api";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { NametagService } from "../services/NametagService";
import { RegistryService } from "../services/RegistryService";
import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { TokenSplitExecutor } from "../services/transfer/TokenSplitExecutor";
import { TokenSplitCalculator } from "../services/transfer/TokenSplitCalculator";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import { IpfsStorageService } from "../services/IpfsStorageService";
import { useServices } from "../../../../contexts/useServices";
import type { NostrService } from "../services/NostrService";

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

    window.addEventListener("wallet-updated", handleWalletUpdate);
    return () => window.removeEventListener("wallet-updated", handleWalletUpdate);
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

      return nametagService.getActiveNametag();
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
    ],
    queryFn: async () => {
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
    enabled: !!tokensQuery.data,
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

      const inclusionProof = await waitInclusionProof(
        ServiceProvider.getRootTrustBase(),
        client,
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
        const executor = new TokenSplitExecutor();

        const splitResult = await executor.executeSplitPlan(
          plan,
          recipientAddress,
          signingService,
          (burnedId) => walletRepo.removeToken(burnedId, undefined, true) // Skip history for split
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

          const sourceTokenString = JSON.stringify(token.toJSON());
          const transferTxString = JSON.stringify(tx.toJSON());

          const payload = JSON.stringify({
            sourceToken: sourceTokenString,
            transferTx: transferTxString,
          });

          console.log("📨 Sending split token via Nostr...");
          await nostrService.sendTokenTransfer(recipientPubkey, payload, undefined, undefined, params.eventId);
        }

        for (const keptToken of splitResult.tokensKeptBySender) {
          saveChangeTokenToWallet(keptToken, params.coinId);
        }
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

    const client = ServiceProvider.stateTransitionClient;
    const res = await client.submitTransferCommitment(transferCommitment);
    if (res.status !== "SUCCESS")
      throw new Error(`Direct transfer failed: ${res.status}`);

    const proof = await waitInclusionProof(
      ServiceProvider.getRootTrustBase(),
      client,
      transferCommitment
    );

    const tx = transferCommitment.toTransaction(proof);

    const sourceTokenString = JSON.stringify(sourceToken.toJSON());
    const transferTxString = JSON.stringify(tx.toJSON());

    const payload = JSON.stringify({
      sourceToken: sourceTokenString,
      transferTx: transferTxString,
    });

    await nostr.sendTokenTransfer(recipientPubkey, payload);

    walletRepo.removeToken(uiId, recipientNametag);
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

    const uiToken = new Token({
      id: uuidv4(),
      name: def?.symbol || "Change Token",
      symbol: def?.symbol || "UNK",
      type: "Fungible",
      jsonData: JSON.stringify(sdkToken.toJSON()),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl ? iconUrl : undefined,
      timestamp: Date.now(),
    });

    console.log(`💾 Saving change token: ${amount} ${def?.symbol}`);
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
  };
};
