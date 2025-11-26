import { IdentityManager } from "../services/IdentityManager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NostrService } from "../services/NostrService";
import { AggregatedAsset, Token } from "../data/model";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { randomBytes } from "crypto";
import { ServiceProvider } from "../services/ServiceProvider";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { ApiService } from "../services/api";

export const KEYS = {
  IDENTITY: ["wallet", "identity"],
  TOKENS: ["wallet", "tokens"],
  PRICES: ["market", "prices"],
  REGISTRY: ["market", "registry"],
  AGGREGATED: ["wallet", "aggregated"],
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

export const useWallet = () => {
  const queryClient = useQueryClient();
  const nostrService = NostrService.getInstance(identityManager);

  const identityQuery = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: () => identityManager.getCurrentIdentity(),
  });

  const pricesQuery = useQuery({
    queryKey: KEYS.PRICES,
    queryFn: ApiService.fetchPrices,
    refetchInterval: 60000,
  });

  const registryQuery = useQuery({
    queryKey: KEYS.REGISTRY,
    queryFn: ApiService.fetchRegistry,
    staleTime: Infinity,
  });

  const tokensQuery = useQuery({
    queryKey: KEYS.TOKENS,
    queryFn: async () => {
      return loadTokensFromStorage();
    },
    enabled: !!identityQuery.data,
  });

  const aggregatedAssetsQuery = useQuery({
    queryKey: KEYS.AGGREGATED,
    queryFn: async () => {
      const tokens = tokensQuery.data || [];
      const prices = pricesQuery.data || {};
      const registry = registryQuery.data || [];

      const groupedTokens: Record<string, Token[]> = {};

      tokens.forEach((token) => {
        const key = token.coinId || token.id || "unknown";
        if (!groupedTokens[key]) groupedTokens[key] = [];
        groupedTokens[key].push(token);
      });

      const assets: AggregatedAsset[] = Object.keys(groupedTokens).map(
        (coinId) => {
          const group = groupedTokens[coinId];
          const firstToken = group[0];

          const def = registry.find((r) => r.id === coinId);

          let totalAmount = BigInt(0);
          group.forEach((t) => {
            if (t.amount) totalAmount += BigInt(t.amount);
          });

          const ticker = def?.symbol || firstToken.symbol || "UNK";
          const priceKey =
            ticker.toLowerCase() === "btc"
              ? "bitcoin"
              : ticker.toLowerCase() === "eth"
              ? "ethereum"
              : ticker.toLowerCase() === "sol"
              ? "solana"
              : "tether";

          const priceData = prices[priceKey];

          return new AggregatedAsset({
            coinId: coinId,
            symbol: ticker,
            name: def?.name || firstToken.name,
            totalAmount: totalAmount.toString(),
            decimals: def?.decimals || 8,
            tokenCount: group.length,
            iconUrl: def?.icons?.[0]?.url || firstToken.iconUrl,
            priceUsd: priceData?.priceUsd || 0,
            priceEur: priceData?.priceEur || 0,
            change24h: priceData?.change24h || 0,
          });
        }
      );

      return assets;
    },
    enabled: !!tokensQuery.data && !!pricesQuery.data,
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
      const salt = randomBytes(32);

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

      const payload = {
        sourceToken: sourceToken.toJSON(),
        transferTx: transferTx.toJSON(),
      };

      const payloadJson = JSON.stringify(payload);

      const sent = await nostrService.sendTokenTransfer(
        recipientPubkey,
        payloadJson
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
    
    assets: aggregatedAssetsQuery.data || [],
    isLoadingAssets: aggregatedAssetsQuery.isLoading,

    tokens: tokensQuery.data || [],

    sendToken: sendTokenMutation.mutateAsync,
    isSending: sendTokenMutation.isPending,
  };
};
