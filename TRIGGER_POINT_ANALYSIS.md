# Dual-Publish Root Cause Analysis: 3 Trigger Points

## Executive Summary

The dual-sync architecture has THREE hidden trigger points that cause double uploads to IPFS/IPNS:

1. **Trigger Point 1** (Line 1682): IPNS polling → handleHigherSequenceDiscovered() → scheduleSync()
2. **Trigger Point 2** (Line 1706): IPNS polling → handleHigherSequenceDiscovered() → scheduleSync()
3. **Trigger Point 3** (Line 239): wallet-updated event → startAutoSync listener → scheduleSync()

All three route through `scheduleSync()` which enqueues sync operations without user/caller visibility.

---

## Trigger Point Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DUAL-PUBLISH RACE CONDITION                     │
└─────────────────────────────────────────────────────────────────────┘

TIME →

┌────────────────────────────────────────────────────────────────────────┐
│ T0: Remote publishes newer token via IPNS                             │
│     (Browser 2 sends token while Browser 1 is offline)               │
└────────────────────────────────────────────────────────────────────────┘

              ↓ 30-90 seconds

┌────────────────────────────────────────────────────────────────────────┐
│ T1: Browser 1 IPNS polling interval fires                             │
│     Calls: startIpnsPolling() → poll() → resolveIpnsProgressively() │
└────────────────────────────────────────────────────────────────────────┘

              ↓

┌────────────────────────────────────────────────────────────────────────┐
│ T2: TRIGGER POINT #1 & #2: handleHigherSequenceDiscovered()          │
│     (IPNS callback detects newer remote)                             │
│                                                                        │
│     Line 1766: if (hasSameSequenceButDifferentCid) {                 │
│     Line 1766:   await this.handleHigherSequenceDiscovered()  ←──┐  │
│     Line 1766: }                                                │  │  │
│                                                                │  │  │
│     Inside handleHigherSequenceDiscovered():                  │  │  │
│     ├─ Import remote tokens ✓                                 │  │  │
│     ├─ Line 1680: if (localDiffersFromRemote)                │  │  │
│     │   └─ Line 1682: this.scheduleSync()  ←─────┐           │  │  │
│     │                                             │ TRIGGER  │  │  │
│     └─ Line 1704: if (localDiffersFromRemote)     │ POINT    │  │  │
│         └─ Line 1706: this.scheduleSync()  ←─────┤ #1 & #2  │  │  │
│                                                    │           │  │  │
└────────────────────────────────────────────────────┼───────────┼──┼──┘
                                                     │           │  │
                          ┌──────────────────────────┘           │  │
                          │ SyncQueue: Enqueue sync             │  │
                          ↓                                      │  │
                  ┌───────────────┐                              │  │
                  │ syncOperation │                              │  │
                  │   (queued)    │                              │  │
                  └───────────────┘                              │  │
                          │                                      │  │
                          │ 50ms later (after user click)       │  │
                          ↓                                      │  │
┌────────────────────────────────────────────────────────────────────────┐
│ T3: User clicks "Sync" button in UI                                   │
│     useWallet.ts: onClick handler calls syncNow()  ←───────┐           │
│                                                             │ TRIGGER  │
│     This is EXPLICIT sync requested by user               │ POINT    │
│                                                             │ #3 (alt) │
└────────────────────────────────────────────────────────────────────────┘
                          │
                          ↓
                  ┌───────────────┐
                  │ syncOperation │
                  │  (queued)     │
                  └───────────────┘
                          │
                          ↓
┌────────────────────────────────────────────────────────────────────────┐
│ T4: SyncQueue processes operations                                    │
│     ├─ Dequeue #1 (from polling)  → SyncQueue.enqueue()             │
│     │   ├─ executeSyncInternal()                                    │
│     │   ├─ Builds TxfStorageData                                    │
│     │   └─ uploadToGateway() → POST to IPFS                         │
│     │                                                                │
│     └─ Dequeue #2 (from click)  → SyncQueue.enqueue()               │
│         ├─ executeSyncInternal()                                    │
│         ├─ Builds TxfStorageData (same tokens)                      │
│         └─ uploadToGateway() → POST to IPFS (SECOND TIME!)          │
│                                                                        │
│     RESULT: Two POSTs with identical content                         │
│              → Two CIDs generated (different serialization order?)    │
│              → IPNS updated twice (last one wins)                    │
│              → Perceived data loss if first upload was "better"      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Trigger Point #1: IPNS Polling (Line 1682)

### Activation Sequence

