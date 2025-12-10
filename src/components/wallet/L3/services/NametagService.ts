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
import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository";

const UNICITY_TOKEN_TYPE_HEX =
  "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

export type MintResult =
  | { status: "success"; token: Token<any> }
  | { status: "warning"; token: Token<any>; message: string }
  | { status: "error"; message: string };

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

  async isNametagAvailable(nametag: string): Promise<boolean> {
    const client = ServiceProvider.stateTransitionClient;
    const rootTrustBase = ServiceProvider.getRootTrustBase();
    const nametagTokenId = await TokenId.fromNameTag(nametag);

    return await !client.isMinted(rootTrustBase, nametagTokenId);
  }

  async mintNametagAndPublish(nametag: string): Promise<MintResult> {
    try {
      const cleanTag = nametag.replace("@unicity", "").replace("@", "").trim();
      console.log(`Starting mint process for: ${cleanTag}`);

      // Check if identity already has a nametag (prevent duplicates)
      const walletRepo = WalletRepository.getInstance();
      const existingNametag = walletRepo.getNametag();
      if (existingNametag) {
        return {
          status: "error",
          message: `Identity already has a nametag: ${existingNametag.name}`,
        };
      }

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

      await this.saveNametagToStorage(cleanTag, sdkToken);

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

  private async saveNametagToStorage(nametag: string, token: Token<any>) {
    const nametagData: NametagData = {
      name: nametag,
      token: token.toJSON(),
      timestamp: Date.now(),
      format: "txf",
      version: "2.0",
    };

    // Ensure wallet is initialized for this identity
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.error("Cannot save nametag: no identity available");
      return;
    }

    const walletRepo = WalletRepository.getInstance();

    // Load or create wallet for this identity's address
    let wallet = walletRepo.getWallet();
    if (!wallet || wallet.address !== identity.address) {
      wallet = walletRepo.loadWalletForAddress(identity.address);
      if (!wallet) {
        wallet = walletRepo.createWallet(identity.address, "My Wallet");
      }
    }

    // Store nametag via WalletRepository (per-identity, not global)
    walletRepo.setNametag(nametagData);
  }

  getActiveNametag(): string | null {
    // Get nametag from WalletRepository (per-identity)
    const nametag = WalletRepository.getInstance().getNametag();
    return nametag?.name || null;
  }

  /**
   * Get the nametag token for the current identity
   * Returns at most one token (one nametag per identity)
   */
  async getNametagToken(): Promise<Token<any> | null> {
    const nametagData = WalletRepository.getInstance().getNametag();
    if (!nametagData) return null;

    try {
      return await Token.fromJSON(nametagData.token);
    } catch (e) {
      console.error("Failed to parse nametag token", e);
      return null;
    }
  }

  /**
   * Get all nametag tokens for the current identity
   * @deprecated Use getNametagToken() instead - each identity has only one nametag
   */
  async getAllNametagTokens(): Promise<Token<any>[]> {
    const token = await this.getNametagToken();
    return token ? [token] : [];
  }
}
