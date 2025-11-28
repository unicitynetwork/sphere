/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IAddress } from "@unicitylabs/state-transition-sdk/lib/address/IAddress";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
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
    onTokenBurned: (uiId: string) => void
  ): Promise<{
    tokensForRecipient: SdkToken<any>[];
    tokensKeptBySender: SdkToken<any>[];
    burnedTokens: any[];
    recipientTransferTxs: TransferTransaction[];
  }> {
    console.log(`⚙️ Executing split plan using TokenSplitBuilder...`);

    const result = {
      tokensForRecipient: [] as SdkToken<any>[],
      tokensKeptBySender: [] as SdkToken<any>[],
      burnedTokens: [] as any[],
      recipientTransferTxs: [] as TransferTransaction[],
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
        plan.tokenToSplit.uiToken.id
      );

      result.tokensForRecipient.push(splitResult.tokenForRecipient);
      result.tokensKeptBySender.push(splitResult.tokenForSender);
      result.burnedTokens.push(plan.tokenToSplit.uiToken);
      result.recipientTransferTxs.push(splitResult.recipientTransferTx);
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
    uiTokenId: string
  ): Promise<SplitTokenResult> {
    const tokenIdHex = Buffer.from(tokenToSplit.id.bytes).toString("hex");
    console.log(`🔪 Splitting token ${tokenIdHex.slice(0, 8)}...`);

    const builder = new TokenSplitBuilder();

    const seedString = `${tokenIdHex}_${splitAmount.toString()}_${remainderAmount.toString()}`;

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

    const burnInclusionProof = await waitInclusionProof(
      this.trustBase,
      this.client,
      burnCommitment
    );
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

      const proof = await waitInclusionProof(
        this.trustBase,
        this.client,
        commitment
      );

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

    const transferRes = await this.client.submitTransferCommitment(transferCommitment);

    if (
      transferRes.status !== "SUCCESS" &&
      transferRes.status !== "REQUEST_ID_EXISTS"
    ) {
      throw new Error(`Transfer failed: ${transferRes.status}`);
    }

    const transferProof = await waitInclusionProof(
      this.trustBase,
      this.client,
      transferCommitment
    );

    const transferTx = transferCommitment.toTransaction(transferProof);
    console.log("✅ Split transfer complete!");

    return {
      tokenForRecipient: recipientTokenBeforeTransfer,
      tokenForSender: senderToken,
      recipientTransferTx: transferTx,
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
