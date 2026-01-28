# Token Inventory Management Specification

**Version:** 3.5
**Last Updated:** 2026-01-28

> **v3.5 Changes:** Instant token transfers and sender recovery:
> - Section 2: New terminology (Unconfirmed Balance, INSTANT modes, Payment Session, Sender Recovery)
> - Section 6.1: INSTANT_SEND and INSTANT_RECEIVE sync modes
> - Section 7.1: Rewritten receiveTokensToInventoryLoop (3-phase model)
> - Section 7.2: Updated sendTokensFromInventory (skip IPFS on critical path)
> - Section 7.3: Updated sendViaNostrLoop (payment session tracking)
> - Section 7.3: Fire-and-forget aggregator submission (after Nostr confirmation)
> - Section 14: NEW - Sender Token Recovery from Nostr
> - Edge cases 13.27-13.33: Instant transfer scenarios

> **v3.4 Changes:** Version chain integrity and server validation contract:
> - Section 10.8: Version High Water Mark (HWM) tracking to prevent data regression
> - Section 10.9: Server Chain Validation Contract (version increment, lastCid chain, rate limits)
> - Section 10.10: Version Calculation for IPFS Uploads (`remoteVersion + 1` logic)
> - Section 10.11: Fast Sync Mode (`skipExtendedVerification` option)
> - Updated Step 2 and Step 10 with HWM tracking behavior

> **v3.3 Changes:** Lazy recovery for cache corruption resilience:
> - Section 7.4: LazyRecoveryLoop (automatic background recovery from IPFS version history)

> **v3.2 Changes:** Multi-version token architecture clarification:
> - Section 3.7: Multi-Version Token Architecture (tokenId vs stateHash, uniqueness constraints, boomerang scenarios)
> - Section 3.7.4: Merge rules for Sent/Invalid folders using `tokenId:stateHash` key

> **v3.1 Changes:** Added mandatory security and recovery amendments:
> - Section 3.4.1: IPFS Encryption (XChaCha20-Poly1305) - **DEFERRED** to future release
> - Step 4: Transaction hash verification
> - Section 10.7: Circuit Breaker Reset (auto-recovery from LOCAL mode)
> - Section 13.25: Split Burn Recovery (prevents value loss)

---

## 1. Overview

**Sphere** is a thin client implemented as a stand-alone webpage executed in the user's browser. It manages the user's inventory of tokens including sending, receiving, minting, burning, and splitting operations using the Unicity SDK.

**User Token Inventory** is stored in a P2P infrastructure (IPFS) with IPNS for consistent naming. Sphere reads the inventory from IPFS and updates it consistently. Multiple instances of Sphere (across devices or browser tabs) can work with the same inventory concurrently and remain in sync.

### 1.1 Design Principles

1. **Persistence First**: All commitments are persisted to IPFS before submission to aggregator
2. **No Token Loss**: Defensive validation prevents silent token deletion
3. **Eventual Consistency**: Cross-device sync via IPFS with conflict resolution
4. **Crash Recovery**: All operations can resume after browser restart

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Token ID** | Unique identifier for a token, derived from its genesis transaction |
| **State Hash** | Hash of a token's current state, changes with each transaction |
| **Current State** | The state hash of the token's latest transaction in its chain |
| **Inclusion Proof** | Unicity aggregator proof that a commitment has been included |
| **Exclusion Proof** | Unicity aggregator proof that a commitment has NOT been included |
| **Request ID** | Identifier for a transaction commitment, used to fetch proofs |
| **FAST Mode** | Sync mode that skips spent detection (for speed during send/receive) |
| **NORMAL Mode** | Full sync mode with spent detection (for complete validation) |
| **Tombstone** | Record marking a token state as SPENT (tokenId + stateHash) |
| **Nametag** | Special token representing a user's Unicity ID |
| **LOCAL Mode** | Sync mode that disables IPFS read/write; changes persist to localStorage only. Used for offline operation or when IPFS is unavailable. |
| **Commitment** | Signed transaction candidate submitted to aggregator; contains requestId and authenticator |
| **Authenticator** | Cryptographic signature over commitment payload |
| **Aggregator** | Unicity consensus layer that validates and includes commitments |
| **Proof Payload** | Serialized data within inclusion/exclusion proof; must match commitment |
| **Spent Detection** | Process (Step 7) of querying aggregator to determine if token state already spent |
| **Wallet Address** | User's secp256k1 public key or derived address; destination for direct transfers |
| **splitGroupId** | Unique identifier linking burn + mint operations in a split transaction |
| **Tab Leader** | Browser tab (highest instanceId) responsible for IPNS publish operations |
| **BroadcastChannel** | Web API for cross-tab communication; used for lock acquisition and heartbeat |
| **NAMETAG Mode** | Minimal sync mode that fetches only the nametag token for a given user. Used for login/preview pages to display Unicity ID without full inventory sync. Skips all token processing steps except nametag retrieval. |
| **Unconfirmed Balance** | Sum of token values lacking inclusion proofs for at least one commitment in their transaction history |
| **INSTANT_SEND Mode** | Sync mode for send operations: skip IPFS persistence, immediate Nostr delivery, fire-and-forget aggregator submission after Nostr confirmation |
| **INSTANT_RECEIVE Mode** | Sync mode for receive operations: localStorage-first with deferred IPFS sync |
| **Payment Session** | Transient tracking structure for specific token transfers to determine per-transfer success |
| **Sender Recovery** | Process of retrieving sent tokens from Nostr relay using sender's own pubkey as author filter |
| **Deferred Proof Acquisition** | Pattern where recipients (not senders) fetch their own inclusion proofs |

---

## 3. Inventory Structure

### 3.1 Folders

The inventory contains the following folders:

| Folder | Contents | Lifecycle |
|--------|----------|-----------|
| **Nametags** | Nametag tokens pointing to user's address (multiple allowed - user can have several Unicity IDs) | Permanent once minted |
| **Active** | Unspent tokens ready for transactions (send, burn, split) | Moves to Sent when spent |
| **Sent** | Tokens whose latest state has been SPENT, with full token data and inclusion proofs | Permanent (audit trail) |
| **Outbox** | Tokens currently in the sending flow with pending operations | Moves to Sent on completion |
| **Invalid** | Tokens that failed validation, kept for investigation | Permanent until manually cleared |

### 3.2 Sent Folder Semantics

The Sent folder contains tokens whose **latest state has been SPENT** (confirmed by an inclusion proof from the aggregator). Each entry includes:
- Full token data with complete transaction history
- The inclusion proof of the spending transaction
- Timestamp of when the token was spent

**Note**: The Sent folder does NOT include currently active tokens. "Sent" means the token has been transferred away or burned.

### 3.3 Invalid Folder Categories

Tokens are placed in the Invalid folder for the following reasons:

| Reason Code | Description |
|-------------|-------------|
| `SDK_VALIDATION` | Token failed Unicity SDK validation checks |
| `INTEGRITY_FAILURE` | State hash collision detected (same hash, different data) |
| `NAMETAG_MISMATCH` | Nametag token's Nostr pubkey doesn't match wallet |
| `MISSING_FIELDS` | Token missing required fields (genesis, state, etc.) |
| `OWNERSHIP_MISMATCH` | Token destination doesn't match current user's address |
| `PROOF_MISMATCH` | Inclusion proof doesn't match commitment payload/authenticator |

### 3.4 Storage Layers

| Layer | Contents | Persistence |
|-------|----------|-------------|
| **localStorage** | Active tokens, outbox, spent cache, sync metadata | Survives browser refresh |
| **sessionStorage** | Tab coordination state, import flags | Cleared on tab close |
| **Memory** | Sync queue, processing state, Helia instance | Cleared on refresh |
| **IPFS** | Complete inventory (all folders except spent cache) | Cross-device persistent |

**Critical Invariant**: The spent token cache is stored ONLY in localStorage and NEVER synced to IPFS. It is an optimization cache, not source of truth.

### 3.4.1 IPFS Encryption (DEFERRED)

> **Status: DEFERRED** - This feature is planned for a future release. Current implementation stores unencrypted data on IPFS. The IPNS name provides some obscurity but not true privacy.

**Future Implementation Notes:**

When implemented, IPFS uploads SHOULD be encrypted using XChaCha20-Poly1305 authenticated encryption.

**Planned Key Derivation:**
- Encryption key derived from wallet's master private key using HKDF
- Salt: `"unicity-ipfs-encryption"` (static)
- Info: wallet address hex (context binding)
- Output: 256-bit key for XChaCha20-Poly1305

**Planned Encryption Format:**
```typescript
interface EncryptedIpfsPayload {
  version: 1;
  nonce: string;       // 24-byte nonce, base64 encoded
  ciphertext: string;  // XChaCha20-Poly1305 output, base64 encoded
}
```

**Rationale for Deferral:**
- IPNS names are derived from user's private key and not publicly discoverable
- Token values are not directly visible without knowing the IPNS name
- Encryption adds complexity to cross-device sync and debugging
- Can be added in future version with backwards compatibility (detect encrypted vs plaintext)

### 3.5 Token Storage Format

**All tokens MUST be stored in the native Unicity SDK format.**

This means:
- Token data is serialized using the SDK's native serialization methods
- Token structure matches the SDK's `Token` class exactly
- No wrapper objects or custom formats around the SDK token
- Proofs are stored as returned by the SDK/aggregator

**Rationale:**
- Ensures compatibility with SDK validation methods
- Prevents data loss during serialization/deserialization
- Allows direct use of SDK methods without transformation
- Simplifies cross-device sync (no format conversion needed)

**Implementation:**
- Use `token.toJSON()` for serialization (SDK method)
- Use `Token.fromJSON()` for deserialization (SDK method)
- Store inclusion proofs in their native format from aggregator

