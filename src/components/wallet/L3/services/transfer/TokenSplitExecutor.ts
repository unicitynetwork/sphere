/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IAddress } from "@unicitylabs/state-transition-sdk/lib/address/IAddress";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference";
import { waitInclusionProofWithDevBypass } from "../../../../../utils/devTools";
import { ServiceProvider } from "../ServiceProvider";
import type { SplitPlan } from "./TokenSplitCalculator";
import { Buffer } from "buffer";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import type { TransferTransaction } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction";
import type { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { CoinId } from "@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId";
import { TokenSplitBuilder } from "@unicitylabs/state-transition-sdk/lib/transaction/split/TokenSplitBuilder";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import { TokenCoinData } from "@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment";
import { MintTransactionData } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";
import { OutboxRepository } from "../../../../../repositories/OutboxRepository";
import type { OutboxSplitGroup } from "../types/OutboxTypes";
import { createOutboxEntry } from "../types/OutboxTypes";
import { TokenRecoveryService } from "../TokenRecoveryService";
import { getTokensForAddress, dispatchWalletUpdated } from "../InventorySyncService";

// === Helper Types ===

interface MintedTokenInfo {
  commitment: any; // MintCommitment
  inclusionProof: any; // InclusionProof
  isForRecipient: boolean;
  tokenId: TokenId;
  salt: Uint8Array;
}

interface SplitTokenResult {
  tokenForRecipient: SdkToken<any>;
  tokenForSender: SdkToken<any>;
  recipientTransferTx: TransferTransaction;
  /** Outbox entry ID for tracking Nostr delivery (if outbox enabled) */
  outboxEntryId?: string;
  /** Split group ID for recovery (if outbox enabled) */
  splitGroupId?: string;
}

/**
 * Callback interface for persisting tokens during split operations.
 * This enables the critical "save-before-submit" pattern.
 */
export interface SplitPersistenceCallbacks {
  /**
   * Called immediately after a minted token proof is received.
   * The caller MUST save this token to localStorage before returning.
   * @param token The minted SDK token with proof
   * @param isChangeToken True if this is the sender's change token
   */
  onTokenMinted: (token: SdkToken<any>, isChangeToken: boolean) => Promise<void>;

  /**
   * Called before transfer submission to give caller opportunity to sync to IPFS.
   * Returns true if sync was successful, false to abort transfer.
   */
  onPreTransferSync?: () => Promise<boolean>;
}

// === Helper: SHA-256 ===
async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(hashBuffer);
}

/**
 * Helper to serialize a MintCommitment to JSON.
 * MintCommitment (unlike TransferCommitment) does not have a toJSON() method in the SDK,
 * so we manually extract the serializable properties.
 */
function serializeMintCommitment(commitment: any): object {
  try {
    // Try toJSON first in case SDK is updated
    if (typeof commitment.toJSON === "function") {
      return commitment.toJSON();
    }
    // Manual serialization matching TransferCommitment's structure
    return {
      requestId: commitment.requestId?.toJSON?.() ?? String(commitment.requestId),
      transactionData: commitment.transactionData?.toJSON?.() ?? commitment.transactionData,
      authenticator: commitment.authenticator?.toJSON?.() ?? commitment.authenticator,
    };
  } catch (err) {
    console.warn("Failed to serialize MintCommitment, using fallback:", err);
    // Fallback: store raw object
    return { _raw: "serialization_failed", type: "MintCommitment" };
  }
}

export class TokenSplitExecutor {
  private get client() {
    return ServiceProvider.stateTransitionClient;
  }
  private get trustBase() {
    return ServiceProvider.getRootTrustBase();
  }

