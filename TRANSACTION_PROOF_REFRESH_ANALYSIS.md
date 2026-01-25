# Transaction Proof Refresh Analysis - Unicity SDK Patterns

## Executive Summary

Transaction (state transition) proofs in the Unicity SDK require **different recovery strategies** than genesis (mint) proofs because the `requestId` **cannot be deterministically derived** from the transaction data alone. The `requestId` depends on a **random 32-byte salt** created during commitment construction, which is not stored in the `TxfTransaction` structure.

## Key Differences: Genesis vs Transaction Proofs

### Genesis (Mint) Proof Refresh - Works
Genesis proof CAN be reconstructed because all data is stored in genesis.data including the salt.

### Transaction (Transfer) Proof Refresh - Requires Outbox
Transaction proof CANNOT be reconstructed from TxfTransaction alone because the salt is NOT stored.

The TXF format transaction structure only contains:
- previousStateHash
- newStateHash  
- predicate (new owner)
- inclusionProof (or null)
- data (optional metadata)

Missing: salt, sourceToken, requestId

## SDK Architecture: Commitments vs Transactions

Two-phase transaction model:
1. Create commitment with salt
2. Submit commitment to aggregator
3. Wait for inclusion proof
4. Create transaction from commitment + proof

Only the transaction is stored in TXF, not the commitment data.

## Recovery Strategy: Outbox Pattern

The codebase solves this via the Outbox pattern - storing commitment data BEFORE submission.

See: tryRecoverFromOutbox() in /home/vrogojin/sphere/src/utils/devTools.ts:454-511

## Answers to Your Questions

### 1. How do transaction proofs differ from genesis proofs?

**Genesis proofs:**
- Can be reconstructed from genesis.data (includes salt)
- requestId is deterministic from stored data
- Recovery: reconstruct MintCommitment, derive requestId, fetch proof

**Transaction proofs:**
- CANNOT be reconstructed from TxfTransaction (no salt)
- requestId depends on random salt not stored in TXF
- Recovery: requires outbox entry with commitmentJson

### 2. Pattern for resubmitting on exclusion proof?

```typescript
const commitment = await TransferCommitment.fromJSON(commitmentData);
const client = ServiceProvider.stateTransitionClient;

// Submit (idempotent - REQUEST_ID_EXISTS is ok)
const response = await client.submitTransferCommitment(commitment);

if (response.status === "SUCCESS" || response.status === "REQUEST_ID_EXISTS") {
  // Wait for proof
  const proof = await waitForProofWithSDK(commitment, 60000);
  
  if (isInclusionProofNotExclusion(proof)) {
    // Update transaction.inclusionProof = proof
  }
}
```

### 3. How does tryRecoverFromOutbox() work?

Location: /home/vrogojin/sphere/src/utils/devTools.ts:454-511

Process:
1. Find outbox entry by sourceTokenId
2. Check entry.commitmentJson exists
3. Reconstruct: TransferCommitment.fromJSON(commitmentData)
4. Resubmit: submitCommitmentToAggregator(commitment)
5. Wait for proof: waitForProofWithSDK(commitment, 60000)
6. Update outbox status to PROOF_RECEIVED
7. Return proof for updating TxfTransaction

### 4. Data needed from TxfToken.transactions array?

For recovery, you need the OUTBOX ENTRY, not the transaction:

```typescript
interface OutboxEntry {
  sourceTokenId: string;
  commitmentJson: string;  // Full TransferCommitment.toJSON()
  salt: string;            // 32-byte hex salt
  sourceTokenJson: string; // Source token state
  recipientAddressJson: string;
  amount: string;
  status: OutboxEntryStatus;
}
```

The TxfTransaction array provides:
- Which transactions need proof refresh (inclusionProof === null)
- Transaction index for updating after recovery

But it CANNOT provide the data needed to reconstruct the commitment.

### 5. SDK methods for submission?

**Submit transfer commitment:**
```typescript
const client = ServiceProvider.stateTransitionClient;
const response = await client.submitTransferCommitment(commitment);
// Returns: { status: "SUCCESS" | "REQUEST_ID_EXISTS" | error }
```

**Wait for proof with verification:**
```typescript
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";

const trustBase = ServiceProvider.getRootTrustBase();
const proof = await waitInclusionProof(
  trustBase,
  client,
  commitment,
  AbortSignal.timeout(30000)
);
```

**Or direct query (dev mode):**
```typescript
const proof = await client.getInclusionProof(commitment.requestId);
```

## Implementation Guidance

### For Tokens You Sent (Outbound)

Use outbox recovery - current implementation is correct:

```typescript
const recovery = await tryRecoverFromOutbox(token.id, true);
if (recovery.recovered && recovery.proof) {
  txf.transactions[index].inclusionProof = recovery.proof;
}
```

### For Tokens You Received (Inbound)

CANNOT self-recover. Options:
1. Strip uncommitted transactions (TokenRecoveryService pattern)
2. Request sender to re-transfer
3. Keep original proof if valid

See: /home/vrogojin/sphere/src/utils/devTools.ts:858-860

### Current devRefreshProofs Implementation

Location: /home/vrogojin/sphere/src/utils/devTools.ts:788-861

Pattern:
- Genesis: reconstruct commitment, fetch/resubmit proof
- Transaction: attempt outbox recovery
- If no outbox entry: fail gracefully with user guidance

## Key SDK Insights

1. **Salt is Critical:** Random 32-byte salt makes commitments non-reproducible
2. **Outbox is Essential:** Only way to recover transaction proofs for sent tokens
3. **Received Tokens Cannot Self-Recover:** Must contact sender or strip transactions
4. **Genesis is Special:** Stores salt in genesis.data.salt by design
5. **Idempotent Resubmission:** REQUEST_ID_EXISTS is safe to ignore

## File References

- Outbox recovery: /home/vrogojin/sphere/src/utils/devTools.ts:454-511
- Transaction refresh: /home/vrogojin/sphere/src/utils/devTools.ts:824-861
- Outbox types: /home/vrogojin/sphere/src/components/wallet/sdk/types/outbox.ts
- TXF types: /home/vrogojin/sphere/src/components/wallet/sdk/types/txf.ts:129-135
- Service provider: /home/vrogojin/sphere/src/components/wallet/L3/services/ServiceProvider.ts
- Outbox recovery service: /home/vrogojin/sphere/src/components/wallet/L3/services/OutboxRecoveryService.ts