### 3.6 Tombstones vs Sent Folder

**Sent Folder:** Full token record for audit trail.
- Contains: complete token data, transaction history, inclusion proof
- Created: Step 8.2 when token's current state found in spent cache
- Purpose: User-visible transaction history
- Example: "Sent 5 tokens to alice@unicity"

**Tombstone:** Lightweight marker for conflict resolution.
- Contains: tokenId + stateHash only (minimal data)
- Created: During multi-device conflict resolution when forked state detected
- Purpose: Internal marker to prevent re-spending forked states
- Example: Device A spent version 1 (ABC), Device B syncs and sees version 2 (XYZ).
  Tombstone marks ABC as spent to prevent B from re-using version 1.

**Usage Rules:**

| Scenario | Tombstone | Sent Folder |
|----------|-----------|-------------|
| Token sent and confirmed | No | Yes |
| Token burned (split) | No | Yes |
| Forked state resolved elsewhere | Yes | No |
| Multi-device state conflict | Yes | No |

### 3.7 Multi-Version Token Architecture

#### 3.7.1 Token Identity vs State

A token's lifecycle involves two distinct identifiers:

| Identifier | Source | Mutability |
|------------|--------|------------|
| **Token ID** | Derived from genesis transaction data | Immutable for token's entire lifecycle |
| **State Hash** | Computed from current state data | Changes with each transaction |

**Key Insight:** The same `tokenId` can exist at multiple states throughout its history. This is not a duplicate - it represents different points in the token's lifecycle.

#### 3.7.2 Uniqueness Constraints by Folder

| Folder | Uniqueness Key | Data Structure | Rationale |
|--------|----------------|----------------|-----------|
| **Active** | `tokenId` (ONE per token) | `Map<tokenId, TxfToken>` | A token can only have ONE unspent state at any time |
| **Sent** | `tokenId:stateHash` (MULTIPLE per token) | `SentTokenEntry[]` | Historical record of all spent states |
| **Invalid** | `tokenId:stateHash` (MULTIPLE per token) | `InvalidTokenEntry[]` | A token may fail validation at different states |
| **Tombstones** | `tokenId:stateHash` (MULTIPLE per token) | `TombstoneEntry[]` | Track each spent state for conflict resolution |
| **Outbox** | `entryId` | `OutboxEntry[]` | Multiple pending operations possible |

#### 3.7.3 Boomerang Scenarios

A "boomerang" occurs when a token returns to its original owner after being sent. This creates multiple historical states for the same token.

**Single-Step Boomerang:**
```
State S1: Alice owns token T
State S2: Alice sends T to Bob (T now at state S2)
State S3: Bob sends T back to Alice (T now at state S3)
```

Alice's inventory after boomerang:
- **Active:** Token T at state S3 (current unspent state)
- **Sent:** Token T at state S1 (historical spent state)

**Multi-Step Boomerang:**
```
State S1: Alice owns token T
State S2: Alice → Bob
State S3: Bob → Carol
State S4: Carol → Alice (boomerang complete)
```

Alice's inventory:
- **Active:** Token T at state S4
- **Sent:** Token T at state S1

#### 3.7.4 Merge Rules for Multi-Version Support

When merging remote data into local inventory (Step 2):

**Active folder:** Keep ONE token per `tokenId` - prefer the version with more transactions or more committed proofs.

**Sent folder:** Keep ALL unique `tokenId:stateHash` combinations from both local and remote.

**Invalid folder:** Keep ALL unique `tokenId:stateHash` combinations from both local and remote.

**Tombstones:** Keep ALL unique `tokenId:stateHash` combinations (union merge).

**Implementation Note:** The merge key `tokenId:stateHash` is computed using `getCurrentStateHash(token)` which returns the state hash of the token's latest transaction.

---

## 4. Token Lifecycle

### 4.1 Token States

```
┌─────────────────────────────────────────────────────────────────┐
│                       TOKEN LIFECYCLE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    commitment    ┌──────────┐    proof     ┌────────┐
│   │  ACTIVE  │ ──────────────→  │  PENDING │ ──────────→  │  SENT  │
│   └──────────┘                  └──────────┘              └────────┘
│        │                             │
│        │ validation                  │ timeout/
│        │ failure                     │ rejection
│        ▼                             ▼
│   ┌──────────┐                  ┌──────────┐
│   │ INVALID  │                  │  FAILED  │
│   └──────────┘                  └──────────┘
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 State Transitions

| From | To | Trigger |
|------|----|---------|
| ACTIVE | PENDING | User initiates send, commitment created |
| PENDING | SENT | Inclusion proof received, Nostr delivery complete |
| PENDING | FAILED | Aggregator rejection, timeout, source state already spent |
| ACTIVE | INVALID | Validation failure (SDK, integrity, ownership) |
| ACTIVE | SENT | Spent detection finds inclusion proof (spent elsewhere) |
| SENT | ACTIVE | Aggregator rollback (network fork) - requires manual verification |
| INVALID | ACTIVE | Manual intervention after fixing validation issue |
| FAILED | PENDING | User manually retries failed outbox entry |

---

## 5. Outbox Entry Lifecycle

### 5.1 Outbox States

```
┌─────────────────────────────────────────────────────────────────┐
│                    OUTBOX ENTRY LIFECYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐                                            │
│  │ PENDING_IPFS_   │ ──→ IPFS sync complete                     │
│  │ SYNC            │                    │                       │
│  └─────────────────┘                    ▼                       │
│                              ┌─────────────────┐                │
│                              │ READY_TO_SUBMIT │                │
│                              └─────────────────┘                │
│                                       │                         │
│                                       ▼ submit to aggregator    │
│                              ┌─────────────────┐                │
│                              │   SUBMITTED     │                │
│                              └─────────────────┘                │
│                                       │                         │
│                                       ▼ inclusion proof         │
│                              ┌─────────────────┐                │
│                              │ PROOF_RECEIVED  │                │
│                              └─────────────────┘                │
│                                       │                         │
│                          ┌───────────┴───────────┐              │
│                          ▼                       ▼              │
│                   ┌────────────┐          ┌────────────┐        │
│                   │ NOSTR_SENT │          │   BURNED   │        │
│                   └────────────┘          └────────────┘        │
│                          │                       │              │
│                          └───────────┬───────────┘              │
│                                      ▼                          │
│                              ┌─────────────────┐                │
│                              │   COMPLETED     │ → Move to Sent │
│                              └─────────────────┘                │
│                                                                  │
│  At any point: ──→ FAILED (on error after max retries)          │
│                                                                  │
│  SPECIFIC FAILURE PATHS:                                         │
│  PENDING_IPFS_SYNC ──→ FAILED (IPFS sync fails 10 times)        │
│  READY_TO_SUBMIT ──→ FAILED (source token already spent)        │
│  SUBMITTED ──→ FAILED (aggregator rejection after 10 retries)   │
│  NOSTR_SENT ──→ FAILED (Nostr relay down >24 hours)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Outbox Entry Structure

```typescript
interface OutboxEntry {
  id: string;
  status: OutboxStatus;
  type: 'DIRECT_TRANSFER' | 'SPLIT_BURN' | 'SPLIT_MINT' | 'MINT';
  sourceTokenId: string;
  recipientAddress?: string;
  amount: string;
  salt: string;                    // Non-reproducible, MUST be persisted
  commitmentJson: string;          // Contains requestId
  inclusionProofJson?: string;
  retryCount: number;
  splitGroupId?: string;           // Links related split operations
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
```

---

## 6. Core Operations 

### 6.1 inventorySync()

**Signature:**
```typescript
inventorySync(options: {
  incoming_token_list?: Token[],
  outbox_token_list?: Token[],
  completed_list?: CompletedTransfer[],
  instant_send?: boolean,        // INSTANT_SEND mode
  instant_receive?: boolean,     // INSTANT_RECEIVE mode
  payment_session_id?: string,   // Track specific transfer
}): Promise<SyncResult>
```

**Return Type:**
```typescript
interface SyncResult {
  status: 'SUCCESS' | 'PARTIAL_SYNC_FAILED' | 'LOCAL_ONLY' | 'RETRY' | 'ERROR';
  errorCode?: string;
  errorMessage?: string;
  tokenStats: {
    activeTokens: number;
    sentTokens: number;
    outboxTokens: number;
    invalidTokens: number;
  };
  ipnsPublishPending: boolean;
  lastCid?: string;
  syncDurationMs: number;
}
```

**Mode Detection (in order of precedence):**
1. If LOCAL = true: always LOCAL mode (skip IPFS reads/writes)
2. If recoveryDepth is set (>=0): RECOVERY mode (traverse version chain)
3. If NAMETAG = true: minimal functionality mode to fetch the nametag token only for the given user
4. If INSTANT_SEND = true: INSTANT_SEND mode (skip steps 0.1, 2, 3.2, 5.2, 7, 9, 10)
5. If INSTANT_RECEIVE = true: INSTANT_RECEIVE mode (skip steps 0.2, 2, 3.2, 7, 8.5, 8.5a, 9, 10)
6. If `incoming_token_list` OR `outbox_token_list` non-empty: FAST mode
7. Otherwise (all empty, possible completed_list present): NORMAL mode

**Mode Exclusivity:**
- Modes are mutually exclusive (only ONE mode active per sync call)
- Precedence order determines which mode activates when multiple conditions match
- Example: If LOCAL=true AND incoming_token_list non-empty, LOCAL mode takes precedence (IPFS skipped regardless of input)
- Exception: NAMETAG mode does NOT acquire sync lock (allows parallel nametag reads while other syncs run)

**Exclusivity:** Only one instance of inventorySync (except NAMETAG mode) may run at any time. Queue all calls and execute sequentially. Only inventorySync should be allowed to access the inventory in localStorage!

**localStorage Inventory Separation:**