  async executeSplitPlan(
    plan: SplitPlan,
    recipientAddress: IAddress,
    signingService: SigningService,
    onTokenBurned: (uiId: string) => void,
    /** Optional outbox context for tracking. If provided, creates outbox entries for recovery. */
    outboxContext?: {
      walletAddress: string;
      recipientNametag: string;
      recipientPubkey: string;
      ownerPublicKey: string;
    },
    /** Optional callbacks for immediate token persistence (critical for safety) */
    persistenceCallbacks?: SplitPersistenceCallbacks
  ): Promise<{
    tokensForRecipient: SdkToken<any>[];
    tokensKeptBySender: SdkToken<any>[];
    burnedTokens: any[];
    recipientTransferTxs: TransferTransaction[];
    /** Outbox entry IDs for tracking Nostr delivery (one per recipient token) */
    outboxEntryIds: string[];
    /** Split group ID for recovery */
    splitGroupId?: string;
  }> {
    console.log(`⚙️ Executing split plan using TokenSplitBuilder...`);

    const result = {
      tokensForRecipient: [] as SdkToken<any>[],
      tokensKeptBySender: [] as SdkToken<any>[],
      burnedTokens: [] as any[],
      recipientTransferTxs: [] as TransferTransaction[],
      outboxEntryIds: [] as string[],
      splitGroupId: undefined as string | undefined,
    };

    if (
      plan.requiresSplit &&
      plan.tokenToSplit &&
      plan.splitAmount &&
      plan.remainderAmount
    ) {
      const coinIdBuffer = Buffer.from(plan.coinId, "hex");
      const coinId = new CoinId(coinIdBuffer);

      const splitResult = await this.executeSingleTokenSplit(
        plan.tokenToSplit.sdkToken,
        plan.splitAmount,
        plan.remainderAmount,
        coinId,
        recipientAddress,
        signingService,
        onTokenBurned,
        plan.tokenToSplit.uiToken.id,
        outboxContext,
        persistenceCallbacks
      );

      result.tokensForRecipient.push(splitResult.tokenForRecipient);
      result.tokensKeptBySender.push(splitResult.tokenForSender);
      result.burnedTokens.push(plan.tokenToSplit.uiToken);
      result.recipientTransferTxs.push(splitResult.recipientTransferTx);

      // Track outbox entries for Nostr delivery
      if (splitResult.outboxEntryId) {
        result.outboxEntryIds.push(splitResult.outboxEntryId);
      }
      if (splitResult.splitGroupId) {
        result.splitGroupId = splitResult.splitGroupId;
      }
    }

    return result;
  }

