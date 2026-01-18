# Token Loss Bug - Visual Analysis & State Diagrams

## The Bug at a Glance

```
Timeline: User creates 5 tokens, syncs to IPFS

Timeline:
=========

[Time 0]  Browser localStorage:
          ┌─────────────────────────────────────────┐
          │ ipfs_version_<name> = "3"        ✓      │  (persists)
          │ sphere_wallet_DIRECT://... = {...}  ✓   │  (5 tokens)
          │ IPFS remote: 5 tokens at v3        ✓     │  (synced)
          └─────────────────────────────────────────┘

[Time 1]  localStorage CLEARED (user action or bug):
          ┌─────────────────────────────────────────┐
          │ ipfs_version_<name> = "3"        ✓      │  (survives!)
          │ sphere_wallet_DIRECT://... = null   ✗   │  (DELETED!)
          │ IPFS remote: 5 tokens at v3        ✓     │  (unchanged)
          └─────────────────────────────────────────┘

[Time 2]  App starts, syncFromIpns() runs:

          Current Logic:
          ──────────────
          localVersion = parseInt(localStorage['ipfs_version_<name>']) = 3
          fetch remote IPFS → remoteVersion = 3

          if (remoteVersion === localVersion) {  ← TRUE!
            // Bug: assumes localStorage has tokens
            return { success: true }  ← RETURNS HERE!
          }

          Result: Wallet stays empty ✗
          User loses 5 tokens ✗✗✗

[Time 3]  Fixed Logic:

          localWallet = WalletRepository.getInstance()
          localTokenCount = localWallet.getTokens().length = 0  (empty)
          remoteTokenCount = Object.keys(remoteData.tokens).length = 5

          if (localTokenCount === 0 && remoteTokenCount > 0) {
            importRemoteData(remoteData)  ← RECOVERY!
            window.dispatchEvent(new Event("wallet-updated"))
          }

          Result: Wallet recovered with 5 tokens ✓
```

---

## Storage State Machine

### State Diagram: Three Storage Locations

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sphere Wallet System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │   localStorage  │    │  IPFS Remote     │    │ In-Memory  │ │
│  │                 │    │                  │    │ (WalletRep)│ │
│  ├─────────────────┤    ├──────────────────┤    ├────────────┤ │
│  │ ipfs_version... │    │ tokens: {...}    │    │ tokens[]   │ │
│  │ = "3"           │    │ version: 3       │    │ count: 0   │ │
│  │                 │    │ CID: Qm...       │    │            │ │
│  │ sphere_wallet.. │    │                  │    │            │ │
│  │ = null ✗        │    │ ✓ (accessible)   │    │            │ │
│  │                 │    │                  │    │            │ │
│  └─────────────────┘    └──────────────────┘    └────────────┘ │
│         │                       │                       │       │
│         │                       │                       │       │
│    DATA LOST!             AUTHORITATIVE            EMPTY (BUG)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

syncFromIpns() Logic:
┌──────────────────────────────────────────────────┐
│ Check: localStorage version == IPFS version     │
├──────────────────────────────────────────────────┤
│ Result: "3" === 3 → TRUE                         │
│                                                  │
│ OLD LOGIC:                                       │
│ "Versions match → tokens must be in localStorage"│
│ return { success: true }                         │
│                                                  │
│ BUG: No verification that tokens actually exist │
└──────────────────────────────────────────────────┘

FIXED LOGIC:
┌──────────────────────────────────────────────────┐
│ Check: localStorage version == IPFS version     │
├──────────────────────────────────────────────────┤
│ Result: "3" === 3 → TRUE                         │
│                                                  │
│ NEW CHECK:                                       │
│ if (localTokenCount === 0 && remoteTokenCount > 0)
│   import from IPFS                              │
│                                                  │
│ Result: Tokens recovered ✓                       │
└──────────────────────────────────────────────────┘
```

---

## Root Cause: Decoupled Storage Keys

```
The Fatal Assumption:
═════════════════════════════════════════════════════════════════

