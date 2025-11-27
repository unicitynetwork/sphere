import { IdentityManager } from "../services/IdentityManager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NostrService } from "../services/NostrService";
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

export const KEYS = {
  IDENTITY: ["wallet", "identity"],
  TOKENS: ["wallet", "tokens"],
  PRICES: ["market", "prices"],
  REGISTRY: ["market", "registry"],
  AGGREGATED: ["wallet", "aggregated"],
  NAMETAG: ["wallet", "nametag"],
};

const TOKENS_STORAGE_KEY = "unicity_wallet_tokens";
const loadTokensFromStorage = (): Token[] => {
  const raw = localStorage.getItem(TOKENS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parsed.map((t: Partial<Token>) => new Token(t));
  } catch (e) {
    console.error("Failed to parse tokens", e);
    return [];
  }
};

const saveTokensToStorage = (tokens: Token[]) => {
  localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
};

const SESSION_KEY = "user-pin-1234";
const identityManager = new IdentityManager(SESSION_KEY);
const walletRepo = WalletRepository.getInstance();
const nametagService = NametagService.getInstance(identityManager);
const nostrService = NostrService.getInstance(identityManager);
const registryService = RegistryService.getInstance();

export const useWallet = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
        const handleWalletUpdate = () => {
            console.log("♻️ Wallet update detected! Force refreshing...");
            queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
            queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
        };

        window.addEventListener('wallet-updated', handleWalletUpdate);
        return () => window.removeEventListener('wallet-updated', handleWalletUpdate);
    }, [queryClient]);

  const identityQuery = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: () => identityManager.getCurrentIdentity(),
    staleTime: Infinity,
  });

  const nametagQuery = useQuery({
    queryKey: KEYS.NAMETAG,
    queryFn: () => nametagService.getActiveNametag(),
  });

  const pricesQuery = useQuery({
    queryKey: KEYS.PRICES,
    queryFn: ApiService.fetchPrices,
    refetchInterval: 60000,
  });

  const tokensQuery = useQuery({
    queryKey: KEYS.TOKENS,
    queryFn: async () => {
      return walletRepo.getTokens();
    },
    enabled: !!identityQuery.data,
  });

  const aggregatedAssetsQuery = useQuery({
    queryKey: KEYS.AGGREGATED,
    queryFn: async () => {
      const tokens = tokensQuery.data || [];

      console.log("📊 Aggregating tokens:", tokens);

      const prices = pricesQuery.data || {};

      const groupedTokens: Record<string, Token[]> = {};

      tokens.forEach((token) => {
        if (
          token.status === TokenStatus.BURNED ||
          token.status === TokenStatus.TRANSFERRED
        )
          return;
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

      const currentTokens = loadTokensFromStorage();
      const updatedTokens = currentTokens.filter((t) => t.id !== token.id);
      saveTokensToStorage(updatedTokens);

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
      queryClient.invalidateQueries({ queryKey: KEYS.AGGREGATED });
    },
  });

  return {
    identity: identityQuery.data,
    isLoadingIdentity: identityQuery.isLoading,

    nametag: nametagQuery.data,
    isLoadingNametag: nametagQuery.isLoading,

    assets: aggregatedAssetsQuery.data || [],
    isLoadingAssets: aggregatedAssetsQuery.isLoading,

    tokens: tokensQuery.data || [],
    createWallet: createWalletMutation.mutateAsync,
    mintNametag: mintNametagMutation.mutateAsync,

    sendToken: sendTokenMutation.mutateAsync,
    isSending: sendTokenMutation.isPending,
  };
};