Different addresses use separate localStorage keys following this pattern:
- Inventory: `unicity_wallet_{address}` where `{address}` is the wallet's public key hex
- Selected address tracked via: `l3_selected_address_path` (BIP32 path like "m/84'/1'/0'/0/0")

This allows users to switch between addresses and access the corresponding inventory from localStorage without re-downloading from IPFS.

**Note:** The spent token cache (`unicity_spent_token_cache`) MAY be shared between addresses since spent states are globally valid (a state spent by any address is spent for all).

### 6.2 LOCAL Mode Semantics

**Scope:** Per-browser (persisted in localStorage, shared across tabs)

**Storage:** localStorage key `sync_mode_local` = true/false

**Behavior When LOCAL=true:**
- Step 2: Skip IPFS read, use localStorage cache only
- Step 9.2: Skip IPFS upload decision, set UPLOAD_NEEDED = false
- Step 10: Skip entirely, return SUCCESS

**Constraints:**
- Send operations ARE allowed (commitments still submitted to aggregator)
- Commitments backed up to localStorage only (violates "Persistence First" if browser crashes)
- Show persistent warning: "Offline mode - tokens not synced across devices"

**Switching LOCAL -> NORMAL:**
1. On next sync: Step 2 fetches latest IPFS state
2. Conflict resolution per Section 8.2 if local differs from IPFS
3. Step 10 uploads merged inventory
4. Clear LOCAL mode flag on success

**When LOCAL Mode Activates Automatically:**
- IPFS operations fail for 5 minutes (Section 10.2)
- Set ipnsPublishPending flag for retry

### 6.3 NAMETAG Mode Semantics

**Purpose:** Fetch only nametag tokens for login/preview pages without full inventory sync.

**Use Cases:**
- Wallet import/onboarding: Display Unicity ID(s) before full sync
- Login page: Show user's nametag(s) for verification
- Quick identity check: Validate wallet has associated nametag(s)

**Step Flow (NAMETAG=true):**
- Step 0: SKIP (no input processing)
- Step 1: Load ONLY nametags from localStorage
- Step 2: Fetch ONLY nametag tokens from IPFS (skip all other token folders)
- Steps 3-7: SKIP entirely (no proof normalization, validation, or spent detection)
- Step 8: Run 8.4 ONLY - return all nametag tokens pointing to user's address
- Steps 9-10: SKIP (no IPFS upload)

**Return Type:**
```typescript
interface SyncResult {
  status: 'SUCCESS' | 'ERROR';
  nametags?: NametagData[];  // All nametags pointing to user's address (NAMETAG mode only)
  // Other fields omitted in NAMETAG mode
}
```

**Constraints:**
- Read-only operation (no IPFS writes)
- Does not trigger background loops
- Does not acquire sync lock (allows parallel reads)
- Returns immediately after nametag fetch

### 6.4 RECOVERY Mode Semantics

**Purpose:** Traverse the IPFS version chain via `_meta.lastCid` links to recover tokens from previous versions. Used when a version regression bug caused good data to be overwritten with empty/stale state.

**Version Chain Structure:**
```
IPNS → CID_v2 (current, possibly corrupted - 0 tokens)
         ↓ _meta.lastCid
       CID_v68 (previous version - 36 tokens) ← RECOVERY finds these
         ↓ _meta.lastCid
       CID_v67 (older version - 35 tokens)
         ↓ ... back to v1
```

**Trigger:** Set `recoveryDepth` parameter in `inventorySync()`:
- `recoveryDepth: 0` - Unlimited (traverse entire history)
- `recoveryDepth: N` - Traverse at most N previous versions
- Not set (undefined) - Normal sync (no recovery)

**Step Flow (RECOVERY mode):**
- Steps 0-2: Normal execution
- Step 2.5: Version chain traversal (NEW - RECOVERY only):
  1. Start from current CID's `_meta.lastCid`
  2. Fetch historical version via HTTP gateway
  3. Merge tokens (prefer token with more transactions)
  4. Merge sent/invalid/tombstones (union merge)
  5. Follow `_meta.lastCid` to next version
  6. Repeat until depth limit or chain end
- Steps 3-10: Normal execution (forces `uploadNeeded = true` to persist recovered state)

**Merge Strategy:**
| Data Type | Merge Key | Strategy |
|-----------|-----------|----------|
| Active tokens | tokenId | Keep token with more transactions |
| Sent tokens | tokenId:stateHash | Union merge (first wins) |
| Invalid tokens | tokenId:stateHash | Union merge (first wins) |
| Tombstones | tokenId:stateHash | Union merge (first wins) |

**Traversal Stop Conditions:**
1. `recoveryDepth` limit reached (if >0)
2. No more `_meta.lastCid` links (reached first version)
3. CID cycle detected (safety check)
4. Network error (sets `networkErrorOccurred` flag)
5. 404 error (historical CID pruned/unavailable)

**Critical: Network Error Handling:**
If a network error occurs during traversal:
- Set `networkErrorOccurred = true`
- Skip Step 10 upload entirely (prevents overwriting good IPFS data with incomplete data)
- Save to localStorage only

**Return Type Extension:**
```typescript
interface SyncResult {
  // ... existing fields ...
  recoveryStats?: {
    versionsTraversed: number;        // Number of historical versions processed
    tokensRecoveredFromHistory: number; // Tokens found in historical versions
    oldestCidReached?: string;        // CID of the oldest version reached
  };
}
```

**Dev Command:**
```javascript
// From browser console:
await devRecoverInventory()     // Unlimited depth
await devRecoverInventory(10)   // Last 10 versions only
```

**Use Cases:**
- Version regression recovery: When v68→v2 bug overwrote good data
- Fresh device sync: Auto-triggers with `recoveryDepth: 10` on fresh start (no localStorage)
- Data archaeology: Manual investigation of historical token states

**Auto-Recovery Detection:**

After Step 2 completes, the system automatically detects if recovery is needed:

```typescript
const shouldAutoRecover =
  ctx.tokens.size === 0 &&          // No tokens found from localStorage + IPFS
  ctx.remoteCid !== null &&         // We successfully loaded from IPFS
  ctx.remoteLastCid !== null;       // There's history to traverse
```

When detected:
1. Logs: `🔄 [Auto-Recovery] Detected 0 tokens with IPFS history available`
2. Sets `recoveryDepth = 10` (traverse last 10 versions)
3. Calls `step2_5_traverseVersionChain()` automatically
4. Sets `autoRecoveryTriggered = true` for tracking

This handles scenarios where:
- IPFS current version was corrupted/regressed to empty state
- User imported wallet on new device with corrupted IPNS
- Version regression bug published old state over good data

#### Step 0: Input Processing (If NAMETAG mode, skip)

**0.1)** If `incoming_token_list` is non-empty (FAST mode):
- Normalize and validate token data structures
- Add to interim token set in memory

**0.2)** If `outbox_token_list` is non-empty (FAST mode):
- Normalize and validate token data structures
- Mark tokens for sending (except those in `completed_list`)
- Add to interim token set in memory

**0.3)** If `completed_list` is non-empty:
- For each entry: mark the token state as SPENT
- Store inclusion proofs in spent token cache

#### Step 1-2: Data Loading (Parallel)

**1)** Read from localStorage:
- Load all tokens if NAMETAG is FALSE (nametags, active, sent, invalid, outbox), otherwise load nametags only
- Add to common processing set
- Mark outbox tokens for sending (except completed_list entries)

**2)** Read from IPFS (latest version, if in LOCAL mode, skip entirely):
- Resolve IPNS to get latest CID
- Fetch inventory from IPFS
- Retry with exponential backoff (max 1 minute between retries)
- **Circuit Breaker:** Max 10 consecutive failures. After 10 failures: switch to LOCAL mode, continue with localStorage data only
- Add to common processing set either all tokens if NAMETAG is FALSE, otherwise add just the nametag tokens and skip directly to Step 8.4
- Mark outbox tokens for sending (except completed_list entries)
- **HWM Tracking:** If `remoteVersion > versionHwm`, update HWM to remoteVersion
- **Stale Cache Detection:** If `remoteVersion < versionHwm`, set `networkErrorOccurred = true` to block upload (see Section 10.8)

**Note:** Same token may exist in multiple versions (different state hashes). Track by (tokenId, stateHash) tuple.

#### Step 3: Unicity Proofs Normalization

**3.1) Extraction:**
- Scan all tokens, extract all signed transaction commitments
- Group by request ID (may have duplicates)
- Extract all stored unicity proofs, group by request ID

**3.2) Coverage (SKIP in FAST mode):**
- For each commitment without matching proof:
  - Fetch proof from aggregator
  - If exclusion proof: submit commitment first, then fetch inclusion proof
  - Retry with exponential backoff (max 1 minute)
  - **Circuit Breaker:** Max 10 consecutive failures per requestId. After 10 failures for a single proof: mark that token as PENDING_PROOF_FETCH, continue with other tokens
- Can execute in parallel for each request ID

**3.3) Deduplication:**
- For each request ID with multiple proofs:
  - Keep only the proof with highest round number
  - Discard older proofs

#### Step 4: Commitment Validation

For each commitment:
- Find matching proof by request ID
- Verify proof payload matches commitment
- Verify authenticator matches commitment
- **Verify hash(proof.transaction) === hash(commitment.transaction)** (prevents proof substitution attacks)
- If mismatch: mark token as INVALID with reason `PROOF_MISMATCH`
- If valid: attach proof to token's transaction

#### Step 5: Token Validation

Performs four validation checks for each token (in order):

**5.1) Spent State Recovery:** (skip if NAMETAG is true)
For tokens whose transaction chain shows a spending commitment on the latest state:
- Check conditions:
  (1) Token NOT in spent cache
  (2) Token NOT in outbox (marked for sending)
  (3) Token owner matches current user
  (4) Token NOT in completed_list