```
startAutoSync()
  └─ setupVisibilityListener()
     └─ startIpnsPolling()
        └─ setInterval(() => poll(), 30-90s)
           └─ resolveIpnsProgressively()
              ├─ Queries Kubo gateway #1
              ├─ Queries Kubo gateway #2
              └─ When higher sequence detected:
                 └─ executeProgressively callback
                    └─ handleHigherSequenceDiscovered(result)
                       └─ importRemoteData()
                       └─ Line 1680: if (localDiffersFromRemote)
                          └─ Line 1682: this.scheduleSync()  ← TRIGGER #1
                             └─ SyncQueue.enqueue(operation)
                                └─ Scheduled for async execution
```

### Code Location

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Method**: `handleHigherSequenceDiscovered()`
**Line**: 1682
**Condition**: `if (remoteVersion > localVersion && localDiffersFromRemote(remoteData))`

### Impact

- **Frequency**: Every 30-90 seconds while polling is active
- **Visibility**: HIDDEN - caller (polling) doesn't know scheduleSync() is called
- **Race Condition**: Can race with manual syncNow() from UI button
- **Severity**: HIGH - continuous background trigger

---

## Trigger Point #2: IPNS Polling with Same Sequence (Line 1706)

### Activation Sequence

```
startAutoSync()
  └─ setupVisibilityListener()
     └─ startIpnsPolling()
        └─ poll()
           └─ resolveIpnsProgressively()
              └─ handleHigherSequenceDiscovered(result)
                 ├─ importRemoteData()
                 ├─ Line 1704: if (localDiffersFromRemote)  ← Different condition
                 │              (remote version NOT higher, but local has unique tokens)
                 └─ Line 1706: this.scheduleSync()  ← TRIGGER #2
                    └─ SyncQueue.enqueue(operation)
```

### Code Location

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Method**: `handleHigherSequenceDiscovered()`
**Line**: 1706
**Condition**: `if (remoteVersion <= localVersion && localDiffersFromRemote(remoteData))`

### Impact

- **Frequency**: Every 30-90 seconds (same polling interval)
- **Visibility**: HIDDEN - even more subtle than Trigger #1
- **When Triggered**: When remote has new tokens but local has local-only tokens
- **Severity**: HIGH - can trigger even when versions match

---

## Trigger Point #3: Wallet-Updated Events (Line 239)

### Activation Sequence

```
User sends/receives token
  └─ TokenTransactionFlow
     └─ window.dispatchEvent(new Event("wallet-updated"))
        └─ startAutoSync listener (bound at line 239)
           └─ this.boundSyncHandler = () => this.scheduleSync()
              └─ scheduleSync()  ← TRIGGER #3
                 └─ SyncQueue.enqueue(operation)
```

### Code Location

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Method**: `startAutoSync()`
**Line**: 239
**Event**: `wallet-updated` (custom event, dispatched from multiple places)

### Callers that Dispatch wallet-updated

```
1. IpfsStorageService.ts line 1665: emitEvent() → dispatchEvent("wallet-updated")
2. IpfsStorageService.ts line 1699: emitEvent() → dispatchEvent("wallet-updated")
3. IpfsStorageService.ts line 1709: emitEvent() → dispatchEvent("wallet-updated")
4. IpfsStorageService.ts line 1721: After merge completion
5. useWallet.ts: After token operations
6. Other places where tokens change
```

### Impact

- **Frequency**: Every token operation (send, receive, import, etc.)
- **Visibility**: HIDDEN - wallet-updated is generic, listeners don't know about it
- **Cascading**: One user action → dispatch event → all listeners fire
- **Severity**: CRITICAL - high frequency + hidden behavior

---

## The Race Condition Explained

### Scenario: Browser 1 receives token while offline, Browser 2 sends token

```
BROWSER 2 (Online)                          BROWSER 1 (Offline → Online)
─────────────────────────────────────────────────────────────────────

User receives token A                       (offline)
└─ dispatch wallet-updated
   └─ startAutoSync listener
      └─ scheduleSync() → syncNow()
         └─ Upload to IPFS (v=2, CID=abc)
         └─ Publish to IPNS (seq=3)

                                           User comes online
                                           (IPNS shows v=2, seq=3)

                                           IPNS polling fires
                                           └─ handleHigherSequenceDiscovered()
                                              └─ Imports token A
                                              └─ scheduleSync() ← TRIGGER
                                                 └─ Queue: Upload again!

                                           User clicks "Sync" button
                                           └─ syncNow() ← EXPLICIT
                                              └─ Queue: Upload AGAIN!

                                           SyncQueue executes TWO uploads:
                                           1. From handleHigherSequenceDiscovered
                                           2. From manual click

                                           Both upload same tokens
                                           → CID1 published
                                           → CID2 published (overwrites)
                                           → Second one "wins"

                                           If first had more metadata → DATA LOSS
```

