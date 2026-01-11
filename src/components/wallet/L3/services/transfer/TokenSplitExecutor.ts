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
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";
import { OutboxRepository } from "../../../../../repositories/OutboxRepository";
import type { OutboxSplitGroup } from "../types/OutboxTypes";
import { createOutboxEntry } from "../types/OutboxTypes";

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

// === Helper: SHA-256 ===
async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(hashBuffer);
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
    }
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
        outboxContext
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
    }
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

    console.log("🔥 Submitting burn commitment...");
    const burnResponse = await this.client.submitTransferCommitment(burnCommitment);

    if (burnResponse.status === "REQUEST_ID_EXISTS") {
      console.warn("Token already burned, attempting recovery...");
    } else if (burnResponse.status !== "SUCCESS") {
      throw new Error(`Burn failed: ${burnResponse.status}`);
    }

    onTokenBurned(uiTokenId);

    const burnInclusionProof = await waitInclusionProofWithDevBypass(burnCommitment);
    const burnTransaction = burnCommitment.toTransaction(burnInclusionProof);

    // === STEP 2: MINT SPLIT TOKENS ===
    console.log("✨ Creating split mint commitments...");

    const mintCommitments = await split.createSplitMintCommitments(
      this.trustBase,
      burnTransaction
    );

    const mintedTokensInfo: MintedTokenInfo[] = [];

    for (const commitment of mintCommitments) {
      const res = await this.client.submitMintCommitment(commitment);
      if (res.status !== "SUCCESS" && res.status !== "REQUEST_ID_EXISTS") {
        throw new Error(`Mint split token failed: ${res.status}`);
      }

      const proof = await waitInclusionProofWithDevBypass(commitment);

      const commTokenIdHex = Buffer.from(
        commitment.transactionData.tokenId.bytes
      ).toString("hex");
      const recipientIdHex = Buffer.from(recipientTokenId.bytes).toString(
        "hex"
      );

      const isForRecipient = commTokenIdHex === recipientIdHex;

      mintedTokensInfo.push({
        commitment: commitment,
        inclusionProof: proof,
        isForRecipient: isForRecipient,
        tokenId: commitment.transactionData.tokenId,
        salt: commitment.transactionData.salt,
      });
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

    // === STEP 4: TRANSFER TO RECIPIENT ===
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

    // 3. Create Token
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
