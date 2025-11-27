/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { TokenStatus, Token as UiToken } from "../data/model";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import type { IdentityManager } from "./IdentityManager";
import { NametagService } from "./NametagService";
import { TransferTransaction } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction";
import { AddressScheme } from "@unicitylabs/state-transition-sdk/lib/address/AddressScheme";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";
import { ServiceProvider } from "./ServiceProvider";
import type { IAddress } from "@unicitylabs/state-transition-sdk/lib/address/IAddress";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { v4 as uuidv4 } from "uuid";
import { RegistryService } from "./RegistryService";

export class TransferService {
  private static instance: TransferService;
  private identityManager: IdentityManager;
  private walletRepo: WalletRepository;
  private nametagService: NametagService;
  private registryService: RegistryService;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
    this.walletRepo = WalletRepository.getInstance();
    this.nametagService = NametagService.getInstance(identityManager);
    this.registryService = RegistryService.getInstance();
  }

  static getInstance(identityManager: IdentityManager): TransferService {
    if (!TransferService.instance) {
      TransferService.instance = new TransferService(identityManager);
    }
    return TransferService.instance;
  }

  async handleIncomingPackage(payloadJson: string): Promise<void> {
    try {
      const payload = JSON.parse(payloadJson);

      if (!payload.sourceToken || !payload.transferTx) {
        console.warn("Invalid transfer payload format");
        return;
      }

      console.log("Processing incoming transfer ...");

      console.log(payload);

      const sourceToken = await Token.fromJSON(JSON.parse(payload.sourceToken));
      const transferTx = await TransferTransaction.fromJSON(
        JSON.parse(payload.transferTx)
      );

      await this.finalizeTransfer(sourceToken, transferTx);
    } catch (error) {
      console.error("Error handling incoming package", error);
    }
  }

  private async finalizeTransfer(
    sourceToken: Token<any>,
    transferTx: TransferTransaction
  ) {
    try {
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) throw new Error("No identity");

      const recipientAddress = transferTx.data.recipient;

      if (recipientAddress.scheme === AddressScheme.PROXY) {
        console.log("Transfer is to PROXY address");

        const myNametagToken = await this.findMyNametagToken(recipientAddress);

        if (!myNametagToken) {
          console.error("Received transfer for unknown nametag proxy");
          return;
        }

        const secret = Buffer.from(identity.privateKey, "hex");
        const signingService = await SigningService.createFromSecret(secret);

        const transferSalt = transferTx.data.salt;

        const recipientPredicate = await UnmaskedPredicate.create(
          sourceToken.id,
          sourceToken.type,
          signingService,
          HashAlgorithm.SHA256,
          transferSalt
        );

        const recipientState = new TokenState(recipientPredicate, null);

        console.log("Finalizing transaction with SDK...");
        const client = ServiceProvider.stateTransitionClient;
        const trustBase = ServiceProvider.getRootTrustBase();

        const finalizedToken = await client.finalizeTransaction(
          trustBase,
          sourceToken,
          recipientState,
          transferTx,
          [myNametagToken]
        );

        console.log("✅ Transfer finalized!");
        this.saveReceivedToken(finalizedToken);
      } else {
        // DIRECT ADDRESS (Will be supported later)
        console.log("Direct transfer (saving as is)");
        this.saveReceivedToken(sourceToken);
      }
    } catch (error) {
      console.error("Finalization failed", error);
    }
  }

  private async findMyNametagToken(
    targetAddress: IAddress
  ): Promise<Token<any> | null> {
    const myNametags = await this.nametagService.getAllNametagTokens();
    console.log(myNametags);

    for (const sdkToken of myNametags) {
      try {
        const proxy = await ProxyAddress.fromTokenId(sdkToken.id);

        if (proxy.address === targetAddress.address) {
          return sdkToken;
        }
      } catch {
        continue;
      }
    }

    console.warn(
      `No matching nametag found for proxy address: ${targetAddress.toString()}`
    );
    return null;
  }

  private saveReceivedToken(sdkToken: Token<any>) {
    let amount = undefined;
    let coinId = undefined;
    let symbol = undefined;
    let iconUrl = undefined;

    const coinsOpt = sdkToken.coins;

    const coinData = coinsOpt;

    if (coinData && coinData.coins) {
      const rawCoins = coinData.coins;
      console.log("🔍 Raw Coins:", rawCoins);

      let key: any = null;
      let val: any = null;

      if (Array.isArray(rawCoins)) {
        const firstItem = rawCoins[0];
        if (Array.isArray(firstItem) && firstItem.length === 2) {
          key = firstItem[0];
          val = firstItem[1];
        } else {
          console.warn("Unknown array format", firstItem);
        }
      }
      else if (typeof rawCoins === "object") {
        const keys = Object.keys(rawCoins);
        if (keys.length > 0) {
          key = keys[0];
          val = (rawCoins as any)[key];
        }
      }

      if (val) {
        amount = val.toString();
      }

      if (key) {
        console.log("🔑 Processing Key:", key);
        const bytes = key.data || key;
        coinId = Buffer.from(bytes).toString("hex");
      }
    }

    console.log(`✅ FINAL PARSE: CoinID=${coinId}, Amount=${amount}`);

    if (!coinId || amount === "0" || coinId === "0" || coinId === "undefined") {
      console.error("❌ Invalid token data. Skipping.");
      return;
    }

    if (coinId) {
      const def = this.registryService.getCoinDefinition(coinId);
      if (def) {
        symbol = def.symbol || "UNK";
        iconUrl = this.registryService.getIconUrl(def) || undefined;
      }
    }

    const uiToken = new UiToken({
      id: uuidv4(),
      name: symbol ? symbol : "Unicity Token",
      type: sdkToken.type.toString(),
      symbol: symbol,
      jsonData: JSON.stringify(sdkToken.toJSON()),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl,
      timestamp: Date.now(),
    });

    this.walletRepo.addToken(uiToken);

    setTimeout(() => {
      console.log("🚀 Dispatching UI update event...");
      window.dispatchEvent(new Event("wallet-updated"));
    }, 200);
  }
}