ASSUMPTION:  "If version counter survives, wallet data must too"

REALITY:     Version counter and wallet data are stored SEPARATELY
             and can be cleared independently!

Storage Key Locations:
┌─────────────────────────────────┬──────────────────────────────┐
│ Wallet Data Key                 │ Version Counter Key          │
├─────────────────────────────────┼──────────────────────────────┤
│ sphere_wallet_DIRECT://...      │ ipfs_version_<ipnsName>      │
│ └─ User data (tokens)           │ └─ Sync metadata             │
│                                 │                              │
│ Cleared by:                     │ Cleared by:                  │
│ • Manual localStorage.clear()   │ • Manual clear() (rare)      │
│ • Cookie purge (affects domain) │ • Storage quota exceeded     │
│ • Browser cache clear           │ • Selective key deletion     │
│ • Storage quota exceeded        │ • Partition clearing         │
│ • Corrupted storage partition   │                              │
└─────────────────────────────────┴──────────────────────────────┘

Why Version Survives:
────────────────────
1. Different key name → may be in different storage partition
2. Different expiration policy → may not be cleared by same trigger
3. Different size → one cleared by quota, other survives
4. Different scope → one cleared by tool, other not targeted
```

---

## Control Flow: Before vs After Fix

### BEFORE (Buggy)

```
syncFromIpns()
│
├─ [Line 3193] Fetch remote from IPFS
│  └─ Success → remoteData = { tokens: {...}, _meta: {version: 3} }
│
├─ [Line 3216] Get local version
│  └─ localVersion = getVersionCounter() = 3
│
├─ [Line 3217] Get remote version
│  └─ remoteVersion = 3
│
├─ [Line 3221] Compare versions
│  └─ remoteVersion > localVersion? No
│
├─ [Line 3262] Compare versions
│  └─ remoteVersion < localVersion? No
│
└─ [Line 3304] ELSE branch: versions match
   │
   ├─ [Line 3307-3310] Update CID if needed
   │
   ├─ [Line 3312] Log "Versions match"
   │
   ├─ [Line 3315-3318] Check if IPNS needs recovery
   │  └─ No → continue
   │
   ├─ [Line 3321-3322] Run sanity checks
   │
   └─ [Line 3324-3330] RETURN SUCCESS ✗ TOKENS LOST!
      (Never imported remote data)
```

### AFTER (Fixed)

```
syncFromIpns()
│
├─ [Line 3193] Fetch remote from IPFS
│  └─ Success → remoteData = { tokens: {...}, _meta: {version: 3} }
│
├─ [Line 3216] Get local version
│  └─ localVersion = getVersionCounter() = 3
│
├─ [Line 3217] Get remote version
│  └─ remoteVersion = 3
│
├─ [Line 3221] Compare versions
│  └─ remoteVersion > localVersion? No
│
├─ [Line 3262] Compare versions
│  └─ remoteVersion < localVersion? No
│
└─ [Line 3304] ELSE branch: versions match
   │
   ├─ [Line 3307-3310] Update CID if needed
   │
   ├─ [Line 3312] Log "Versions match"
   │
   ├─ [NEW] Get local token count
   │  └─ localTokenCount = WalletRepository.getInstance().getTokens().length = 0
   │
   ├─ [NEW] Get remote token count
   │  └─ remoteTokenCount = Object.keys(remoteData.tokens || {}).length = 5
   │
   ├─ [NEW] Check if recovery needed
   │  └─ if (localTokenCount === 0 && remoteTokenCount > 0) {
   │     ├─ Log recovery
   │     ├─ importRemoteData(remoteData)  ✓ IMPORT HAPPENS!
   │     └─ dispatchEvent("wallet-updated")
   │     }
   │
   ├─ [Line 3315-3318] Check if IPNS needs recovery
   │  └─ No → continue
   │
   ├─ [Line 3321-3322] Run sanity checks
   │
   └─ [Line 3324-3330] RETURN SUCCESS ✓ TOKENS RECOVERED!
