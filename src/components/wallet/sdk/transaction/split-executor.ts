/**
 * Token Split Executor (Platform-Independent)
 *
 * Executes token split operations using the Unicity SDK's TokenSplitBuilder.
 * A split operation:
 * 1. Burns the original token
 * 2. Mints two new tokens (recipient + change)
 * 3. Transfers the recipient token to them
 * 4. Keeps the change token for the sender
 *
 * Platform implementations provide:
 * - Sha256Provider for hashing
 * - SplitOutboxProvider for recovery tracking (optional)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer } from 'buffer';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId';
import { Token as SdkToken } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import { TokenState } from '@unicitylabs/state-transition-sdk/lib/token/TokenState';
import { CoinId } from '@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId';
import { TokenCoinData } from '@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData';
import { TokenSplitBuilder } from '@unicitylabs/state-transition-sdk/lib/transaction/split/TokenSplitBuilder';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';
import { UnmaskedPredicate } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate';
import { UnmaskedPredicateReference } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference';
import { TransferCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment';
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';
import { waitInclusionProof } from '@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils';
import type { IAddress } from '@unicitylabs/state-transition-sdk/lib/address/IAddress';

import type { SplitPlan, SplittableToken } from './token-split';
import type {
  MintedTokenInfo,
  SplitTokenResult,
  SplitPlanResult,
  SplitOutboxProvider,
  SplitOutboxContext,
  SplitGroup,
  SplitTransferEntry,
  OnTokenBurnedCallback,
} from './split-types';

// ==========================================
// Provider Interfaces
// ==========================================

/**
 * Provider for SHA-256 hashing (platform-independent)
 */
export interface Sha256Provider {
  /**
   * Compute SHA-256 hash
   * @param input - String or bytes to hash
   * @returns Hash as Uint8Array
   */
  sha256(input: string | Uint8Array): Promise<Uint8Array>;
}

/**
 * Default SHA-256 provider using Web Crypto
 */
export class DefaultSha256Provider implements Sha256Provider {
  async sha256(input: string | Uint8Array): Promise<Uint8Array> {
    const data = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input;

    // Try Web Crypto first (browser)
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      // Ensure we pass ArrayBuffer, not SharedArrayBuffer
      // Copy to new Uint8Array to guarantee standard ArrayBuffer
      const safeBuffer = new Uint8Array(data);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', safeBuffer);
      return new Uint8Array(hashBuffer);
    }

    // Fallback to Node.js crypto
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    const hash = nodeCrypto.createHash('sha256').update(data).digest();
    return new Uint8Array(hash);
  }
}

/**
 * UUID generator interface
 */
export interface UuidProvider {
  /** Generate a new UUID v4 */
  generateUuid(): string;
}

/**
 * Default UUID provider
 */
export class DefaultUuidProvider implements UuidProvider {
  generateUuid(): string {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    // Fallback implementation
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.randomUUID();
  }
}

// ==========================================
// Configuration
// ==========================================

/**
 * Configuration for TokenSplitExecutor
 */
export interface TokenSplitExecutorConfig {
  /** State transition client for blockchain operations */
  stateTransitionClient: StateTransitionClient;
  /** Root trust base for verification */
  trustBase: RootTrustBase;
  /** SHA-256 provider (optional, defaults to Web Crypto) */
  sha256Provider?: Sha256Provider;
  /** UUID provider (optional, defaults to crypto.randomUUID) */
  uuidProvider?: UuidProvider;
  /** Outbox provider for recovery tracking (optional) */
  outboxProvider?: SplitOutboxProvider;
}

// ==========================================
// TokenSplitExecutor
// ==========================================

/**
 * Executes token split operations
 *
 * Usage:
 * ```typescript
 * const executor = new TokenSplitExecutor({
 *   stateTransitionClient: client,
 *   trustBase: trustBase,
 * });
 *
 * const result = await executor.executeSplitPlan(
 *   plan,
 *   recipientAddress,
 *   signingService,
 *   (id) => console.log(`Burned: ${id}`)
 * );
 * ```
 */