- If ALL conditions true:
  - Add to Outbox with status READY_TO_SUBMIT
  - Reason: We had an outbox entry that was lost; recover it
- If ANY condition false:
  - Token already processed or doesn't belong to us
  - Skip to 5.2

**5.2) Ownership Verification:**
For tokens with NO spending commitment on latest state:
- Verify destination address matches current user:
  - Direct match: wallet address
  - Proxy match: nametag resolves to wallet address
- If mismatch: mark as INVALID with reason OWNERSHIP_MISMATCH
- If match: proceed to 5.3

**5.3) State Reconstruction:**
For tokens with valid ownership but missing data:
- Verify required fields present: genesis, current state hash, transaction history
- If fields missing: reconstruct using SDK
- If reconstruction fails: mark as INVALID with reason MISSING_FIELDS

**5.4) SDK Validation:**
For all tokens still valid after 5.1-5.3:
- Run Unicity SDK validation suite
- If any check fails: mark as INVALID with reason SDK_VALIDATION

#### Step 6: Token Deduplication

Two tokens are equivalent if:
- Token IDs match
- Current state hashes match

Keep one copy, merge any additional data (proofs, metadata).

#### Step 7: Spent Token Detection (SKIP in FAST mode)

**Prerequisites:** Spent token cache with dual-tier strategy:

**SPENT tier (localStorage):**
- Key: `tokenId:stateHash:publicKey`
- Value: `{ isSpent: true, inclusionProof: {...}, timestamp: number }`
- Persisted forever (states never become unspent)
- NEVER sync to IPFS (optimization only)

**UNSPENT tier (memory only):**
- In-memory cache with 5-minute TTL
- Tracks states verified as unspent
- Expires because states can change (new transaction committed)

**Rationale:** SPENT is immutable (once spent, always spent). UNSPENT may change if transaction gets committed elsewhere.

**7.1) Extract All States:**
- For each valid token, extract all historical states from transaction chain
- Build map of stateHash → stateData
- **Integrity Check:** If same stateHash maps to different data, this is CRITICAL:
  - Log to console with full details
  - Freeze Sphere UI
  - Show modal with technical details
  - Stop all syncing

**7.2) Check Each Unspent State:**
- First check spent cache
- If not cached: query aggregator for inclusion proof
- If inclusion proof exists: state is SPENT
  - Add to spent cache with proof
- Execute in parallel for each state

#### Step 8: Merge/Reconstruct Inventory (If NAMETAG is TRUE, skip directly to 8.4)

**8.0) Outbox Processing:**

**Standard Mode (NORMAL/FAST):**
- **Boomerang Check:** If tokenId exists in incoming tokens, compare stateHash (see Section 9.3)
- For tokens marked for sending:
  - In NORMAL mode: ensure commitment has inclusion proof (wait if needed), fetch from aggregator, if exclusion proof, submit the commitment and fetch the inclusion proof (retry till succeeded with the exponential backoff and 1m max interval)
  - If not burned: add to Nostr sending queue (if not already present)
  - If burned: move directly to Sent folder
- Proofs can be fetched concurrently
- Don't wait for Nostr delivery to complete

**INSTANT_SEND Mode:**
- **Boomerang Check:** Same as standard mode
- **Immediate Nostr Queue:** Queue tokens to Nostr immediately (unless burned). Nostr serves as persistence layer.
- **No Aggregator Submission Here:** Aggregator submission happens in sendViaNostrLoop AFTER Nostr confirmation
- **No Proof Wait:** Recipients are responsible for fetching their own inclusion proofs
- **Burn Handling:** Burned tokens move directly to Sent folder (no Nostr delivery)

**8.1) Active Tokens:**
- Tokens whose current state is NOT in spent cache
- NOT marked for sending
- NOT nametag tokens pointing to the current user's address

**8.2) Sent Tokens:**
- Tokens whose current state IS in spent cache (has inclusion proof)
- Include full token data + proof

**8.3) Invalid Tokens:**
- All tokens marked INVALID during validation

**8.4) Nametags:**
- Filter nametag tokens where current user **OWNS** the token (verified via `predicate.isOwner(pubkey)`)
- Multiple Unicity IDs supported - user can own several nametags
- Tokens whose current state is NOT in spent cache
- NOT marked for sending
- **Note:** Ownership (who controls the token) is separate from proxy address (where transfers go). Step 8.4 filters by ownership.
- If NAMETAG mode is TRUE: return all owned nametag tokens immediately and skip Steps 9-10

**8.5) Nametag-Nostr Consistency:** (skip if NAMETAG mode is TRUE)
- For each nametag token extracted in 8.4:
  - Derive the **proxy address** from nametag name: `ProxyAddress.fromNameTag(nametag)`
  - Query Nostr relay(s) for existing binding: `queryPubkeyByNametag(nametag)`
  - If binding exists AND matches proxy address: no action needed
  - If binding missing OR address mismatch: publish binding via `publishNametagBinding(nametag, proxyAddress)`
- **IMPORTANT:** Publish the **PROXY ADDRESS** (deterministic from nametag name), NOT the owner's address. The proxy address is where transfers to @nametag are delivered.
- **Best-effort, non-blocking:** Nostr failures do NOT block sync completion
- **Security note:** On-chain (aggregator) predicate ownership is the source of truth. Nostr bindings are a routing optimization only - they tell relays where to deliver token transfer events
- **Rationale:** Nametags can exist locally/IPFS but lack Nostr registration (e.g., imported from another device, recovered from backup, or initial publish failed)
- Track result in `SyncResult.stats.nametagsPublished` counter

**8.5a) Nametag-Aggregator Registration:** (skip if NAMETAG mode is TRUE)
- For each nametag token extracted in 8.4:
  - Reconstruct MintCommitment from `genesis.data` (preserving exact salt)
  - Query aggregator for inclusion proof: `getInclusionProof(requestId)`
  - If `authenticator !== null`: nametag is registered, no action needed
  - If `authenticator === null` (exclusion proof): trigger recovery via `recoverNametagProofs()`
- **Recovery Flow:**
  1. Re-submit genesis MintCommitment to aggregator (idempotent)
  2. Wait for inclusion proof (30s timeout in sync context)
  3. Update stored nametag token with fresh proof
  4. Trigger `step8_6_recoverNametagInvalidatedTokens()` to recover affected tokens
- **Best-effort, non-blocking:** Recovery failures logged but do NOT block sync completion
- **CRITICAL:** Salt must exist in `genesis.data.salt` for recovery to succeed
- Track result in `SyncResult.stats.nametagsRecovered` counter

#### Step 9: Prepare IPFS Sync

**9.1) Normalization:**
- Sort all token lists by token ID
- Normalize data structures

**9.2) Upload Decision:** (if in LOCAL mode, skip and set UPLOAD_NEEDED = FALSE)
- Calculate CID for reconstructed inventory
- Compare with IPFS CID from Step 2
- If same: no upload needed
- If different: perform deep comparison
  - If tokens added/updated: set UPLOAD_NEEDED = true
  - Write to localStorage first

#### Step 10: IPFS Upload (if UPLOAD_NEEDED, otherwise return SUCCESS right away)

**10.1) Conflict Check:**
- Resolve current IPNS
- If CID changed since Step 2: abort, restart from Step 1

**10.2) Upload:**
- Upload inventory to IPFS
- Get new CID

**10.3) IPNS Registration:**
- Publish CID to IPNS
- If ERROR_VERSION_COLLISION:
  - Check if our CID matches new IPNS record
  - If match: continue (race condition resolved)
  - If different: abort, restart from Step 1

**10.4) Persistence Verification:**
- Fetch inventory by our CID
- Retry for up to 5 minutes with exponential backoff (min once per minute)
- If fetch fails: go back to 10.2
- If content mismatch: go back to 10.2

**10.5) Success:**
- Clear UPLOAD_NEEDED flag
- **Update HWM:** Set `versionHwm = newVersion` (see Section 10.8)
- Return SUCCESS

**10.6) Circuit Breaker:**
- Track consecutive Step 1 restarts due to conflict (10.1 or 10.3 aborts)
- After 5 consecutive restarts: switch to LOCAL mode
- User notification: "Unable to sync - changes saved locally"
- Resume normal sync on next user-initiated action

---

## 7. Background Loops

### 7.1 receiveTokensToInventoryLoop

Monitors Nostr for incoming tokens. Runs continuously as single background instance. Uses a 3-phase model optimized for instant token receipt.

**Phase 1 - Collection (Critical Path):**
```
while (queue non-empty OR was non-empty ≤3s ago) {
  if (queue empty now) wait up to 3s for new tokens
  if (queue non-empty) {
    tokens_to_process = drain queue
    Save to localStorage immediately
    Call inventorySync({ instant_receive: true, incoming_token_list: tokens_to_process })
  }
}
```

**Phase 2 - Persisting (Background):**
- For each token confirmed in localStorage:
  - Trigger background IPFS sync (non-blocking)
  - After IPFS confirmation, remove respective Nostr event from relay
- Continue accepting new tokens while persisting

**Phase 3 - Finalizing:**
- Call `inventorySync()` in NORMAL mode to:
  - Fetch inclusion proofs for received tokens
  - Update spent token cache
  - Ensure inventory integrity
- Return to Phase 1

### 7.2 sendTokensFromInventory(send_token_list, payment_session_id?)

Called when user sends tokens (including splits and mints). Supports instant mode for faster user experience.

**Standard Mode (default):**

**1) Init Phase:**
- Call `inventorySync({ outbox_token_list: send_token_list })` (FAST mode)
- Persists commitments to IPFS
- Places tokens in Outbox