### Root Cause

The application cannot distinguish between:
1. **Background polling** discovering remote updates → should only IMPORT
2. **User action** requesting sync → should UPLOAD

Instead, both call scheduleSync() which means "upload to external storage". This creates ambiguity and race conditions.

---

## Solution: Remove All Hidden Triggers

### Changes 6 & 7 Fix

```
BEFORE (3 Trigger Points)        AFTER (0 Hidden Triggers)
──────────────────────────       ────────────────────────

1. Polling                         1. Polling
   ├─ IPNS check                      ├─ IPNS check
   └─ scheduleSync() ✗                └─ Import only ✓

2. Polling                         2. Polling
   ├─ IPNS check                      ├─ IPNS check
   └─ scheduleSync() ✗                └─ Import only ✓

3. wallet-updated                  3. wallet-updated
   └─ scheduleSync() ✗                └─ NO LISTENER ✓

UI Button                         UI Button
└─ syncNow() ✓                    └─ syncNow() ✓ (ONLY trigger now)
```

### Result

- **Only 1 trigger path remains**: Explicit `syncNow()` calls
- **No hidden uploads**: Polling = import only
- **No wallet-updated listener**: Events don't trigger sync
- **Caller controlled**: Code must explicitly request sync
- **No race conditions**: SyncQueue handles sequential execution

---

## Implementation Impact by Caller

### High-Priority Callers (Must Review)

**1. useWallet.ts (4 syncNow calls)**
- Status: ✅ SAFE - All are user-initiated (button clicks)
- Action: No change needed

**2. OutboxRecoveryService.ts (4 syncNow calls)**
- Status: ✅ SAFE - Explicit recovery flows
- Action: No change needed

**3. IpfsStorageService.ts (5 internal calls)**
- Status: 🔴 MUST REMOVE
  - Line 239: wallet-updated listener → DELETE
  - Line 1682: handleHigherSequenceDiscovered → DELETE
  - Line 1706: handleHigherSequenceDiscovered → DELETE
- Action: Implement Changes 6 & 7

**4. devTools.ts (5 syncNow calls)**
- Status: ✅ SAFE - Dev-only, explicit
- Action: No change needed

### Medium-Priority Callers (Verify Intent)

**5. SyncQueue.ts (1 syncNow call)**
- Question: Is this still needed?
- Action: Review if internal sync queue still needed

**6. NametagService.ts (1 syncNow call)**
- Question: Should nametag resolution trigger sync?
- Action: Clarify intent or remove

**7. useOnboardingFlow.ts (1 syncNow call)**
- Status: ✅ SAFE - Initial wallet setup
- Action: No change needed

### Low-Priority Callers (No Impact)

**8. ChatHistoryIpfsService.ts (1 call)**
- Status: ✅ SAFE - Separate service, explicit
- Action: No change needed

**9. useChatHistorySync.ts (1 call)**
- Status: ✅ SAFE - Chat-specific, explicit
- Action: No change needed

**10. useIpfsStorage.ts (1 call)**
- Status: ⚠️ Verify - Hook-based, might be redundant
- Action: Check if still needed

---

## Verification Checklist

After implementing Changes 6 & 7:

```typescript
// These should cause errors (removed):
❌ service.handleHigherSequenceDiscovered() has NO scheduleSync() calls
❌ service.startAutoSync() has NO wallet-updated listener
❌ service.setupVisibilityListener() is NOT called from startAutoSync()

// These should still work:
✅ service.syncNow() still works (explicit sync)
✅ service.syncFromIpns() still works (remote check)
✅ service.resolveIpnsProgressively() still works (transport layer)
✅ SyncQueue.enqueue() still works (coordination)

// Test scenarios:
✅ One click = one upload (not two)
✅ Polling + click don't race (sequential in SyncQueue)
✅ Remote import doesn't trigger upload
✅ Manual syncNow() is only sync trigger
```

---

## References

- **Trigger Point Analysis**: This document
- **Code Changes**: `/home/vrogojin/sphere/CHANGE_6_AND_7_SPECIFIC.md`
- **Full Plan**: `/home/vrogojin/sphere/DUAL_SYNC_REFACTORING_UPDATED.md`
- **Risk Assessment**: Updated from LOW to MEDIUM in main plan doc