export class TokenSplitExecutor {
  private client: StateTransitionClient;
  private trustBase: RootTrustBase;
  private sha256: Sha256Provider;
  private uuid: UuidProvider;
  private outbox: SplitOutboxProvider | null;

  constructor(config: TokenSplitExecutorConfig) {
    this.client = config.stateTransitionClient;
    this.trustBase = config.trustBase;
    this.sha256 = config.sha256Provider ?? new DefaultSha256Provider();
    this.uuid = config.uuidProvider ?? new DefaultUuidProvider();
    this.outbox = config.outboxProvider ?? null;
  }

  /**
   * Execute a split plan
   *
   * @param plan - Split plan from TokenSplitCalculator
   * @param recipientAddress - Recipient's address
   * @param signingService - Service for signing transactions
   * @param onTokenBurned - Callback when token is burned (for UI updates)
   * @param outboxContext - Optional context for outbox tracking
   */
  async executeSplitPlan(
    plan: SplitPlan<SplittableToken>,
    recipientAddress: IAddress,
    signingService: SigningService,
    onTokenBurned?: OnTokenBurnedCallback,
    outboxContext?: SplitOutboxContext
  ): Promise<SplitPlanResult> {
    console.log('⚙️ Executing split plan using TokenSplitBuilder...');

    const result: SplitPlanResult = {
      tokensForRecipient: [],
      tokensKeptBySender: [],
      burnedTokens: [],
      recipientTransferTxs: [],
      outboxEntryIds: [],
      splitGroupId: undefined,
    };

    if (
      plan.requiresSplit &&
      plan.tokenToSplit &&
      plan.splitAmount &&
      plan.remainderAmount
    ) {
      const coinIdBuffer = Buffer.from(plan.coinId, 'hex');
      const coinId = new CoinId(coinIdBuffer);

      const splitResult = await this.executeSingleTokenSplit(
        plan.tokenToSplit.sdkToken,
        plan.splitAmount,
        plan.remainderAmount,
        coinId,
        recipientAddress,
        signingService,
        onTokenBurned ?? (() => {}),
        plan.tokenToSplit.sourceToken.id,
        outboxContext
      );

      result.tokensForRecipient.push(splitResult.tokenForRecipient);
      result.tokensKeptBySender.push(splitResult.tokenForSender);
      result.burnedTokens.push({ id: plan.tokenToSplit.sourceToken.id });
      result.recipientTransferTxs.push(splitResult.recipientTransferTx);

      if (splitResult.outboxEntryId) {
        result.outboxEntryIds.push(splitResult.outboxEntryId);
      }
      if (splitResult.splitGroupId) {
        result.splitGroupId = splitResult.splitGroupId;
      }
    }

    return result;
  }