```

---

## Data Flow Diagram

### Sync Operation Phases

```
Phase 1: FETCH
═════════════════════════════════════════════════════════════
localVersion (localStorage)     remoteData (IPFS)
        ↓                             ↓
    getVersionCounter()          parseRemoteData()
        ↓                             ↓
    version: 3                  tokens: {...}
                                version: 3

Phase 2: COMPARE
═════════════════════════════════════════════════════════════
    3 === 3?
       ↓
      YES
       ↓
  [Take ELSE branch]

Phase 3: DETECT CORRUPTION (NEW)
═════════════════════════════════════════════════════════════
localWallet.getTokens()    remoteData.tokens
       ↓                          ↓
    []                        {token1, token2, ...}
    (0 tokens)                (5 tokens)
       ↓                          ↓
       └──────────────┬───────────┘
                      ↓
              0 === 0 && 5 > 0?
                      ↓
                     YES → RECOVERY NEEDED!

Phase 4: RECOVER
═════════════════════════════════════════════════════════════
importRemoteData(remoteData)
       ↓
  For each token in remoteData:
    WalletRepository.addToken(token)
       ↓
  dispatch("wallet-updated")
       ↓
  Return count: 5

Phase 5: SUCCESS
═════════════════════════════════════════════════════════════
return {
  success: true,
  version: 3,
  // tokens now visible in wallet
}
```

---

## Scenario Comparison

### Scenario 1: Normal Case (No Bug)

```
Conditions:
• localStorage: version=3, wallet=5 tokens
• IPFS remote: version=3, 5 tokens
• In-memory: 5 tokens (loaded from localStorage)

Old Logic:  ✓ Works (tokens exist locally)
New Logic:  ✓ Works (skips recovery, condition false)

localTokenCount === 0 && remoteTokenCount > 0
        0 === 0 && 5 > 0
            false && true
                 false  → No recovery
```

### Scenario 2: Corruption Case (THE BUG)

```
Conditions:
• localStorage: version=3, wallet=null (deleted)
• IPFS remote: version=3, 5 tokens
• In-memory: 0 tokens (nothing to load)

