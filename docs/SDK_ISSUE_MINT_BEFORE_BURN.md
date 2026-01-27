# Feature Request: Flexible Token Split Pattern (MINT-before-BURN)

**Repository**: https://github.com/unicitynetwork/state-transition-sdk
**SDK Version**: 1.6.0
**Related Files**: `lib/transaction/split/TokenSplitBuilder.js`, `lib/token/fungible/SplitMintReason.js`

---

## Summary

Request for a two-phase split API that allows mint commitments to be created and submitted BEFORE the burn transaction, enabling safer client-side persistence patterns.

---

## Current Behavior

The `TokenSplit.createSplitMintCommitments(trustBase, burnTransaction)` method requires the `burnTransaction` (including its inclusion proof from the aggregator) as a mandatory parameter:

```typescript
// TokenSplitBuilder.js line 71-73
async createSplitMintCommitments(trustBase, burnTransaction) {
    const burnedToken = await this.token.update(trustBase,
        new TokenState(new BurnPredicate(...), null),
        burnTransaction);  // <-- Requires burn proof
    return Promise.all(this.tokens.map((request) =>
        MintTransactionData.create(...,
            new SplitMintReason(burnedToken, ...)  // burnedToken embedded here
        )));
}
```

This enforces the order: **BURN → wait for proof → MINT → TRANSFER**

### Cryptographic Dependency

The constraint exists because `SplitMintReason` embeds the full burned token state (with its blockchain inclusion proof) to prove:
1. The source token was legitimately destroyed
2. The aggregation root in the burn predicate matches the mint proof paths
3. Conservation of value is cryptographically verified

---

## Problem Statement

This ordering creates a dangerous window for client applications where tokens can be lost:

### Window of Vulnerability
```
Time 0:   Original token in wallet (32 ETH)
Time 1:   BURN submitted to aggregator
Time 2:   BURN confirmed (original token destroyed)
Time 3:   ❌ IF CRASH HERE: User has 0 tokens locally
Time 4:   MINT commitments created
Time 5:   MINTs submitted to aggregator
Time 6:   MINTs confirmed (28 ETH change + 4 ETH recipient exist on-chain)
Time 7:   New tokens saved to local storage
Time 8:   New tokens synced to backup (IPFS)
```

**Real-world incident**: A user lost 28 ETH when their browser crashed between Time 3 and Time 7. The change token was minted on-chain but never persisted locally.

### Why This Matters for Wallet Developers

The current SDK constraint prevents implementing the safest persistence pattern:

**Desired Pattern (impossible today)**:
```
1. Create new token objects with pending commitments
2. Save to local storage
3. Sync to remote backup (IPFS)
4. Verify backup succeeded
5. ONLY THEN submit to aggregator
6. Update tokens with proofs
7. Sync again
```

For direct transfers, this pattern works because the recipient token details are known before submission. For splits, we cannot know the new token states until after the burn is confirmed.

---

## Requested Behavior

A two-phase API that decouples mint commitment creation from burn proof:

### Option A: Separate Pre-Mint Method

```typescript
interface TokenSplit {
    // Existing: create burn commitment
    createBurnCommitment(salt: Uint8Array, signingService: SigningService): Promise<TransferCommitment>;

    // NEW: Create mint commitments referencing burn commitment (not proof yet)
    createPendingMintCommitments(burnCommitmentHash: Uint8Array): Promise<PendingMintCommitment[]>;

    // NEW: Finalize mints after burn is confirmed
    finalizeMintCommitments(pendingMints: PendingMintCommitment[], burnTransaction: TransferTransaction): Promise<MintCommitment[]>;
}
```

### Option B: Two-Phase Build

```typescript
interface TokenSplitBuilder {
    // NEW: Build with separate phases
    buildTwoPhase(token: Token): Promise<{
        mintPhase: {
            commitments: DeferredMintCommitment[];
            tokenPreview: TokenPreview[];  // Enough info to save locally
        };
        burnPhase: {
            commitment: TransferCommitment;
            finalizeMints(burnTx: TransferTransaction): Promise<MintCommitment[]>;
        };
    }>;
}
```

### Option C: Aggregator-Side Enhancement

Allow the aggregator to accept mint commitments that reference a burn commitment hash (not yet confirmed), with the constraint that mints only become valid after the referenced burn is confirmed.

---

## Benefits

1. **User always has tokens**: Either original OR new tokens are always persisted
2. **Enables save-before-submit**: All tokens saved to storage before blockchain interaction
3. **Prevents token loss**: Browser crashes, network failures, and app termination become recoverable
4. **Consistent with transfers**: Aligns with the safe pattern already used for direct transfers

---

## Technical Considerations

### Cryptographic Integrity

The current `SplitMintReason` embeds the full burned token to prove conservation. A two-phase approach could:

1. **Commit-then-reveal**: Mint commitments reference the burn commitment hash. The aggregator queues them until the burn is confirmed, then validates the full proof.

2. **Deferred verification**: `SplitMintReason` accepts a burn commitment hash initially, then gets upgraded with the full proof before finalization.

3. **Client-side assembly**: Let clients assemble the final `MintCommitment` from a `PendingMintData` + `BurnTransaction` after burn confirms, but allow the pending data to be created (and persisted) before burn.

### Backward Compatibility

The existing `createSplitMintCommitments(trustBase, burnTransaction)` API should remain unchanged. New methods would be additive.

---

## Use Cases

1. **Browser wallets**: Must persist tokens before any blockchain interaction due to crash risk
2. **Mobile apps**: Background termination can happen at any time
3. **Multi-device sync**: Tokens must be backed up to cloud/IPFS before considered "safe"
4. **Transaction recovery**: Outbox patterns need token data before submission to enable recovery

---

## Additional Context

We're building a browser-based wallet (Sphere) that syncs tokens to IPFS. Our current workaround is to save tokens ~2.5 seconds after mint submission, but this leaves a critical vulnerability window. A proper solution requires SDK support for knowing token details before the burn is submitted.

---

## Proposed Implementation Steps

1. Add `createPendingMintData()` method that returns mint data without requiring burn proof
2. Add `finalizeMint(pendingData, burnTransaction)` method that produces the final `MintCommitment`
3. Update documentation with the two-phase pattern for safe client implementations
4. (Optional) Consider aggregator-side support for commit-then-reveal pattern

---

**Priority**: High - This addresses a real token loss scenario that has already occurred in production.