  private async executeSingleTokenSplit(
    tokenToSplit: SdkToken<any>,
    splitAmount: bigint,
    remainderAmount: bigint,
    coinId: CoinId,
    recipientAddress: IAddress,
    signingService: SigningService,
    onTokenBurned: (uiId: string) => void,
    uiTokenId: string,
    outboxContext?: {
      walletAddress: string;
      recipientNametag: string;
      recipientPubkey: string;
      ownerPublicKey: string;
    },
    persistenceCallbacks?: SplitPersistenceCallbacks
  ): Promise<SplitTokenResult> {
    const tokenIdHex = Buffer.from(tokenToSplit.id.bytes).toString("hex");
    console.log(`🔪 Splitting token ${tokenIdHex.slice(0, 8)}...`);

    const builder = new TokenSplitBuilder();

    const seedString = `${tokenIdHex}_${splitAmount.toString()}_${remainderAmount.toString()}`;

    // Initialize outbox tracking if context provided
    let outboxRepo: OutboxRepository | null = null;
    let splitGroupId: string | undefined;
    let transferEntryId: string | undefined;

    if (outboxContext) {
      outboxRepo = OutboxRepository.getInstance();
      outboxRepo.setCurrentAddress(outboxContext.walletAddress);

      // Create a split group to track this operation
      splitGroupId = crypto.randomUUID();
      const splitGroup: OutboxSplitGroup = {
        groupId: splitGroupId,
        createdAt: Date.now(),
        originalTokenId: uiTokenId,
        seedString: seedString,
        entryIds: [],
      };
      outboxRepo.createSplitGroup(splitGroup);
      console.log(`📤 Outbox: Created split group ${splitGroupId.slice(0, 8)}...`);
    }

    const recipientTokenId = new TokenId(await sha256(seedString));
    const senderTokenId = new TokenId(await sha256(seedString + "_sender"));

    const recipientSalt = await sha256(seedString + "_recipient_salt");
    const senderSalt = await sha256(seedString + "_sender_salt");

    const senderAddressRef = await UnmaskedPredicateReference.create(
      tokenToSplit.type,
      signingService.algorithm,
      signingService.publicKey,
      HashAlgorithm.SHA256
    );
    const senderAddress = await senderAddressRef.toAddress();

    const coinDataA = TokenCoinData.create([[coinId, splitAmount]]);

    builder.createToken(
      recipientTokenId,
      tokenToSplit.type,
      new Uint8Array(0), // tokenData
      coinDataA,
      senderAddress,
      recipientSalt,
      null // dataHash
    );

    const coinDataB = TokenCoinData.create([[coinId, remainderAmount]]);

    builder.createToken(
      senderTokenId,
      tokenToSplit.type,
      new Uint8Array(0),
      coinDataB,
      senderAddress,
      senderSalt,
      null
    );

    // 4. Build Split Object
    const split = await builder.build(tokenToSplit);

    // === STEP 1: BURN ===
    const burnSalt = await sha256(seedString + "_burn_salt");
    const burnCommitment = await split.createBurnCommitment(burnSalt, signingService);

    // Log the BURN RequestId (this is what marks the ORIGINAL token as spent)
    console.log(`🔥 [SplitBurn] RequestId committed: ${burnCommitment.requestId.toString()}`);
    console.log(`   - original token stateHash: ${(await tokenToSplit.state.calculateHash()).toJSON()}`);
    console.log(`   - signingService.publicKey: ${Buffer.from(signingService.publicKey).toString("hex")}`);

    // Create outbox entry for BURN BEFORE submitting to aggregator
    // This ensures we can recover if browser crashes after burn is submitted
    let burnEntryId: string | undefined;
    if (outboxRepo && outboxContext && splitGroupId) {
      const coinIdHex = Buffer.from(coinId.bytes).toString("hex");
      const burnEntry = createOutboxEntry(
        "SPLIT_BURN",
        uiTokenId,
        outboxContext.recipientNametag,
        outboxContext.recipientPubkey,
        JSON.stringify((recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress),
        splitAmount.toString(),
        coinIdHex,
        Buffer.from(burnSalt).toString("hex"),
        JSON.stringify(tokenToSplit.toJSON()),
        JSON.stringify(burnCommitment.toJSON()),
        splitGroupId,
        0 // Index 0 = burn phase
      );
      burnEntry.status = "READY_TO_SUBMIT";
      outboxRepo.addEntry(burnEntry);
      outboxRepo.addEntryToSplitGroup(splitGroupId, burnEntry.id);
      burnEntryId = burnEntry.id;
      console.log(`📤 Outbox: Added SPLIT_BURN entry ${burnEntry.id.slice(0, 8)}...`);
    }

    console.log("🔥 Submitting burn commitment...");
    const burnResponse = await this.client.submitTransferCommitment(burnCommitment);

    if (burnResponse.status === "REQUEST_ID_EXISTS") {
      console.warn("Token already burned, attempting recovery...");
    } else if (burnResponse.status !== "SUCCESS") {
      // Burn failed - original token may still be valid, attempt recovery
      if (outboxContext?.ownerPublicKey && outboxContext?.walletAddress) {
        const tokens = getTokensForAddress(outboxContext.walletAddress);
        const uiToken = tokens.find(t => t.id === uiTokenId);
        if (uiToken) {
          try {
            const recoveryService = TokenRecoveryService.getInstance();
            const recovery = await recoveryService.handleSplitBurnFailure(
              uiToken,
              burnResponse.status,
              outboxContext.ownerPublicKey
            );
            console.log(`📤 Burn failed: ${burnResponse.status}, recovery: ${recovery.action}`);
            if (recovery.tokenRestored || recovery.tokenRemoved) {
              dispatchWalletUpdated();
            }
          } catch (recoveryErr) {
            console.error(`📤 Token recovery after burn failure failed:`, recoveryErr);
          }
        }
      }
      throw new Error(`Burn failed: ${burnResponse.status}`);
    }

    onTokenBurned(uiTokenId);

    const burnInclusionProof = await waitInclusionProofWithDevBypass(burnCommitment);
    const burnTransaction = burnCommitment.toTransaction(burnInclusionProof);

    // Update burn outbox entry with proof
    if (outboxRepo && burnEntryId) {
      outboxRepo.updateEntry(burnEntryId, {
        status: "PROOF_RECEIVED",
        inclusionProofJson: JSON.stringify(burnInclusionProof.toJSON()),
        transferTxJson: JSON.stringify(burnTransaction.toJSON()),
      });
    }

    // === STEP 2: MINT SPLIT TOKENS ===
    console.log("✨ Creating split mint commitments...");

    // Type is intentionally `any[]` because mintCommitments type varies by code path
    let mintCommitments: any[];

    // Dev mode bypass: manually create mint commitments without SDK verification
    // The SDK's createSplitMintCommitments() internally verifies the burn transaction
    // against the trust base, which fails when using dev aggregators
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      console.log("⚠️ Dev mode: bypassing SDK verification for split mint commitments");

      // In dev mode, we create mint commitments without the complex SplitMintReason
      // since the dev aggregator doesn't strictly validate the reason
      // The SDK's SplitMintReason requires Merkle tree proofs we don't have access to

      // Create mint transaction data for recipient token
      const recipientMintData = await MintTransactionData.create(
        recipientTokenId,
        tokenToSplit.type,
        null, // tokenData
        coinDataA, // coin data for recipient amount
        senderAddress,
        Buffer.from(recipientSalt),
        null, // recipientDataHash
        null  // reason - dev mode skip
      );
      const recipientMintCommitment = await MintCommitment.create(recipientMintData);

      // Create mint transaction data for sender (change) token
      const senderMintData = await MintTransactionData.create(
        senderTokenId,
        tokenToSplit.type,
        null, // tokenData
        coinDataB, // coin data for remainder amount
        senderAddress,
        Buffer.from(senderSalt),
        null, // recipientDataHash
        null  // reason - dev mode skip
      );
      const senderMintCommitment = await MintCommitment.create(senderMintData);

      mintCommitments = [senderMintCommitment, recipientMintCommitment];
      console.log("✅ Dev mode: created split mint commitments manually");
    } else {
      // Normal mode: use SDK's createSplitMintCommitments with trust base verification
      mintCommitments = await split.createSplitMintCommitments(
        this.trustBase,
        burnTransaction
      );
    }

    const mintedTokensInfo: MintedTokenInfo[] = [];
    const mintEntryIds: string[] = [];

    // Process each mint commitment with immediate persistence
    for (let i = 0; i < mintCommitments.length; i++) {
      const commitment = mintCommitments[i];
      const commTokenIdHex = Buffer.from(
        commitment.transactionData.tokenId.bytes
      ).toString("hex");
      const recipientIdHex = Buffer.from(recipientTokenId.bytes).toString("hex");
      const senderIdHex = Buffer.from(senderTokenId.bytes).toString("hex");
      const isForRecipient = commTokenIdHex === recipientIdHex;
      const isSenderToken = commTokenIdHex === senderIdHex;

      // Create outbox entry for MINT BEFORE submitting
      let mintEntryId: string | undefined;
      if (outboxRepo && outboxContext && splitGroupId) {
        const coinIdHex = Buffer.from(coinId.bytes).toString("hex");
        const mintEntry = createOutboxEntry(
          "SPLIT_MINT",
          uiTokenId,
          outboxContext.recipientNametag,
          outboxContext.recipientPubkey,
          JSON.stringify((recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress),
          isForRecipient ? splitAmount.toString() : remainderAmount.toString(),
          coinIdHex,
          Buffer.from(commitment.transactionData.salt).toString("hex"),
          JSON.stringify(tokenToSplit.toJSON()), // Source token for reference
          JSON.stringify(serializeMintCommitment(commitment)),
          splitGroupId,
          isForRecipient ? 2 : 1 // Index 1 = sender mint, 2 = recipient mint
        );
        mintEntry.status = "READY_TO_SUBMIT";
        outboxRepo.addEntry(mintEntry);
        outboxRepo.addEntryToSplitGroup(splitGroupId, mintEntry.id);
        mintEntryId = mintEntry.id;
        mintEntryIds.push(mintEntryId);
        console.log(`📤 Outbox: Added SPLIT_MINT entry ${mintEntry.id.slice(0, 8)}... (${isSenderToken ? 'change' : 'recipient'})`);
      }

      // Submit mint to aggregator
      // Log the MINT RequestId (critical for spent detection debugging)
      console.log(`🔑 [SplitMint] RequestId committed for ${isSenderToken ? 'CHANGE' : 'recipient'}: ${commitment.requestId.toString()}`);
      console.log(`   - tokenId: ${commTokenIdHex.slice(0, 16)}...`);

      const res = await this.client.submitMintCommitment(commitment);
      if (res.status !== "SUCCESS" && res.status !== "REQUEST_ID_EXISTS") {
        if (outboxRepo && mintEntryId) {
          outboxRepo.updateStatus(mintEntryId, "FAILED", `Mint failed: ${res.status}`);
        }
        // Mint failed after burn succeeded - original token is burned, but split not complete
        // Attempt to recover: since burn already went through, original token is gone
        // The best we can do is log and let user know
        if (outboxContext?.ownerPublicKey && outboxContext?.walletAddress) {
          const tokens = getTokensForAddress(outboxContext.walletAddress);
          const uiToken = tokens.find(t => t.id === uiTokenId);
          if (uiToken) {
            try {
              const recoveryService = TokenRecoveryService.getInstance();
              // Use handleTransferFailure since original token already burned
              // This will check if the burn was spent and act accordingly
              const recovery = await recoveryService.handleTransferFailure(
                uiToken,
                res.status,
                outboxContext.ownerPublicKey
              );
              console.log(`📤 Mint failed: ${res.status}, recovery: ${recovery.action}`);
              if (recovery.tokenRestored || recovery.tokenRemoved) {
                dispatchWalletUpdated();
              }
            } catch (recoveryErr) {
              console.error(`📤 Token recovery after mint failure failed:`, recoveryErr);
            }
          }
        }
        throw new Error(`Mint split token failed: ${res.status}`);
      }

      // Update outbox: submitted
      if (outboxRepo && mintEntryId) {
        outboxRepo.updateStatus(mintEntryId, "SUBMITTED");
      }

      // Wait for inclusion proof (use dev bypass when trust base verification is skipped)
      const proof = await waitInclusionProofWithDevBypass(commitment);

      // Update outbox: proof received
      if (outboxRepo && mintEntryId) {
        outboxRepo.updateEntry(mintEntryId, {
          status: "PROOF_RECEIVED",
          inclusionProofJson: JSON.stringify(proof.toJSON()),
        });
      }

      mintedTokensInfo.push({
        commitment: commitment,
        inclusionProof: proof,
        isForRecipient: isForRecipient,
        tokenId: commitment.transactionData.tokenId,
        salt: commitment.transactionData.salt,
      });

      // CRITICAL: Save minted token IMMEDIATELY after proof is received
      // This is the key fix - we persist BEFORE continuing with more operations
      if (persistenceCallbacks?.onTokenMinted) {
        try {
          // Reconstruct the token so caller can save it
          const mintedToken = await this.createAndVerifyToken(
            mintedTokensInfo[mintedTokensInfo.length - 1],
            signingService,
            tokenToSplit.type,
            isSenderToken ? "Sender (Change) - Early Persist" : "Recipient (Pre-transfer) - Early Persist"
          );
          const isChangeToken = !isForRecipient;
          console.log(`💾 Persisting minted ${isChangeToken ? 'change' : 'recipient'} token immediately...`);
          await persistenceCallbacks.onTokenMinted(mintedToken, isChangeToken);
        } catch (persistError) {
          console.error(`⚠️ Failed to persist minted token immediately:`, persistError);
          // Don't fail the split - token is on blockchain and can be recovered
        }
      }
    }

    console.log("All split tokens minted on blockchain.");

    // === STEP 3: RECONSTRUCT OBJECTS ===
    const recipientInfo = mintedTokensInfo.find((t) => t.isForRecipient);
    const senderInfo = mintedTokensInfo.find((t) => !t.isForRecipient);

    if (!recipientInfo || !senderInfo)
      throw new Error("Failed to identify split tokens");

    const recipientTokenBeforeTransfer = await this.createAndVerifyToken(
      recipientInfo,
      signingService,
      tokenToSplit.type,
      "Recipient (Pre-transfer)"
    );

    const senderToken = await this.createAndVerifyToken(
      senderInfo,
      signingService,
      tokenToSplit.type,
      "Sender (Change)"
    );

    // === STEP 4: PRE-TRANSFER SYNC CHECKPOINT ===
    // CRITICAL: Sync to IPFS BEFORE transfer to ensure all minted tokens are backed up
    if (persistenceCallbacks?.onPreTransferSync) {
      console.log("📦 Pre-transfer IPFS sync checkpoint...");
      try {
        const syncSuccess = await persistenceCallbacks.onPreTransferSync();
        if (!syncSuccess) {
          // Sync failed but tokens are on blockchain - warn but continue
          // The user's tokens are saved locally and will sync eventually
          console.warn("⚠️ Pre-transfer IPFS sync failed - continuing with local tokens saved");
        } else {
          console.log("✅ Pre-transfer IPFS sync successful");
        }
      } catch (syncError) {
        console.error("⚠️ Pre-transfer IPFS sync error:", syncError);
        // Continue - tokens are on blockchain and in localStorage
      }
    }

    // === STEP 5: TRANSFER TO RECIPIENT ===
    console.log(
      `🚀 Transferring split token to ${recipientAddress.address}...`
    );

    const transferSalt = await sha256(seedString + "_transfer_salt");

    const transferCommitment = await TransferCommitment.create(
      recipientTokenBeforeTransfer,
      recipientAddress,
      transferSalt,
      null,
      null,
      signingService
    );

    // Log the RequestId being committed (for spent detection debugging)
    console.log(`🔑 [SplitTransfer] RequestId committed: ${transferCommitment.requestId.toString()}`);
    console.log(`   - token stateHash: ${(await recipientTokenBeforeTransfer.state.calculateHash()).toJSON()}`);
    console.log(`   - signingService.publicKey: ${Buffer.from(signingService.publicKey).toString("hex")}`);

    // Create outbox entry for transfer tracking BEFORE submitting
    // This is critical for Nostr delivery recovery
    if (outboxRepo && outboxContext && splitGroupId) {
      const coinIdHex = Buffer.from(coinId.bytes).toString("hex");
      const transferEntry = createOutboxEntry(
        "SPLIT_TRANSFER",
        uiTokenId,
        outboxContext.recipientNametag,
        outboxContext.recipientPubkey,
        JSON.stringify((recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress),
        splitAmount.toString(),
        coinIdHex,
        Buffer.from(transferSalt).toString("hex"),
        JSON.stringify(recipientTokenBeforeTransfer.toJSON()),
        JSON.stringify(transferCommitment.toJSON()),
        splitGroupId,
        3 // Index 3 = transfer phase (after burn=0, mint-sender=1, mint-recipient=2)
      );

      // Set status to READY_TO_SUBMIT since IPFS sync should happen at caller level
      transferEntry.status = "READY_TO_SUBMIT";
      outboxRepo.addEntry(transferEntry);
      outboxRepo.addEntryToSplitGroup(splitGroupId, transferEntry.id);
      transferEntryId = transferEntry.id;
      console.log(`📤 Outbox: Added split transfer entry ${transferEntry.id.slice(0, 8)}...`);
    }

    const transferRes = await this.client.submitTransferCommitment(transferCommitment);

    if (
      transferRes.status !== "SUCCESS" &&
      transferRes.status !== "REQUEST_ID_EXISTS"
    ) {
      // Mark outbox entry as failed
      if (outboxRepo && transferEntryId) {
        outboxRepo.updateStatus(transferEntryId, "FAILED", `Transfer failed: ${transferRes.status}`);
      }
      // Transfer of split token failed - the minted recipient token may still be valid
      // This is different from burn failure: original token is gone, but we have minted tokens
      // The recipient token in our wallet can be recovered by reverting to committed state
      if (outboxContext?.ownerPublicKey && outboxContext?.walletAddress) {
        // Find the minted recipient token that we just persisted
        const recipientTokenIdHex = Buffer.from(recipientTokenBeforeTransfer.id.bytes).toString("hex");
        const tokens = getTokensForAddress(outboxContext.walletAddress);
        const mintedToken = tokens.find(t => {
          // Check if this token's SDK token ID matches the recipient token we're trying to transfer
          if (!t.jsonData) return false;
          try {
            const tokenData = JSON.parse(t.jsonData);
            if (tokenData?.id?.bytes) {
              const tokenIdHex = Buffer.from(tokenData.id.bytes).toString("hex");
              return tokenIdHex === recipientTokenIdHex;
            }
          } catch { /* ignore parse errors */ }
          return false;
        });
        if (mintedToken) {
          try {
            const recoveryService = TokenRecoveryService.getInstance();
            const recovery = await recoveryService.handleTransferFailure(
              mintedToken,
              transferRes.status,
              outboxContext.ownerPublicKey
            );
            console.log(`📤 Split transfer failed: ${transferRes.status}, recovery: ${recovery.action}`);
            if (recovery.tokenRestored || recovery.tokenRemoved) {
              dispatchWalletUpdated();
            }
          } catch (recoveryErr) {
            console.error(`📤 Token recovery after split transfer failure failed:`, recoveryErr);
          }
        }
      }
      throw new Error(`Transfer failed: ${transferRes.status}`);
    }

    // Update outbox: submitted
    if (outboxRepo && transferEntryId) {
      outboxRepo.updateStatus(transferEntryId, "SUBMITTED");
    }

    const transferProof = await waitInclusionProofWithDevBypass(transferCommitment);

    const transferTx = transferCommitment.toTransaction(transferProof);

    // Update outbox: proof received (ready for Nostr delivery)
    if (outboxRepo && transferEntryId) {
      outboxRepo.updateEntry(transferEntryId, {
        status: "PROOF_RECEIVED",
        inclusionProofJson: JSON.stringify(transferProof.toJSON()),
        transferTxJson: JSON.stringify(transferTx.toJSON()),
      });
    }

    console.log("✅ Split transfer complete!");

    return {
      tokenForRecipient: recipientTokenBeforeTransfer,
      tokenForSender: senderToken,
      recipientTransferTx: transferTx,
      outboxEntryId: transferEntryId,
      splitGroupId: splitGroupId,
    };
  }

  /**
   * Helper to reconstruct and verify token from mint info
   */
  private async createAndVerifyToken(
    info: MintedTokenInfo,
    signingService: SigningService,
    tokenType: any,
    label: string
  ): Promise<SdkToken<any>> {
    // 1. Recreate Predicate
    const predicate = await UnmaskedPredicate.create(
      info.tokenId,
      tokenType,
      signingService,
      HashAlgorithm.SHA256,
      info.salt
    );

    // 2. Recreate State
    const state = new TokenState(predicate, null); // No data for fungible usually

    // 3. Create Token and Verify
    // Dev mode bypass: use fromJSON instead of mint to avoid trust base verification
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      console.log(`⚠️ Dev mode: creating ${label} token without verification`);
      const genesisTransaction = info.commitment.toTransaction(info.inclusionProof);
      const tokenJson = {
        version: "2.0",
        state: state.toJSON(),
        genesis: genesisTransaction.toJSON(),
        transactions: [],
        nametags: [],
      };
      const token = await SdkToken.fromJSON(tokenJson);

      // Log the state hash for debugging - this MUST match what spent check calculates
      const stateHash = await token.state.calculateHash();
      const tokenIdHex = Buffer.from(info.tokenId.bytes).toString("hex");
      console.log(`🔑 [${label}] Token state hash after creation: ${stateHash.toJSON()}`);
      console.log(`   - tokenId: ${tokenIdHex.slice(0, 16)}...`);
      console.log(`   - This hash should match spent check RequestId calculation`);

      return token;
    }

    // Normal mode: use SDK's mint with trust base verification
    const token = await SdkToken.mint(
      this.trustBase,
      state,
      info.commitment.toTransaction(info.inclusionProof)
    );

    // 4. Verify
    const verification = await token.verify(this.trustBase);

    if (!verification.isSuccessful) {
      console.error(`Verification failed for ${label}`, verification);
      throw new Error(`Token verification failed: ${verification}`);
    }

    return token;
  }
}