**2) Complete Phase:**
- Call `inventorySync()` (NORMAL mode)
- Fetches inclusion proofs
- Queues tokens for Nostr delivery
- Burns go directly to Sent folder

**INSTANT_SEND Mode:**

**1) Init Phase:**
- Call `inventorySync({ instant_send: true, outbox_token_list: send_token_list, payment_session_id })`
- Do NOT persist commitments to IPFS (can be recalculated if needed)
- Place tokens in Outbox with status READY_TO_SEND
- Queue tokens to Nostr immediately (Nostr serves as persistence layer)

**2) Complete Phase:**
- Do NOT call NORMAL sync
- Return immediately after Nostr delivery confirmed for payment session tokens
- Aggregator submission happens in sendViaNostrLoop after Nostr confirmation
- Background sync will handle IPFS persistence later

### 7.3 sendViaNostrLoop

Processes Nostr delivery queue in background. Supports payment session tracking for instant transfers.

**1) Collection Phase:**
- While queue non-empty:
  - Send up to 12 tokens in parallel
  - Confirm events registered with Nostr
  - On network error: retry with exponential backoff (max 1 minute)
  - Continue until queue empty

**2) Completion Phase:**
- Wait for queue to stay empty for 3 seconds
- Build `completed_list` with all sent tokens' IDs, state hashes, and proofs
- Call `inventorySync({ completed_list })`
- Moves completed tokens to Sent folder

**Payment Session Tracking (INSTANT_SEND mode):**
- Track which tokens belong to current payment session via `payment_session_id`
- Report success when ALL tokens from specific `payment_session_id` confirmed via Nostr
- Do NOT wait for unrelated tokens in queue to complete
- Continue processing other queued tokens in background
- Enables instant UI feedback: "3/5 tokens sent" progress reporting

**Fire-and-Forget Aggregator Submission (INSTANT_SEND mode):**
- **Trigger:** Immediately after each token is confirmed registered with Nostr relay
- **Rationale:** Nostr confirmation ensures transaction/commitment persistence before aggregator submission
- **Action:** Submit spending commitment to aggregator in background (non-blocking HTTP call)
- **No Wait:** Do not wait for aggregator response; recipients fetch their own inclusion proofs
- **Failure Handling:** If aggregator submission fails, recipient will submit commitment themselves (deferred proof acquisition)

### 7.4 LazyRecoveryLoop

Background task that recovers tokens lost due to IPFS cache corruption. Runs once per session, 10 seconds after app startup.

**Purpose:**
- Automatically recover tokens from IPFS version history if local cache is corrupted
- Non-blocking background operation with zero impact on main sync
- Provides resilience against cache corruption at client or sidecar level

**Configuration:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `lazyRecoveryDelayMs` | 10000 | Delay before starting recovery (ms) |
| `lazyRecoveryDepth` | 20 | Maximum versions to traverse |
| `lazyRecoveryTimeoutMs` | 120000 | Timeout for recovery operation (ms) |
| `lazyRecoveryJitter` | 0.5 | Random jitter ratio (±50%) for DHT load distribution |

**Execution Flow:**

**1) Scheduling Phase:**
- Wait 10 seconds after app initialization (with ±50% random jitter)
- Jitter prevents DHT query bursts when many users start simultaneously
- Run once per session only

**2) Recovery Phase:**
```
1. Get current identity from IdentityManager
2. Clear client-side IPNS cache (forces fresh resolution)
3. Call inventorySync() in RECOVERY mode with:
   - recoveryDepth: 20 (configurable)
   - skipExtendedVerification: true
4. RECOVERY mode traverses version chain via _meta.lastCid
5. Merge recovered tokens without overwriting existing
```

**3) Completion Phase:**
- Log recovery statistics (tokens recovered, versions traversed, duration)
- Mark `hasRun = true` to prevent retry
- On error: log and continue (non-critical operation)

**Status Monitoring:**
```typescript
const loopsManager = InventoryBackgroundLoopsManager.getInstance();
const status = loopsManager.getStatus().lazyRecovery;
// { hasRun, isRunning, isScheduled, completedAt, tokensRecovered }
```

**Performance Characteristics:**
- Zero impact on main sync operations (10-second delay ensures isolation)
- Memory: ~200KB transient during recovery
- Duration: 5-30 seconds depending on cache state
- CPU: 2-5% background usage

---

## 8. Multi-Instance Coordination

### 8.1 Tab Coordination

Use BroadcastChannel API for cross-tab communication.

**Leader Election:**
- Each tab has unique instanceId (UUID generated on load)
- Highest instanceId becomes leader (alphabetical comparison for tie-breaking)
- Leader performs IPNS publish operations
- Heartbeat every 3 seconds
- If no heartbeat for 10 seconds: declare leader dead, elect new

**Tie-Breaking:**
- If two tabs claim leadership simultaneously (rare race condition)
- Highest UUID (alphabetical comparison) wins
- Lower UUID yields and acknowledges higher as leader
- Ensures deterministic single leader in all scenarios

**Lock Acquisition:**
- Before sync: request lock via BroadcastChannel
- If another tab is syncing: wait (max 30 seconds timeout)
- On timeout: proceed anyway (prevents deadlock)

### 8.2 IPNS Conflict Resolution

When IPNS version collision detected:

1. Fetch the new remote version
2. Merge with local changes:
   - For same token: compare versions (more transactions wins)
   - New tokens: include from both sources
   - Tombstones: honor if verified against aggregator
3. Re-upload merged inventory
4. Retry IPNS publish

### 8.3 Concurrent Send Prevention

If two tabs try to send same token:

1. First tab's commitment gets included
2. Second tab's source state is already spent
3. Second tab detects this in spent detection
4. Second tab marks its outbox entry as FAILED
5. Token already in Sent folder from first tab

---

## 9. Recovery Mechanisms

### 9.1 Startup Recovery

On Sphere load:

1. Load wallet from localStorage
2. Check for orphaned outbox entries
3. For each non-COMPLETED outbox entry:
   - Resume based on status (see Outbox Lifecycle)
4. Start `inventorySync()` in NORMAL mode
5. Start background loops

### 9.2 Crash Recovery (Outbox)

For each outbox entry status:

| Status | Recovery Action |
|--------|-----------------|
| PENDING_IPFS_SYNC | Re-sync to IPFS |
| READY_TO_SUBMIT | Submit commitment to aggregator |
| SUBMITTED | Poll for inclusion proof |
| PROOF_RECEIVED | Retry Nostr delivery |
| NOSTR_SENT | Verify Nostr event, move to COMPLETED |

**Retry Policy:**
- Exponential backoff: 30s, 1m, 2m, 4m, 8m, 16m, 30m (max)
- After 10 consecutive failures: mark as FAILED
- FAILED entries require manual intervention

### 9.3 Boomerang Token Detection

When receiving a token (this check should be done at Step 8.0 "Outbox Processing"):

1. Check if tokenId exists in Outbox
2. If exists:
   - Compare stateHash with outbox entry
   - If same state: mark outbox FAILED (already finalized elsewhere)
   - If different state: this is a new state, process normally

### 9.4 Split Operation Atomicity

For token splits (burn + mint):

1. Create ALL commitments before submitting any
2. Save all to outbox with same `splitGroupId`
3. Submit burn commitment first
4. If burn succeeds: submit mint commitments immediately
5. Recovery: if any operation fails, retry based on outbox status

---

## 10. Error Handling

### 10.1 Error Categories

| Category | Examples | Action |
|----------|----------|--------|
| **Transient** | Network timeout, IPFS 503, aggregator unavailable | Retry with exponential backoff |
| **Permanent** | Invalid token structure, parse errors, bad signatures | Mark FAILED, log error |
| **Conflict** | REQUEST_ID_EXISTS, IPNS collision, state already spent | Resolve conflict, retry |
| **User-Recoverable** | Insufficient balance, nametag taken, storage quota | Show UI prompt |

### 10.2 Retry Policy

```
Transient errors:
  Delays: 1s, 2s, 4s, 8s, 16s, 30s, 60s (max)
  Total timeout: 5 minutes
  After timeout: escalate to permanent or user-recoverable

Aggregator calls (Step 3.2, 7.2):
  Retry forever (per spec requirement)
  Max delay: 60 seconds

IPFS operations:
  Retry for 5 minutes
  If all fail: mark sync as LOCAL_ONLY
  Set ipnsPublishPending flag
  Retry on next sync
```

### 10.3 User Notifications

| Scenario | Notification |
|----------|--------------|
| IPFS sync pending | "Sync pending - tokens may not be visible on other devices" |
| Outbox entry FAILED | "Transfer failed - please retry or contact support" |
| Integrity failure | Modal: "Critical error detected - please do not close" |
| Network offline | "Offline mode - some features unavailable" |

### 10.7 Circuit Breaker Reset

**Automatic LOCAL Mode Recovery:**

When LOCAL mode is activated automatically due to IPFS failures (Section 10.2), the system MUST attempt recovery:

**Reset Schedule:**
1. After 1 hour in LOCAL mode: attempt single IPFS ping
2. If ping succeeds: clear LOCAL flag, trigger NORMAL sync
3. If ping fails: wait another hour, repeat

**Implementation:**
```typescript
// Check on any user-triggered sync
if (isLocalMode && localModeActivatedAt < Date.now() - 3600000) {
  const pingSuccess = await ipfsPing();
  if (pingSuccess) {
    clearLocalMode();
    return inventorySync(); // NORMAL mode
  }
  // Reset timer for next attempt
  localModeActivatedAt = Date.now();
}
```

**User Control:**
- Manual "Retry IPFS" button always available in LOCAL mode
- Shows countdown: "Auto-retry in X minutes"
- Success clears LOCAL flag immediately

### 10.8 Version High Water Mark (HWM) Tracking

