/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { IdentityManager } from "./IdentityManager";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType";
import { NostrService } from "./NostrService";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { ServiceProvider } from "./ServiceProvider";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment";
import type { DirectAddress } from "@unicitylabs/state-transition-sdk/lib/address/DirectAddress";
import { MintTransactionData } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";

const UNICITY_TOKEN_TYPE_HEX =
  "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

export type MintResult =
  | { status: "success"; token: Token<any> }
  | { status: "warning"; token: Token<any>; message: string }
  | { status: "error"; message: string };

const STORAGE_KEY_NAMETAGS = "unicity_nametags_registry";

export class NametagService {
  private static instance: NametagService;

  private identityManager: IdentityManager;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  static getInstance(identityManager: IdentityManager): NametagService {
    if (!NametagService.instance) {
      NametagService.instance = new NametagService(identityManager);
    }
    return NametagService.instance;
  }

  async mintNametagAndPublish(nametag: string): Promise<MintResult> {
    try {
      const cleanTag = nametag.replace("@unicity", "").replace("@", "").trim();
      console.log(`Starting mint process for: ${cleanTag}`);

      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity)
        return { status: "error", message: "Wallet identity not found" };

      const secret = Buffer.from(identity.privateKey, "hex");

      const ownerAddress = await this.identityManager.getWalletAddress();
      if (!ownerAddress)
        return { status: "error", message: "Failed to derive owner address" };

      const sdkToken = await this.mintNametagOnBlockchain(
        cleanTag,
        ownerAddress,
        secret
      );
      if (!sdkToken) {
        return {
          status: "error",
          message: "Failed to mint nametag on blockchain",
        };
      }

      this.saveNametagToStorage(cleanTag, sdkToken);

      try {
        const nostr = NostrService.getInstance(this.identityManager);
        await nostr.start();

        const proxyAddress = await ProxyAddress.fromNameTag(cleanTag);
        console.log(`Publishing binding: ${cleanTag} -> ${proxyAddress}`);

        const published = await nostr.publishNametagBinding(
          cleanTag,
          proxyAddress.address
        );

        if (published) {
          return { status: "success", token: sdkToken };
        } else {
          return {
            status: "warning",
            token: sdkToken,
            message: "Minted locally, but Nostr publish failed",
          };
        }
      } catch (e: any) {
        console.error("Nostr error", e);
        return {
          status: "warning",
          token: sdkToken,
          message: `Nostr error: ${e.message}`,
        };
      }
    } catch (error) {
      console.error("Critical error in mintNametagAndPublish", error);
      return { status: "error", message: "Unknown error" };
    }
  }

  private async mintNametagOnBlockchain(
    nametag: string,
    ownerAddress: DirectAddress,
    secret: Buffer
  ): Promise<Token<any> | null> {
    try {
      const client = ServiceProvider.stateTransitionClient;
      const rootTrustBase = ServiceProvider.getRootTrustBase();

      const nametagTokenId = await TokenId.fromNameTag(nametag);

      const nametagTokenType = new TokenType(
        Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex")
      );

      const signingService = await SigningService.createFromSecret(secret);

      const MAX_RETRIES = 3;
      let commitment: MintCommitment<any> | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const salt = Buffer.alloc(32);
          window.crypto.getRandomValues(salt);

          const mintData = await MintTransactionData.createFromNametag(
            nametag,
            nametagTokenType,
            ownerAddress,
            salt,
            ownerAddress
          );

          commitment = await MintCommitment.create(mintData);

          console.log(`Submitting commitment (attempt ${attempt})...`);
          const response = await client.submitMintCommitment(commitment);

          if (response.status === "SUCCESS") {
            console.log("Commitment success!");
            break;
          } else {
            console.warn(`Commitment failed: ${response.status}`);
            if (attempt === MAX_RETRIES)
              throw new Error(`Failed after ${MAX_RETRIES} attempts`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        } catch (error) {
          console.error(`Attempt ${attempt} error`, error);
          if (attempt === MAX_RETRIES) throw error;
        }
      }

      if (!commitment) throw new Error("Failed to create commitment");
      console.log("Waiting for inclusion proof...");
      const inclusionProof = await waitInclusionProof(
        rootTrustBase,
        client,
        commitment
      );

      const genesisTransaction = commitment.toTransaction(inclusionProof);

      const txData = commitment.transactionData;
      const mintSalt = txData.salt;

      const nametagPredicate = await UnmaskedPredicate.create(
        nametagTokenId,
        nametagTokenType,
        signingService,
        HashAlgorithm.SHA256,
        mintSalt
      );

      const token = Token.mint(
        rootTrustBase,
        new TokenState(nametagPredicate, null),
        genesisTransaction
      );

      console.log(`✅ Nametag minted: ${nametag}`);
      return token;
    } catch (error) {
      console.error("Minting on blockchain failed", error);
      return null;
    }
  }

  private saveNametagToStorage(nametag: string, token: Token<any>){
    const nametagData = {
      nametag: nametag,
      token: token.toJSON(),
      timeStamp: Date.now(),
      format: "txf",
      version: "2.0"
    };

    const raw = localStorage.getItem(STORAGE_KEY_NAMETAGS);
    const registry = raw ? JSON.parse(raw) : {};

    registry[nametag] = nametagData;

    localStorage.setItem(STORAGE_KEY_NAMETAGS, JSON.stringify(registry));
  }
}
