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
import type { NametagData } from "./types/TxfTypes";
import {
  getNametagForAddress,
  setNametagForAddress,
} from "./InventorySyncService";
import { OutboxRepository } from "../../../../repositories/OutboxRepository";
import { createMintOutboxEntry, type MintOutboxEntry } from "./types/OutboxTypes";
import { IpfsStorageService, SyncPriority } from "./IpfsStorageService";
import { normalizeSdkTokenToStorage } from "./TxfSerializer";
import type { StateTransitionClient } from "@unicitylabs/state-transition-sdk/lib/StateTransitionClient";
import type { InclusionProof } from "@unicitylabs/state-transition-sdk/lib/transaction/InclusionProof";

const UNICITY_TOKEN_TYPE_HEX =
  "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

/**
 * Wait for inclusion proof WITHOUT verification (dev mode only).
 * This polls the aggregator until a proof is available, but skips trust base verification.
 */
async function waitInclusionProofNoVerify(
  client: StateTransitionClient,
  commitment: MintCommitment<any>,
  signal: AbortSignal = AbortSignal.timeout(10000),
  interval: number = 1000
): Promise<InclusionProof> {
  while (!signal.aborted) {
    try {
      const response = await client.getInclusionProof(commitment.requestId);
      if (response.inclusionProof) {
        console.warn("⚠️ Returning inclusion proof WITHOUT verification (dev mode)");
        return response.inclusionProof;
      }
    } catch (err: any) {
      // 404 means proof not ready yet, keep polling
      if (err?.status !== 404) {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Timeout waiting for inclusion proof");
}

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
    // Skip verification in dev mode if trust base verification is disabled
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      console.warn("⚠️ Skipping nametag availability check (trust base verification disabled)");
      return true;
    }

    const nametagTokenId = await TokenId.fromNameTag(nametag);
    const isAlreadyMinted = await ServiceProvider.stateTransitionClient.isMinted(
      ServiceProvider.getRootTrustBase(),
      nametagTokenId
    );
    return !isAlreadyMinted;
  }

  async mintNametagAndPublish(nametag: string): Promise<MintResult> {
    try {
      const cleanTag = nametag.replace("@unicity", "").replace("@", "").trim();
      console.log(`Starting mint process for: ${cleanTag}`);

      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity)
        return { status: "error", message: "Wallet identity not found" };

      // Check if identity already has a nametag (prevent duplicates)
      const existingNametag = getNametagForAddress(identity.address);
      if (existingNametag) {
        return {
          status: "error",
          message: `Identity already has a nametag: ${existingNametag.name}`,
        };
      }

      // Check if there's already a pending mint for this nametag (prevent duplicate mints)
      const outboxRepo = OutboxRepository.getInstance();
      if (outboxRepo.isNametagMintInProgress(cleanTag)) {
        return {
          status: "error",
          message: `A mint for nametag "${cleanTag}" is already in progress`,
        };
      }

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

  /**
   * Mint a nametag on the blockchain using the safe outbox pattern.
   *
   * CRITICAL SAFETY: The salt and commitment data are saved to the outbox
   * and synced to IPFS BEFORE submitting to the aggregator. This ensures
   * that if the app crashes after submission, the mint can be recovered.
   *
   * Flow:
   * 1. Generate salt and create MintTransactionData + MintCommitment
   * 2. Save to outbox IMMEDIATELY (before network calls)
   * 3. Sync to IPFS and wait for success (abort if fails)
   * 4. Submit to aggregator (with retries)
   * 5. Wait for inclusion proof
   * 6. Create final token with proof
   * 7. Update outbox and save to storage
   */
  private async mintNametagOnBlockchain(
    nametag: string,
    ownerAddress: DirectAddress,
    secret: Buffer
  ): Promise<Token<any> | null> {
    const outboxRepo = OutboxRepository.getInstance();
    let outboxEntryId: string | null = null;

    try {
      const client = ServiceProvider.stateTransitionClient;
      const rootTrustBase = ServiceProvider.getRootTrustBase();

      const nametagTokenId = await TokenId.fromNameTag(nametag);
      const nametagTokenType = new TokenType(
        Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex")
      );

      // 1. Generate salt ONCE (CRITICAL: must be saved before any network calls)
      const salt = Buffer.alloc(32);
      window.crypto.getRandomValues(salt);

      // 2. Create mint transaction data with the salt
      const mintData = await MintTransactionData.createFromNametag(
        nametag,
        nametagTokenType,
        ownerAddress,
        salt,
        ownerAddress
      );

      // 3. Create commitment (derives requestId)
      const commitment = await MintCommitment.create(mintData);

      // 4. ⭐ SAVE TO OUTBOX BEFORE ANY NETWORK CALLS
      // Note: ownerAddress is stored in mintDataJson, so we just store its string representation for reference
      const outboxEntry: MintOutboxEntry = createMintOutboxEntry(
        "MINT_NAMETAG",
        UNICITY_TOKEN_TYPE_HEX,
        ownerAddress.address, // Store the address string
        salt.toString("hex"),
        commitment.requestId.toString(),
        JSON.stringify(mintData.toJSON()),
        nametag
      );

      outboxRepo.addMintEntry(outboxEntry);
      outboxEntryId = outboxEntry.id;
      console.log(`📦 Saved mint commitment to outbox: ${outboxEntryId}`);

      // 5. ⭐ SYNC TO IPFS BEFORE SUBMITTING TO AGGREGATOR
      // Uses HIGH priority so it jumps ahead of auto-syncs in the queue
      try {
        const ipfsService = IpfsStorageService.getInstance(this.identityManager);
        await ipfsService.syncNow({
          forceIpnsPublish: true,
          priority: SyncPriority.HIGH,
          timeout: 60000,
          callerContext: 'nametag-mint-pre-submit',
        });
        outboxRepo.updateMintEntry(outboxEntryId, { status: "READY_TO_SUBMIT" });
        console.log(`📦 IPFS sync complete, ready to submit`);
      } catch (ipfsError) {
        console.error("IPFS sync failed, aborting mint:", ipfsError);
        outboxRepo.removeMintEntry(outboxEntryId);
        throw new Error("IPFS sync failed - mint aborted for safety");
      }

      // 6. Submit to aggregator (with retries - same commitment can be resubmitted)
      const MAX_RETRIES = 3;
      let submitSuccess = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`Submitting commitment (attempt ${attempt})...`);
          const response = await client.submitMintCommitment(commitment);

          if (response.status === "SUCCESS" || response.status === "REQUEST_ID_EXISTS") {
            console.log(`Commitment ${response.status === "REQUEST_ID_EXISTS" ? "already exists" : "success"}!`);
            submitSuccess = true;
            break;
          } else {
            console.warn(`Commitment failed: ${response.status}`);
            if (attempt === MAX_RETRIES) {
              throw new Error(`Failed after ${MAX_RETRIES} attempts: ${response.status}`);
            }
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        } catch (error) {
          console.error(`Attempt ${attempt} error`, error);
          if (attempt === MAX_RETRIES) throw error;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      if (!submitSuccess) {
        throw new Error("Failed to submit commitment after retries");
      }

      outboxRepo.updateMintEntry(outboxEntryId, { status: "SUBMITTED" });
      console.log("Waiting for inclusion proof...");

      // 7. Wait for inclusion proof
      const inclusionProof = ServiceProvider.isTrustBaseVerificationSkipped()
        ? await waitInclusionProofNoVerify(client, commitment)
        : await waitInclusionProof(rootTrustBase, client, commitment);

      // 8. Create genesis transaction from proof
      const genesisTransaction = commitment.toTransaction(inclusionProof);

      // Update outbox with proof
      outboxRepo.updateMintEntry(outboxEntryId, {
        status: "PROOF_RECEIVED",
        inclusionProofJson: JSON.stringify(inclusionProof.toJSON()),
        mintTransactionJson: JSON.stringify(genesisTransaction.toJSON()),
      });

      // 9. Create final token
      const signingService = await SigningService.createFromSecret(secret);
      const nametagPredicate = await UnmaskedPredicate.create(
        nametagTokenId,
        nametagTokenType,
        signingService,
        HashAlgorithm.SHA256,
        salt
      );

      let token: Token<any>;
      if (ServiceProvider.isTrustBaseVerificationSkipped()) {
        console.warn("⚠️ Creating token WITHOUT verification (dev mode)");
        const tokenState = new TokenState(nametagPredicate, null);
        const tokenJson = {
          version: "2.0",
          state: tokenState.toJSON(),
          genesis: genesisTransaction.toJSON(),
          transactions: [],
          nametags: [],
        };
        token = await Token.fromJSON(tokenJson);
      } else {
        token = await Token.mint(
          rootTrustBase,
          new TokenState(nametagPredicate, null),
          genesisTransaction
        );
      }

      // 10. Update outbox with final token and mark complete
      outboxRepo.updateMintEntry(outboxEntryId, {
        status: "COMPLETED",
        tokenJson: JSON.stringify(normalizeSdkTokenToStorage(token.toJSON())),
      });

      console.log(`✅ Nametag minted: ${nametag}`);
      return token;
    } catch (error) {
      console.error("Minting on blockchain failed", error);
      if (outboxEntryId) {
        const entry = outboxRepo.getMintEntry(outboxEntryId);
        outboxRepo.updateMintEntry(outboxEntryId, {
          lastError: error instanceof Error ? error.message : String(error),
          retryCount: (entry?.retryCount || 0) + 1,
        });
      }
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

    // Store nametag via InventorySyncService (per-identity, per TOKEN_INVENTORY_SPEC.md Section 6.1)
    setNametagForAddress(identity.address, nametagData);
  }

  async getActiveNametag(): Promise<string | null> {
    // Get nametag via InventorySyncService (per-identity, per TOKEN_INVENTORY_SPEC.md Section 6.1)
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) return null;

    const nametag = getNametagForAddress(identity.address);
    return nametag?.name || null;
  }

  /**
   * Refresh the nametag token's inclusion proof from the aggregator.
   * This is needed before using the nametag in token finalization,
   * as the SDK verifies the nametag's proof against the current root trust base.
   *
   * @returns The refreshed token, or null if refresh failed
   */
  async refreshNametagProof(): Promise<Token<any> | null> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.log("📦 No identity - cannot refresh nametag proof");
      return null;
    }

    const nametagData = getNametagForAddress(identity.address);
    if (!nametagData || !nametagData.token) {
      console.log("📦 No nametag token to refresh");
      return null;
    }

    const nametagTxf = nametagData.token as any;

    // Validate token structure
    if (!nametagTxf.genesis?.data?.salt) {
      console.error("📦 Nametag token missing genesis data or salt");
      return null;
    }

    try {
      console.log(`📦 Refreshing nametag proof for "${nametagData.name}"...`);

      // Reconstruct the MintCommitment to get the correct requestId
      const genesisData = nametagTxf.genesis.data;
      const mintDataJson = {
        tokenId: genesisData.tokenId,
        tokenType: genesisData.tokenType,
        tokenData: genesisData.tokenData || null,
        coinData: genesisData.coinData && genesisData.coinData.length > 0 ? genesisData.coinData : null,
        recipient: genesisData.recipient,
        salt: genesisData.salt,
        recipientDataHash: genesisData.recipientDataHash,
        reason: genesisData.reason ? JSON.parse(genesisData.reason) : null,
      };

      const mintTransactionData = await MintTransactionData.fromJSON(mintDataJson);
      const commitment = await MintCommitment.create(mintTransactionData);
      const requestId = commitment.requestId;

      console.log(`📦 Fetching fresh proof for requestId: ${requestId.toJSON().slice(0, 16)}...`);

      // Fetch fresh proof from aggregator
      const client = ServiceProvider.stateTransitionClient;
      const response = await client.getInclusionProof(requestId);

      if (!response.inclusionProof) {
        console.warn("📦 No inclusion proof available from aggregator");
        // Return the existing token without update
        return await Token.fromJSON(nametagTxf);
      }

      // Check if it's an inclusion proof (has authenticator) vs exclusion proof
      if (response.inclusionProof.authenticator === null) {
        console.warn("📦 Got exclusion proof - nametag may need re-minting");
        return await Token.fromJSON(nametagTxf);
      }

      // Update the token with fresh proof
      const newProofJson = response.inclusionProof.toJSON();
      nametagTxf.genesis.inclusionProof = newProofJson;

      // Save updated token back to storage via InventorySyncService
      setNametagForAddress(identity.address, { ...nametagData, token: nametagTxf });

      console.log(`✅ Nametag proof refreshed successfully`);

      // Return the updated token
      return await Token.fromJSON(nametagTxf);
    } catch (error) {
      console.error("📦 Failed to refresh nametag proof:", error);
      // Return existing token on error - let caller decide how to handle
      try {
        return await Token.fromJSON(nametagTxf);
      } catch {
        return null;
      }
    }
  }

  /**
   * Get the nametag token for the current identity
   * Returns at most one token (one nametag per identity)
   */
  async getNametagToken(): Promise<Token<any> | null> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) return null;

    const nametagData = getNametagForAddress(identity.address);
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