**Purpose:** Prevent accepting downgraded or corrupted data from stale IPNS cache. The HWM tracks the highest version ever successfully synced with IPFS for a given wallet address.

**Storage Key:** `sphere_version_hwm_${address}` (localStorage)

**Lifecycle:**
1. **Initialization:** HWM starts at 0 for new wallets
2. **Update on IPFS Load (Step 2):** When remote version > current HWM, update HWM
3. **Update on IPNS Publish (Step 10):** After successful publish, update HWM to new version

**Version Scenario Handling:**

| Scenario | Condition | Action |
|----------|-----------|--------|
| Remote regression | `remoteVersion < HWM` | Block upload, wait for IPNS cache refresh |
| Local ahead | `localVersion > remoteVersion` AND `remoteVersion >= HWM` | Allow upload (normal pending changes) |
| Remote ahead | `remoteVersion > localVersion` | Merge remote changes (another device synced) |
| Equal versions | `remoteVersion == localVersion` | Check content diff for merge |

**Stale Cache Detection:**
When `remoteVersion < HWM`:
- Log: `REMOTE VERSION REGRESSED: Remote vX < HWM vY`
- Set `networkErrorOccurred = true` to block upload
- Skip IPFS upload (we don't have correct `lastCid` for chain validation)
- Retry after IPNS cache refreshes (~30 seconds)

**Implementation:**
```typescript
// Storage key generator
STORAGE_KEY_GENERATORS.versionHighWaterMark(address) → `sphere_version_hwm_${address}`

// Update after successful IPFS load
if (remoteVersion > versionHwm) {
  localStorage.setItem(hwmKey, remoteVersion.toString());
}

// Update after successful IPNS publish
localStorage.setItem(hwmKey, newVersion.toString());
```

### 10.9 Server Chain Validation Contract

The IPFS sidecar server performs cryptographic chain validation on all IPNS updates. Clients MUST follow these rules for successful uploads.

**Version Increment Rule (CRITICAL):**
```
version = current_server_version + 1  (EXACTLY)
```
- Server rejects version skips (e.g., v7 → v9)
- Server rejects version regression (e.g., v7 → v5)
- Server rejects same version (e.g., v7 → v7)

**Chain Continuity Rule (CRITICAL):**
```
lastCid = current_server_cid  (EXACTLY)
```
- Each upload MUST reference the previous CID via `_meta.lastCid`
- Bootstrap (first upload): `lastCid` should be null or absent
- Updates: `lastCid` MUST match server's current CID

**`_meta` Field Requirements:**

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `version` | YES | integer | Must be ≥ 1, must increment by exactly 1 |
| `lastCid` | YES (updates) | string | Must match server's current CID |
| `address` | YES | string | Wallet address |
| `ipnsName` | YES | string | IPNS name (peer ID) |
| `formatVersion` | YES | string | "2.0" |

**Rate Limiting:**

| Scope | Limit | Purpose |
|-------|-------|---------|
| Global | 100 req/sec | Prevent DDoS |
| Per IP | 30 req/min | Prevent abuse from single source |
| Per IPNS Name | 1 req/sec | Prevent rapid-fire updates |

**Error Responses:**

| Error | Cause | Client Action |
|-------|-------|---------------|
| `version_mismatch` | Version != current + 1 | Refetch IPNS, recalculate version |
| `chain_break` | lastCid != current CID | Refetch IPNS, use correct lastCid |
| `missing_meta_field` | _meta field absent | Add _meta to payload |
| `fetch_failed` | Server couldn't fetch CID content | Ensure content is pinned/accessible |
| `rate_limited` | Too many requests | Back off and retry |

### 10.10 Version Calculation for IPFS Uploads

**CRITICAL: Use `remoteVersion + 1`, NOT `max(local, remote) + 1`**

**Rationale:**
The server's chain validation requires exactly `current_version + 1`. When local version is ahead of remote (due to failed previous uploads), using `max()` sends a version the server doesn't expect.

**Example Failure Scenario (OLD behavior):**
```
1. Remote has v7, local has v8 (previous upload failed)
2. Client calculates: max(8, 7) + 1 = 9
3. Client sends v9
4. Server expects v8 (current=7, expects 7+1=8)
5. Server rejects: "VERSION MISMATCH: Expected 8, got 9"
```

**Correct Behavior (NEW):**
```
1. Remote has v7, local has v8 (previous upload failed)
2. Client calculates: 7 + 1 = 8
3. Client sends v8
4. Server accepts (current=7, expects 8, got 8) ✓
```

**Implementation:**
```typescript
// In buildStorageDataFromContext()
const newVersion = ctx.remoteVersion > 0
  ? ctx.remoteVersion + 1    // Server expects exactly this
  : ctx.localVersion + 1;     // First upload (no remote data)
```

**Content Merging:**
- Content is merged from BOTH local and remote sources
- Version number is purely for chain ordering
- Local-ahead scenario triggers upload to sync local changes to IPFS

### 10.11 Fast Sync Mode (skipExtendedVerification)

**Purpose:** Reduce IPFS upload + IPNS publish latency from ~4-5 seconds to <1 second for UX-critical paths.

**When to Use:**
- Pre-transfer IPFS sync (in critical path before sending tokens)
- LazyRecoveryLoop (background operation)

**What Gets Skipped:**
| Check | Normal Mode | Fast Mode |
|-------|-------------|-----------|
| Content upload HEAD verification | 3 retries, 600ms delays | Skip (HTTP 200 = persisted) |
| IPNS verification retries | 3 retries, ~2.8s total | 1 quick check, 50ms |

**Safety Guarantee:**
- HTTP 200 response from backend guarantees content persistence
- Verification retries only confirm indexing/propagation, not persistence
- Fast mode is safe because persistence is the critical requirement

**Usage:**
```typescript
await inventorySync({
  skipExtendedVerification: true  // Enable fast mode
});
```

**Performance Impact:**
| Operation | Normal Mode | Fast Mode |
|-----------|-------------|-----------|
| Content upload | ~2.5s | ~2.1s |
| IPNS publish | ~1.5s | ~0.35s |
| Total | ~4-5s | ~2.5s |

---

## 11. Network Management

### 11.1 Connection Limits

| Resource | Limit |
|----------|-------|
| WebSocket per IP:port | 1 connection |
| Aggregator read calls | 24 concurrent |
| Aggregator write calls | 24 concurrent |
| IPFS gateway calls | 12 per gateway |
| Nostr relay sends | 12 concurrent |

### 11.2 Request Queuing

Implement queues for:
- Aggregator read operations (getInclusionProof, etc.)
- Aggregator write operations (submitCommitment, etc.)
- IPFS operations (per gateway)

Queue behavior:
- FIFO within same priority
- Higher priority jumps queue
- Timeout: 30 seconds per request (configurable)

---

## 12. Sync Triggers

| Trigger | Mode | Priority |
|---------|------|----------|
| Sphere main page load | NORMAL | HIGH |
| Restore from backup | NORMAL | HIGH |
| IPFS polling detects change | NORMAL | MEDIUM |
| Receive tokens via Nostr | FAST → NORMAL | HIGH |
| Send tokens | FAST → NORMAL | HIGH |
| wallet-updated event | NORMAL | LOW |
| Wallet import/onboarding | NAMETAG | HIGH |
| Login page nametag display | NAMETAG | MEDIUM |

---

## 13. Edge Cases

### 13.1 Network Partition During Split

**Scenario:** Burn succeeds, network fails before mints complete.

**Resolution:**
1. All operations saved to outbox with splitGroupId
2. On recovery: check burn status
3. If burn committed: continue with mints
4. If burn not committed: retry entire split

### 13.2 Import from Backup with Pending Outbox

**Scenario:** User restores backup while outbox has pending transfers.

**Resolution:**

*Note: No special implementation required - this case resolves automatically during normal inventorySync run.*

1. Detect conflicts (same tokenId in backup and outbox)
2. For each conflict: verify against aggregator
3. If aggregator shows spent: keep outbox version, discard backup
4. If aggregator shows unspent: keep backup, mark outbox FAILED

### 13.3 IPNS Publish Timeout

**Scenario:** IPNS publish retries for 5 minutes without success.

**Resolution:**
1. Mark sync as LOCAL_ONLY
2. Set ipnsPublishPending flag
3. User can continue using wallet
4. Show warning: "Sync pending"
5. Retry on next sync attempt

### 13.4 Integrity Failure

**Scenario:** Same stateHash maps to different data.

**Resolution:**
1. CRITICAL ERROR - should never happen
2. Log all details to console
3. Freeze Sphere UI
4. Show modal with technical details
5. Require user to export data and contact support

### 13.5 Partial Sync Failure

**Scenario:** `inventorySync()` fails mid-operation (e.g., Step 7 proof fetching fails 50% through).

**Resolution:**
1. Catch exception and preserve pre-sync localStorage state
2. Do NOT persist incomplete merge to localStorage
3. Return error: `PARTIAL_SYNC_FAILED`
4. Queue full NORMAL sync on next cycle
5. User notification: "Sync interrupted - will retry"

### 13.6 Nostr Relay Unavailable (24+ Hours)

**Scenario:** Token reaches PROOF_RECEIVED but all Nostr relays unreachable.

**Resolution:**
1. Continue retry with exponential backoff (max 1 hour between attempts)
2. After 24 hours: mark outbox entry as FAILED
3. User notification: "Transfer queued - awaiting network"
4. Token remains in Outbox, NOT in Sent or Active
5. User options: manual retry, request recipient pull from IPNS, contact support

### 13.7 Conflicting Aggregator Proofs

**Scenario:** Two proofs fetched for same requestId with different data.

**Resolution:**
1. Compare round numbers:
   - Different rounds: keep highest round (normal behavior)
   - SAME round with different signatures: CRITICAL ERROR
2. On CRITICAL ERROR:
   - Log all proof details
   - Mark token as INVALID with reason AGGREGATOR_CONFLICT
   - Freeze UI with modal
   - Stop all syncing until manual intervention

### 13.8 localStorage Cleared During Sync

**Scenario:** Browser clears storage quota during `inventorySync()`.

**Detection:**
1. At sync start: verify wallet data exists
2. During Step 1: verify nametag present
3. During Step 8: atomic batch writes with rollback

**Resolution:**
1. If wallet missing: abort with WALLET_STORAGE_LOST
2. If nametag missing: log warning, continue (may lose nametag)
3. If write fails: rollback, return STORAGE_QUOTA_EXCEEDED
4. User must re-import wallet from seed/backup

### 13.9 Tab Race During Concurrent Operations

**Scenario:** Two tabs sync simultaneously with overlapping token operations.

**Resolution:**
1. Lock covers Steps 8-10 (merge through IPNS publish)
2. On 30-second timeout: wait 10 more seconds for status update
3. If lock holder published: use new version as base
4. If lock holder failed: proceed with exponential backoff on 10.3
5. Tab B's changes trigger restart from Step 1 via conflict detection

### 13.10 Split Operation Partial Failure

**Scenario:** Burn succeeds but one mint is rejected by aggregator.

**Resolution:**
1. All operations in outbox with same splitGroupId
2. Failed mints retry with exponential backoff (10 attempts max)
3. After 10 failures on a mint: mark as ABANDONED
4. Show UI:
   - Burned amount, successfully reminted amount, failed amount
   - Options: "Retry now", "Retry later", "Recover" (consolidate back)

### 13.11 Hash Mismatch During Spent State Verification

**Scenario:** Computed state hash differs from stored state hash.

**Resolution:**
1. Do NOT query aggregator (hash is wrong, would return false positive)
2. Return UNSPENT as safe default (prevents deleting valid tokens)
3. Log warning with full token details
4. Continue validation normally
5. Same behavior in dev and production modes

### 13.12 Nametag Proof Staleness

**Scenario:** During transfer to PROXY address, nametag verification fails with stale proof.

**Resolution:**
1. Detect "Nametag tokens verification failed" error
2. Call refreshNametagProof() to fetch latest from aggregator
3. Retry finalization with refreshed proof
4. If still fails: mark as FAILED with clear error

### 13.13 Orphaned Split Token Recovery

**Scenario:** Split fails mid-way, orphaned change tokens need recovery.

**Resolution:**
1. On startup: scan archived tokens for potential orphans
2. Query aggregator to find orphaned tokens by ID pattern
3. If found unspent: add back to Active folder
4. If found spent: create tombstone

### 13.14 Address Switch IPNS Re-derivation

**Scenario:** User switches wallet addresses.

**Resolution:**
1. Clear cached IPNS keys immediately
2. Re-derive IPNS name for new identity
3. Start fresh sync with new IPNS name
4. Old address data remains in its IPNS (not deleted)

### 13.15 Event Deduplication Overflow

**Scenario:** More than 100 unique Nostr events received.

**Resolution:**
1. Maintain 100-event FIFO cache for deduplication
2. When exceeding 100: oldest events cycle out
3. Risk: replayed old events may be re-processed
4. Mitigation: rely on token ID deduplication in Step 6

### 13.16 COMPLETED Entry Cleanup

**Scenario:** COMPLETED outbox entries accumulate.

**Resolution:**
1. Clean COMPLETED entries after 24 hours
2. Prevents unbounded localStorage growth
3. Sent folder entry provides permanent audit trail

### 13.17 Source Token Verification Before Resubmission

**Scenario:** Outbox recovery from READY_TO_SUBMIT.

**Resolution:**
1. Before resubmitting: verify source token not already spent
2. If spent: mark outbox entry FAILED
3. If unspent: proceed with submission
4. Prevents wasted aggregator calls

### 13.18 Receive Token Before IPFS Sync

**Scenario:** Token received via Nostr, browser closes before IPFS sync.

**Resolution:**
1. Save token to localStorage immediately
2. Sync to IPFS (HIGH priority)
3. Only after IPFS sync: mark Nostr event as processed
4. If browser closes before IPFS: token saved locally, event replayed on reconnect

### 13.19 Multi-Hop Boomerang Detection

**Scenario:** A sends to B, B sends to C, C sends back to A.

**Resolution:**
1. Check Outbox: if tokenId exists and stateHash matches -> FAILED
2. Check Sent: if tokenId exists with OLDER timestamp -> valid multi-hop
3. Check Sent: if tokenId exists with NEWER timestamp -> discard (stale event)
4. Proceed normally if different stateHash (genuinely new state)

### 13.20 SPLIT_BURN vs SPLIT_MINT Terminal Handling

**Scenario:** Different outbox types have different terminal paths.

**Resolution:**
1. SPLIT_BURN at PROOF_RECEIVED: mark COMPLETED (burned, never sent via Nostr)
2. SPLIT_MINT at PROOF_RECEIVED: mark COMPLETED (already saved via mint callback)
3. DIRECT_TRANSFER at PROOF_RECEIVED: continue to NOSTR_SENT -> COMPLETED

### 13.21 NAMETAG Mode with Incoming Tokens

**Scenario:** NAMETAG mode called while incoming_token_list is non-empty.

**Resolution:**
1. Mode precedence: NAMETAG takes priority over FAST
2. Ignore incoming_token_list (will be processed on next NORMAL sync)
3. Log warning: "NAMETAG mode ignoring incoming tokens"
4. Proceed with nametag-only fetch

### 13.22 Nametag Token Spent During Sync

**Scenario:** One of user's nametag tokens has been spent (transferred or burned).

**Resolution:**
1. NAMETAG mode detects spent state in Step 8.4
2. Exclude spent nametag from returned list
3. If that was the only nametag: UI shows "Your Unicity ID @name is no longer valid"
4. User may still have other valid nametags, or can create a new one

### 13.23 Nametag Storage Migration

**Scenario:** Legacy IPFS data stores nametags in old format (e.g., single `_nametag` field instead of token entries).

**Resolution:**
1. During sync: detect legacy format
2. Convert to new format: store each nametag as a proper token entry
3. Preserve `_nametag` field for backwards compatibility with older clients
4. Log: "Migrated nametag storage to new format"

### 13.24 NAMETAG Mode Network Timeout

**Scenario:** IPFS fetch times out during NAMETAG mode.

**Resolution:**
1. Fall back to localStorage nametags if available
2. Return cached nametags with `stale: true` indicator
3. UI shows: "Using cached identity - network unavailable"
4. No retry loop (unlike NORMAL mode)

### 13.25 Split Burn Recovery

**Scenario:** During a token split, burn succeeds but ALL mint operations fail after 10 retries.

**Problem:** Without recovery, the burned token value is permanently lost. The burn transaction is already included in the aggregator, so the original token state cannot be used again.

**Resolution:**
1. After 10 consecutive mint failures for ALL mints in a split group:
   - Create recovery mint commitment to ORIGINAL OWNER (self)
   - Amount: sum of all failed mint amounts
   - Persist recovery commitment to outbox with `isRecoveryMint: true` flag
2. Submit recovery mint to aggregator
3. On success: mark split as PARTIALLY_RECOVERED
4. On failure: retry recovery mint with exponential backoff (no retry limit)

**Implementation:**
```typescript
interface RecoveryMintEntry extends OutboxEntry {
  isRecoveryMint: true;
  originalSplitGroupId: string;
  failedRecipients: Array<{
    address: string;
    amount: string;
  }>;
}
```

**User Notification:**
- "Token split partially failed. X tokens recovered to your wallet. Y tokens could not be delivered to [recipients]."

**Rationale:** This ensures no value is permanently lost due to transient failures. The original owner can manually retry transfers after recovery.

### 13.26 Automatic Nametag Proof Recovery

**Scenario:** During nametag proof refresh, the aggregator returns an exclusion proof for the genesis commitment.

**Problem:** When a nametag token's genesis commitment returns an exclusion proof from the aggregator (meaning the aggregator's Merkle tree doesn't contain the commitment), the user cannot receive tokens because SDK verification fails. The commitment was previously accepted but is no longer in the tree (e.g., after aggregator reset).

**Trigger Points:**
Recovery is triggered from three locations:
1. **Token receipt finalization** (reactive): When `refreshNametagProof()` is called during token finalization and detects an exclusion proof
2. **Inventory sync Step 8.5a** (proactive): During `inventorySync()`, checks aggregator registration and triggers recovery if missing
3. **L3WalletView validation** (proactive): On wallet load, `validateUnicityId()` checks aggregator and triggers recovery if `isOnAggregator === false`

**Detection:** In `refreshNametagProof()`:
1. Reconstruct MintCommitment from stored genesis data
2. Query aggregator with `getInclusionProof(requestId)`
3. If `authenticator === null`: trigger automatic recovery

**Resolution:**
1. Re-submit genesis MintCommitment via `submitMintCommitment()`
   - `SUCCESS`: New commitment accepted
   - `REQUEST_ID_EXISTS`: Commitment already exists (idempotent)
2. Wait for inclusion proof via `waitInclusionProof()` (60s timeout)
3. Update `genesis.inclusionProof` with fresh proof
4. Save updated token to storage
5. **Recover previously invalidated tokens** (see below)
6. Return updated token for immediate use

**Token Recovery After Nametag Proof Fix:**

Tokens that were invalidated due to nametag inclusion proof failures can now be recovered.

**CRITICAL INSIGHT - Embedded Nametags:**
Each received token has an **embedded copy** of the nametag in its `nametags` array. The SDK's `Token.verify()` validates this embedded nametag, NOT the main stored nametag. Simply updating the main nametag does NOT fix already-finalized tokens - we must update the EMBEDDED nametag within each invalid token.

**Recovery Flow:**
1. Load `_invalid` array from localStorage
2. Get current nametag with fresh inclusion proof from storage
3. Filter for tokens with:
   - `reason === "SDK_VALIDATION"`
   - `details` contains "Inclusion proof verification failed" or "Nametag verification"
4. **For each invalid token, update the EMBEDDED nametag's proof:**
   - Parse token's `nametags` array
   - Find embedded nametag matching our nametag's `tokenId`
   - Replace embedded nametag's `genesis.inclusionProof` with fresh proof
5. Re-validate each token using `TokenValidationService.validateToken()`
   - Validation now passes because the embedded nametag has valid proof
6. For tokens that pass validation:
   - Add back to active inventory via `addToken()`
   - Remove from `_invalid` array
7. Trigger `wallet-updated` event for UI refresh

**Implementation:**
- `TokenRecoveryService.recoverNametagInvalidatedTokens()` - called after successful nametag proof recovery
- `TokenRecoveryService.updateEmbeddedNametagProof()` - helper to fix embedded nametag

**Idempotency:**
- Salt is preserved from original genesis data (NEVER regenerated)
- requestId is deterministically derived from tokenId
- Re-submission is safe (idempotent) - same commitment can be resubmitted

**Technical Note - Salt's Role in Commitment:**
| Component | Affected by Salt? | Explanation |
|-----------|------------------|-------------|
| tokenId | ❌ NO | `tokenId = SHA256(nametag)` |
| requestId | ❌ NO | `requestId = f(tokenId)` only |
| transactionHash | ✅ YES | `transactionHash = SHA256(CBOR(...salt...))` |
| authenticator | ✅ YES | Signature over transactionHash |

**Implication:** We can fetch the proof using just tokenId → requestId, but the reconstructed Token must use the exact same salt for SDK verification to pass (transactionHash must match authenticator signature).

**Error Handling:**
- If re-submission fails: throw error with clear message
- If proof timeout (60s): throw error, user may retry later
- If SDK validation fails after recovery: propagate original error
- Token recovery failures are non-fatal: logged but don't prevent nametag recovery from completing

**Implementation Locations:**
- `NametagService.recoverNametagProofs()` - called from `refreshNametagProof()` when exclusion proof detected
- `TokenRecoveryService.recoverNametagInvalidatedTokens()` - called after successful nametag proof recovery
- `TokenRecoveryService.updateEmbeddedNametagProof()` - updates embedded nametag's proof within a token

### 13.27 INSTANT_SEND Aggregator Failure

**Scenario:** Background aggregator submission fails after Nostr delivery.

**Resolution:**
1. Recipient will submit commitment themselves (deferred proof acquisition)
2. Sender's token shows as "Sent (unconfirmed)" until recipient confirms
3. Sender's Sent folder entry updated when proof becomes available
4. No action required from sender - transfer completes from recipient side

### 13.28 INSTANT_RECEIVE IPFS Failure

**Scenario:** Background IPFS sync fails after token saved to localStorage.

**Resolution:**
1. Token usable locally immediately
2. Retry IPFS sync on next NORMAL sync cycle
3. Nostr event retained until IPFS confirms
4. If IPFS fails persistently: token remains in localStorage, user warned about cross-device sync

### 13.29 Payment Session Partial Delivery

**Scenario:** 3 of 5 tokens in payment session delivered via Nostr.

**Resolution:**
1. Report partial success to UI: "3/5 tokens sent"
2. Continue delivery attempts for remaining 2 tokens
3. User sees real-time progress updates
4. After 10 retries per token: mark failed tokens individually
5. Successful tokens already in Sent folder

### 13.30 Sender Recovery Duplicate Detection

**Scenario:** Recovered token already exists in Sent folder.

**Resolution:**
1. Compare by `tokenId:stateHash` composite key
2. Skip without error if match found
3. Log: "Skipping duplicate recovered token: {tokenId}"
4. Continue processing remaining recovered tokens

### 13.31 Sender Recovery During Active Send

**Scenario:** Recovery runs while tokens are being sent.

**Resolution:**
1. Check outbox before adding recovered tokens
2. Exclude outbox tokens from recovery (marked as in-flight)
3. Only recover tokens not currently in outbox
4. Prevents duplicate send attempts

### 13.32 Unconfirmed Balance Display

**Scenario:** Token received but inclusion proof not yet fetched.

**Resolution:**
1. Display in UI as "Unconfirmed: X tokens (value)"
2. Separate unconfirmed balance from confirmed balance
3. Allow spending only after confirmation (proof acquired)
4. Background task fetches proofs automatically

### 13.33 Recipient Proof Fetch Failure

**Scenario:** Recipient cannot fetch inclusion proof for received token.

**Resolution:**
1. Retry with exponential backoff (1s, 2s, 4s, 8s, 16s, 30s, 60s max)
2. After 10 failures: mark token as PENDING_PROOF
3. Token visible in inventory but not spendable
4. Show status: "Awaiting confirmation"
5. Continue retrying in background (no limit)

---

## 14. Sender Token Recovery from Nostr

### 14.1 Purpose

Allow senders to recover tokens they have sent if localStorage is lost before IPFS sync completes. This leverages the NIP-04 symmetric encryption property where both sender and recipient can decrypt the same event.

### 14.2 Technical Background

- NIP-04 uses ECDH to create shared secret between sender and recipient
- Shared secret is symmetric: `ECDH(senderPriv, recipientPub) = ECDH(recipientPriv, senderPub)`
- Token transfer events contain: encrypted payload, sender pubkey (author), recipient pubkey (#p tag)
- Sender can query own events: `{ authors: [myPubkey], kinds: [TOKEN_TRANSFER] }`

### 14.3 Recovery Flow

```
1. Query Nostr: { authors: [walletPubkey], kinds: [TOKEN_TRANSFER], since: cutoffTime }
2. For each event:
   a. Extract recipientPubkey from #p tag
   b. Decrypt payload using TokenTransferProtocol.parseTokenTransfer()
   c. Extract token data and transfer transaction
3. For each recovered token:
   a. Validate token structure
   b. Check if already in Sent folder (avoid duplicates)
   c. Add to Sent folder with proof (if available)
4. Trigger NORMAL sync to persist recovered data to IPFS
```

### 14.4 Constraints

- Recovery returns only SENT tokens (not active tokens)
- Tokens without Nostr events (burned tokens, direct transfers via other channels) cannot be recovered
- Event deletion by recipient does not prevent sender recovery (events tagged with #p)
- Recovery requires wallet private key (cannot recover from public key alone)

### 14.5 Implementation: SenderRecoveryService

```typescript
interface SenderRecoveryService {
  recoverSentTokensFromNostr(options: {
    since?: number,      // Unix timestamp cutoff
    limit?: number,      // Max events to fetch
  }): Promise<RecoveryResult>;
}

interface RecoveryResult {
  tokensRecovered: number;
  tokensSkipped: number;  // Already in Sent folder
  errors: RecoveryError[];
}

interface RecoveryError {
  eventId: string;
  reason: string;
}
```

### 14.6 Trigger Conditions

Sender recovery should be triggered:
1. **Manual trigger:** User clicks "Recover sent tokens" button
2. **Automatic on wallet restore:** After importing wallet from seed phrase
3. **Automatic on fresh device:** When Sent folder is empty but Nostr has historical events

### 14.7 Performance Considerations

- Query with reasonable `since` timestamp (default: 30 days)
- Use pagination (`limit`) for large result sets
- Cache already-processed event IDs to avoid re-processing
- Run recovery in background to avoid blocking UI

---

## Appendix: Data Structures

### A.1 TxfStorageData (IPFS)

```typescript
interface TxfStorageData {
  _meta: {
    version: number;
    address: string;
    ipnsName: string;
    formatVersion: "2.0";
    lastCid?: string;
    deviceId?: string;
  };
  _nametag?: NametagData;      // Primary minted nametag (additional nametags stored as tokens)
  _tombstones?: TombstoneEntry[];
  _outbox?: OutboxEntry[];
  _mintOutbox?: MintOutboxEntry[];
  _sent?: SentTokenEntry[];
  _invalid?: InvalidTokenEntry[];
  // Active tokens: _<tokenId>
  // Archived: _archived_<tokenId>
  // Forked: _forked_<tokenId>_<stateHash>
}
```

### A.2 Spent Token Cache (localStorage only)

```typescript
interface SpentCacheEntry {
  isSpent: true;
  timestamp: number;
  inclusionProof: InclusionProof;
}

// Key format: "tokenId:stateHash:publicKey"
// Storage key: "unicity_spent_token_cache"
```

### A.3 Tombstone Entry

```typescript
interface TombstoneEntry {
  tokenId: string;
  stateHash: string;
  timestamp: number;
}
```

**Note:** Same tokenId can have multiple tombstones (for forked states). Token can return with a NEW stateHash even if previous state is tombstoned.

### A.4 Validation Cache (localStorage)

Caches SDK validation results to avoid repeated expensive validation calls.

```typescript
interface ValidationCacheEntry {
  valid: boolean;
  timestamp: number;
  stateHash: string;
}

// Key format: "tokenId:stateHash"
// Storage key: "sphere_validation_cache"
// TTL: 24 hours
```

**Cache Behavior:**
- Only VALID results are cached (invalid tokens may become valid after proof recovery)
- Cache is cleared when IPFS inventory changes significantly
- Reduces validation time by ~96% on hot cache (2.5-3.9s → ~100ms)

### A.5 Version High Water Mark (localStorage)

Tracks highest version ever successfully synced with IPFS.

```typescript
// Key format: "sphere_version_hwm_${address}"
// Value: version number as string (e.g., "42")
```

**Purpose:** Prevents accepting downgraded data from stale IPNS cache. See Section 10.8.