  /**
   * Execute a single token split
   */
  private async executeSingleTokenSplit(
    tokenToSplit: SdkToken<any>,
    splitAmount: bigint,
    remainderAmount: bigint,
    coinId: CoinId,
    recipientAddress: IAddress,
    signingService: SigningService,
    onTokenBurned: OnTokenBurnedCallback,
    uiTokenId: string,
    outboxContext?: SplitOutboxContext
  ): Promise<SplitTokenResult> {
    const tokenIdHex = Buffer.from(tokenToSplit.id.bytes).toString('hex');
    console.log(`🔪 Splitting token ${tokenIdHex.slice(0, 8)}...`);

    // Create seed string for deterministic ID generation
    const seedString = `${tokenIdHex}_${splitAmount.toString()}_${remainderAmount.toString()}`;

    // Initialize outbox tracking if context provided
    let splitGroupId: string | undefined;
    let transferEntryId: string | undefined;

    if (this.outbox && outboxContext) {
      splitGroupId = this.uuid.generateUuid();
      const splitGroup: SplitGroup = {
        groupId: splitGroupId,
        createdAt: Date.now(),
        originalTokenId: uiTokenId,
        seedString: seedString,
        entryIds: [],
      };
      this.outbox.createSplitGroup(splitGroup);
      console.log(`📤 Outbox: Created split group ${splitGroupId.slice(0, 8)}...`);
    }

    // Generate deterministic IDs and salts
    const recipientTokenId = new TokenId(await this.sha256.sha256(seedString));
    const senderTokenId = new TokenId(await this.sha256.sha256(seedString + '_sender'));
    const recipientSalt = await this.sha256.sha256(seedString + '_recipient_salt');
    const senderSalt = await this.sha256.sha256(seedString + '_sender_salt');

    // Create sender address
    const senderAddressRef = await UnmaskedPredicateReference.create(
      tokenToSplit.type,
      signingService.algorithm,
      signingService.publicKey,
      HashAlgorithm.SHA256
    );
    const senderAddress = await senderAddressRef.toAddress();

    // Build split using TokenSplitBuilder
    const builder = new TokenSplitBuilder();

    // Create recipient token
    const coinDataA = TokenCoinData.create([[coinId, splitAmount]]);
    builder.createToken(
      recipientTokenId,
      tokenToSplit.type,
      new Uint8Array(0), // tokenData
      coinDataA,
      senderAddress, // Initially owned by sender (will be transferred)
      recipientSalt,
      null // dataHash
    );

    // Create sender change token
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

    // Build the split object
    const split = await builder.build(tokenToSplit);

    // === STEP 1: BURN ORIGINAL TOKEN ===
    const burnSalt = await this.sha256.sha256(seedString + '_burn_salt');
    const burnCommitment = await split.createBurnCommitment(burnSalt, signingService);

    console.log('🔥 Submitting burn commitment...');
    const burnResponse = await this.client.submitTransferCommitment(burnCommitment);

    if (burnResponse.status === 'REQUEST_ID_EXISTS') {
      console.warn('Token already burned, attempting recovery...');
    } else if (burnResponse.status !== 'SUCCESS') {
      throw new Error(`Burn failed: ${burnResponse.status}`);
    }

    // Notify that token is burned
    onTokenBurned(uiTokenId);

    const burnInclusionProof = await waitInclusionProof(
      this.trustBase,
      this.client,
      burnCommitment
    );
    const burnTransaction = burnCommitment.toTransaction(burnInclusionProof);

    // === STEP 2: MINT SPLIT TOKENS ===
    console.log('✨ Creating split mint commitments...');

    const mintCommitments = await split.createSplitMintCommitments(
      this.trustBase,
      burnTransaction
    );

    const mintedTokensInfo: MintedTokenInfo[] = [];

    for (const commitment of mintCommitments) {
      const res = await this.client.submitMintCommitment(commitment);
      if (res.status !== 'SUCCESS' && res.status !== 'REQUEST_ID_EXISTS') {
        throw new Error(`Mint split token failed: ${res.status}`);
      }

      const proof = await waitInclusionProof(
        this.trustBase,
        this.client,
        commitment
      );

      const commTokenIdHex = Buffer.from(
        commitment.transactionData.tokenId.bytes
      ).toString('hex');
      const recipientIdHex = Buffer.from(recipientTokenId.bytes).toString('hex');

      const isForRecipient = commTokenIdHex === recipientIdHex;

      mintedTokensInfo.push({
        commitment: commitment,
        inclusionProof: proof,
        isForRecipient: isForRecipient,
        tokenId: commitment.transactionData.tokenId,
        salt: commitment.transactionData.salt,
      });
    }

    console.log('All split tokens minted on blockchain.');

    // === STEP 3: RECONSTRUCT TOKEN OBJECTS ===
    const recipientInfo = mintedTokensInfo.find(t => t.isForRecipient);
    const senderInfo = mintedTokensInfo.find(t => !t.isForRecipient);

    if (!recipientInfo || !senderInfo) {
      throw new Error('Failed to identify split tokens');
    }

    const recipientTokenBeforeTransfer = await this.createAndVerifyToken(
      recipientInfo,
      signingService,
      tokenToSplit.type,
      'Recipient (Pre-transfer)'
    );

    const senderToken = await this.createAndVerifyToken(
      senderInfo,
      signingService,
      tokenToSplit.type,
      'Sender (Change)'
    );

    // === STEP 4: TRANSFER TO RECIPIENT ===
    console.log(`🚀 Transferring split token to ${recipientAddress.address}...`);

    const transferSalt = await this.sha256.sha256(seedString + '_transfer_salt');

    const transferCommitment = await TransferCommitment.create(
      recipientTokenBeforeTransfer,
      recipientAddress,
      transferSalt,
      null,
      null,
      signingService
    );

    // Create outbox entry BEFORE submitting (for recovery)
    if (this.outbox && outboxContext && splitGroupId) {
      const coinIdHex = Buffer.from(coinId.bytes).toString('hex');
      const transferEntry: SplitTransferEntry = {
        id: this.uuid.generateUuid(),
        type: 'SPLIT_TRANSFER',
        status: 'READY_TO_SUBMIT',
        sourceTokenId: uiTokenId,
        recipientNametag: outboxContext.recipientNametag,
        recipientPubkey: outboxContext.recipientPubkey,
        recipientAddressJson: JSON.stringify(
          (recipientAddress as any).toJSON ? (recipientAddress as any).toJSON() : recipientAddress
        ),
        amount: splitAmount.toString(),
        coinId: coinIdHex,
        salt: Buffer.from(transferSalt).toString('hex'),
        tokenJson: JSON.stringify(recipientTokenBeforeTransfer.toJSON()),
        commitmentJson: JSON.stringify(transferCommitment.toJSON()),
        splitGroupId: splitGroupId,
        phaseIndex: 3, // Transfer phase
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.outbox.createTransferEntry(transferEntry);
      this.outbox.addEntryToSplitGroup(splitGroupId, transferEntry.id);
      transferEntryId = transferEntry.id;
      console.log(`📤 Outbox: Added split transfer entry ${transferEntry.id.slice(0, 8)}...`);
    }

    const transferRes = await this.client.submitTransferCommitment(transferCommitment);

    if (transferRes.status !== 'SUCCESS' && transferRes.status !== 'REQUEST_ID_EXISTS') {
      if (this.outbox && transferEntryId) {
        this.outbox.updateEntryStatus(transferEntryId, 'FAILED', `Transfer failed: ${transferRes.status}`);
      }
      throw new Error(`Transfer failed: ${transferRes.status}`);
    }

    // Update outbox: submitted
    if (this.outbox && transferEntryId) {
      this.outbox.updateEntryStatus(transferEntryId, 'SUBMITTED');
    }

    const transferProof = await waitInclusionProof(
      this.trustBase,
      this.client,
      transferCommitment
    );

    const transferTx = transferCommitment.toTransaction(transferProof);

    // Update outbox: proof received (ready for Nostr delivery)
    if (this.outbox && transferEntryId) {
      this.outbox.updateEntryProof(
        transferEntryId,
        JSON.stringify(transferProof.toJSON()),
        JSON.stringify(transferTx.toJSON())
      );
    }

    console.log('✅ Split transfer complete!');

    return {
      tokenForRecipient: recipientTokenBeforeTransfer,
      tokenForSender: senderToken,
      recipientTransferTx: transferTx,
      outboxEntryId: transferEntryId,
      splitGroupId: splitGroupId,
    };
  }

  /**
   * Reconstruct and verify a token from mint info
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
    const state = new TokenState(predicate, null);

    // 3. Create Token
    const token = await SdkToken.mint(
      this.trustBase,
      state,
      info.commitment.toTransaction(info.inclusionProof as any)
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

// ==========================================
// Factory
// ==========================================

/**
 * Create a TokenSplitExecutor instance
 */
export function createTokenSplitExecutor(
  config: TokenSplitExecutorConfig
): TokenSplitExecutor {
  return new TokenSplitExecutor(config);
}