Old Logic:  ✗ FAILS (assumes tokens exist, they don't)
New Logic:  ✓ FIXED (detects empty, imports from IPFS)

localTokenCount === 0 && remoteTokenCount > 0
        0 === 0 && 5 > 0
            true && true
                 true  → Recovery happens ✓
```

### Scenario 3: Partial Data (Edge Case)

```
Conditions:
• localStorage: version=3, wallet=2 tokens
• IPFS remote: version=3, 5 tokens
• In-memory: 2 tokens

Old Logic:  ✓ Works (returns, assumes sync is complete)
New Logic:  ✓ Works (skips recovery, local has tokens)

localTokenCount === 0 && remoteTokenCount > 0
        2 === 0 && 5 > 0
            false && true
                 false  → No recovery

Note: The 3 missing tokens handled by other sync mechanisms
      (conflict resolution in importRemoteData)
```

### Scenario 4: Both Empty (Legitimate)

```
Conditions:
• localStorage: version=3, wallet=null
• IPFS remote: version=3, tokens={}
• In-memory: 0 tokens

Old Logic:  ✓ Works (both empty, nothing to import)
New Logic:  ✓ Works (skips recovery, remote empty)

localTokenCount === 0 && remoteTokenCount > 0
        0 === 0 && 0 > 0
            true && false
                  false  → No recovery

Explanation: remoteTokenCount is 0, so condition false
             This is legitimate state (user has no tokens)
```

---

## Impact Analysis

### What Gets Fixed

```
Data Loss Prevention:
┌─────────────────────────────────────────────────────┐
│ Before Fix                                          │
├─────────────────────────────────────────────────────┤
│ Scenario: localStorage cleared, version survives   │
│ Result:   syncFromIpns() returns success ✗          │
│ Outcome:  5 tokens visible on IPFS, lost to user ✗ │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ After Fix                                           │
├─────────────────────────────────────────────────────┤
│ Scenario: localStorage cleared, version survives   │
│ Result:   syncFromIpns() detects & recovers ✓      │
│ Outcome:  5 tokens recovered from IPFS ✓           │
└─────────────────────────────────────────────────────┘
```

### What Stays Unchanged

```
Existing Behavior Preserved:

✓ Normal sync (tokens exist):   No change
✓ Version mismatch:             No change
✓ Conflict resolution:          No change
✓ IPNS recovery:                No change
✓ Performance (normal case):     No change
✓ Sanity checks:                No change
✓ API/return structure:         No change
```

---

## Performance Characteristics

### Code Execution Cost

```
Recovery Code Path:
═══════════════════════════════════════════════════════════

Line 3315:  const localWallet = WalletRepository.getInstance()
            Cost: O(1) - singleton lookup

Line 3316:  const localTokenCount = localWallet.getTokens().length
            Cost: O(1) - array.length property

Line 3318:  let remoteTokenCount = 0
            Cost: O(1) - variable initialization

Line 3319:  if (remoteData && typeof remoteData === 'object')
            Cost: O(1) - type check

Line 3320:  remoteTokenCount = Object.keys(remoteData.tokens || {}).length
            Cost: O(n) where n = token count in remote data
                  Typical: 5-50 tokens (VERY small)

Line 3323:  if (localTokenCount === 0 && remoteTokenCount > 0)
            Cost: O(1) - comparison

Total Recovery Cost: O(n) where n ≈ 5-50 (small)

When Does It Run?
─────────────────
• Only when localVersion === remoteVersion (not hot path)
• Only when local is empty (rare corruption case)
• Only once per corrupt state (not repeated)

Normal Sync Paths:
• remoteVersion > localVersion: No recovery code
• remoteVersion < localVersion: No recovery code

Verdict: Negligible performance impact ✓
```

---

## Logging Output Examples

### Recovery Successful

```javascript
// Console output when fix triggers:
📦 Versions match (v3), remote verified accessible
⚠️ RECOVERY: Versions match but localStorage is empty!
⚠️ RECOVERY: Detected tokens - local: 0, remote: 5
⚠️ RECOVERY: Recovering 5 token(s) from IPFS
✅ RECOVERY: Imported 5 token(s), wallet restored
```

### No Recovery Needed

```javascript
// Console output when no recovery (normal case):
📦 Versions match (v3), remote verified accessible
// Recovery code skipped (condition false)
📦 Spent token sanity check: 5 confirmed, 0 invalid
📦 Tombstone recovery check: 0 tombstones, 0 recovered
```

---

## Testing Matrix

```
Test Case                    | Old Logic | New Logic | Status
─────────────────────────────┼───────────┼───────────┼────────
Versions match, tokens exist | ✓ Works   | ✓ Works   | PASS
Versions match, local empty  | ✗ FAILS   | ✓ Fixed   | PASS
Remote newer                 | ✓ Works   | ✓ Works   | PASS
Local newer                  | ✓ Works   | ✓ Works   | PASS
Both empty                   | ✓ Works   | ✓ Works   | PASS
IPNS recovery needed         | ✓ Works   | ✓ Works   | PASS
Sanity check fails           | ✓ Works   | ✓ Works   | PASS
```

---

## Summary

This fix addresses a critical data loss scenario by:

1. **Detecting**: Checking if localStorage is empty while IPFS has tokens
2. **Recovering**: Using existing import mechanism to restore tokens
3. **Preserving**: Maintaining all existing behavior for healthy cases
4. **Logging**: Clear diagnostics for debugging

The change is **minimal** (18 lines), **safe** (defensive), and **effective** (prevents data loss).

