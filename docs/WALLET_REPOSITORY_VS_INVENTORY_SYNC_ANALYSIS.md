# WalletRepository vs InventorySyncService Analysis

**Date:** 2026-01-18
**Analyzed by:** Project Architect, Code Debugger, and Unicity Architect agents

---

## Executive Summary

This analysis examines the overlap between `WalletRepository` and `InventorySyncService` to determine:
1. How much functionality overlaps
2. Whether WalletRepository is still needed
3. Whether InventorySyncService could fully replace WalletRepository

**Key Finding:** ~60-70% of core inventory functionality is duplicated, and the current dual-ownership architecture **violates TOKEN_INVENTORY_SPEC.md Section 6.1** and causes race conditions that can lead to data loss.

---

## 1. Functionality Overlap Matrix

| Capability | WalletRepository | InventorySyncService | Overlap |
|------------|-----------------|---------------------|---------|
| **localStorage Read** | `loadWalletForAddress()` | Step 1 | **100% DUPLICATE** |
| **localStorage Write** | `saveWallet()` | Step 9 | **100% DUPLICATE** |
| **Token CRUD** | `addToken()`, `removeToken()`, `updateToken()` | Steps 0, 6, 8 | **HIGH OVERLAP** |
| **Tombstone Management** | `getTombstones()`, `mergeTombstones()` | Steps 7, 7.5 | **HIGH OVERLAP** |
| **Nametag Management** | `getNametag()`, `setNametag()` | Steps 1, 8.5 | **HIGH OVERLAP** |
| **IPFS Sync** | None | Steps 2, 10 | **No overlap** |
| **Token Validation** | None | Steps 4, 5 | **No overlap** |
| **Spent Detection** | None | Step 7 | **No overlap** |
| **Archived Token Storage** | `getArchivedToken()`, `archiveToken()` | Uses WalletRepository | **Delegated** |
| **Forked Token Storage** | `getForkedToken()`, `storeForkedToken()` | Uses WalletRepository | **Delegated** |
| **Transaction History** | Full support | None | **No overlap** |

**Overlap Estimate: ~60-70%** of core inventory operations are duplicated.

---

## 2. Critical Finding: Spec Violation

Per **TOKEN_INVENTORY_SPEC.md Section 6.1**:
> "Only inventorySync should be allowed to access the inventory in localStorage!"

### Current Reality

Both components write to the **same localStorage key** (`sphere_wallet_DIRECT://{address}`), creating race conditions:

```
Race Condition Timeline:
T0:   InventorySyncService Step 1 reads localStorage (100 tokens)
T1:   WalletRepository.addToken() writes 101 tokens  ← External event
T2:   InventorySyncService Step 9 writes 100 tokens  ← OVERWRITES T1!
Result: Token added at T1 is LOST
```

### Storage Key Conflict

| Component | Storage Key | Format |
|-----------|-------------|--------|
| WalletRepository | `sphere_wallet_${address}` | `StoredWallet` (`{ tokens: Token[], nametag, tombstones }`) |
| InventorySyncService | `sphere_wallet_${address}` | `TxfStorageData` (`{ _meta, _<tokenId>, _nametag, _tombstones }`) |

**Same key, different formats** = data corruption risk.

---

## 3. WalletRepository API Surface

### 3.1 CRUD Operations (Core Wallet Management)

| Method | Signature | Purpose |
|--------|-----------|---------|
| `createWallet` | `(address: string, name?: string) => Wallet` | Create new wallet or return existing |
| `loadWalletForAddress` | `(address: string) => Wallet \| null` | Load wallet from localStorage by address |
| `switchToAddress` | `(address: string) => Wallet \| null` | Switch active wallet to different address |
| `getWallet` | `() => Wallet \| null` | Get current in-memory wallet instance |
| `clearWallet` | `() => void` | Remove current wallet from localStorage |

### 3.2 Token Operations

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getTokens` | `() => Token[]` | Get all tokens from current wallet |
| `addToken` | `(token: Token, skipHistory?: boolean) => void` | Add token with validation + archiving |
| `updateToken` | `(token: Token) => void` | Update existing token (conflict resolution) |
| `removeToken` | `(tokenId: string, ...) => void` | Remove token + create tombstone + archive |

### 3.3 Nametag Management

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getNametag` | `() => NametagData \| null` | Get nametag for current identity |
| `setNametag` | `(nametag: NametagData) => void` | Set nametag with validation |
| `clearNametag` | `() => void` | Remove nametag for current identity |
| `hasNametag` | `() => boolean` | Check if identity has nametag |

### 3.4 Tombstone Management

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getTombstones` | `() => TombstoneEntry[]` | Get all tombstones (state-hash-aware) |
| `isStateTombstoned` | `(tokenId: string, stateHash: string) => boolean` | Check if specific state is tombstoned |
| `mergeTombstones` | `(remoteTombstones: TombstoneEntry[]) => number` | Merge remote tombstones from IPFS |

### 3.5 Archived/Forked Tokens

| Method | Signature | Purpose |
|--------|-----------|---------|
| `archiveToken` | `(token: Token) => void` | Archive token before removal |
| `getArchivedToken` | `(address: string, tokenId: string) => TxfToken \| null` | Get specific archived token |
| `getForkedToken` | `(address: string, tokenId: string, stateHash: string) => TxfToken \| null` | Get specific fork |

### 3.6 Transaction History

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getTransactionHistory` | `() => TransactionHistoryEntry[]` | Get all transactions (sorted desc) |
| `addTransactionToHistory` | `(entry: ...) => void` | Add transaction entry |
| `addSentTransaction` | `(amount, coinId, symbol, ...) => void` | Convenience for sent transactions |

---

## 4. InventorySyncService's Dependency on WalletRepository

**Only one location** (Step 7.5 - Tombstone Verification):

```typescript
// InventorySyncService.ts:1219-1236
const { WalletRepository } = await import('../../../../repositories/WalletRepository');
const walletRepo = WalletRepository.getInstance();

// Recovery from false tombstones (BFT rollback scenarios)
const archivedToken = walletRepo.getArchivedToken(ctx.address, tombstone.tokenId);
const forkedToken = walletRepo.getForkedToken(ctx.address, tombstone.tokenId, tombstone.stateHash);
```

This is used to recover tokens that were falsely tombstoned after BFT rollbacks.

---

## 5. What WalletRepository Provides That InventorySyncService Doesn't

| Feature | WalletRepository Only | Can InventorySyncService Replace? |
|---------|----------------------|----------------------------------|
| **Archived Tokens** | `getArchivedToken()`, `getBestArchivedVersion()` | Currently depends on WalletRepository |
| **Forked Tokens** | `getForkedToken()`, `storeForkedToken()` | Currently depends on WalletRepository |
| **Transaction History** | `getTransactionHistory()`, `addSentTransaction()` | Would need new implementation |
| **In-Memory Cache** | `_wallet` singleton with debounced refresh | Could use TanStack Query instead |
| **Static Utilities** | `checkNametagForAddress()`, `checkTokensForAddress()` | Easily moved |
| **Import Flow Flags** | `setImportInProgress()`, `isImportInProgress()` | Trivial to move |

---

## 6. Consumer Dependency Map

### Primary Consumers of WalletRepository

| Consumer | Operations | Frequency |
|----------|------------|-----------|
| **useWallet.ts** | `getWallet`, `loadWalletForAddress`, `createWallet`, `getTokens`, `addToken`, `removeToken` | High |
| **IpfsStorageService.ts** | `getTokens`, `getNametag`, `getTombstones`, `mergeTombstones`, `getArchivedTokens` | High |
| **NostrService.ts** | `addToken`, `getNametag`, `setNametag` | Medium |
| **NametagService.ts** | `getWallet`, `getNametag`, `setNametag` | Medium |
| **TokenRecoveryService.ts** | `getArchivedTokens`, `getTokens`, `removeToken`, `addToken` | Low |

---

## 7. Can WalletRepository Be Fully Replaced?

**Short Answer: Yes, but with caveats.**

| Aspect | Replacement Feasibility | Notes |
|--------|------------------------|-------|
| **Core Token CRUD** | Easy | InventorySyncService already does this |
| **IPFS Sync** | Already owned | InventorySyncService is the authority |
| **Archived/Forked Tokens** | Medium | Need to move storage logic to TxfStorageData format |
| **Transaction History** | Medium | Separate concern, could be its own service |
| **Read-Only Queries for UI** | Design decision | TanStack Query could replace in-memory cache |
| **Static Utilities** | Trivial | Just move the functions |

---

## 8. Recommended Architecture Options

| Option | Description | Effort | Risk |
|--------|-------------|--------|------|
| **A) Keep Both** | Status quo | None | Race conditions persist |
| **B) WalletRepository → Read-Only** | Remove all write methods, delegate to InventorySyncService | Medium | Low |
| **C) Full Replacement** | Delete WalletRepository, move all logic to InventorySyncService | High | Medium |
| **D) Delegation Pattern** | WalletRepository.addToken() → calls inventorySync() | **Low** | **Low** |

### Recommended: Option D (Phased Approach)

#### Phase 1: Add Delegation Layer (Immediate - Low Risk)

```typescript
// WalletRepository.ts
class WalletRepository {
  async addToken(token: Token): Promise<void> {
    // Queue token for next sync
    const { inventorySync } = await import('./InventorySyncService');
    await inventorySync({
      incomingTokens: [token],
      address: this._currentAddress!,
      publicKey: this._publicKey!,
      ipnsName: this._ipnsName!
    });

    // Update in-memory cache for immediate UI display
    this._wallet!.tokens.push(token);
    this.refreshWallet();
  }
}
```

#### Phase 2: Migrate Application Layer (Gradual - Medium Risk)

Update components to call `inventorySync()` directly:

```typescript
// OLD: NostrService.ts
onTokenReceived(token: Token) {
  WalletRepository.getInstance().addToken(token);
}

// NEW:
onTokenReceived(token: Token) {
  queueTokenForSync(token);  // Batches tokens, triggers inventorySync()
}
```

#### Phase 3: Deprecate WalletRepository (Long-term - Low Risk)

Reduce to read-only cache or eliminate entirely.

---

## 9. Migration Path for Archived/Forked Tokens

To fully eliminate WalletRepository dependency in Step 7.5:

**Current TxfTypes.ts already defines:**
- `_archived_<tokenId>` - Archived token keys
- `_forked_<tokenId>_<stateHash>` - Forked token keys

**Migration:**
1. Store archived tokens in TxfStorageData format during Step 8
2. Store forked tokens in TxfStorageData format during conflict resolution
3. Read from TxfStorageData in Step 7.5 instead of WalletRepository

---

## 10. Bottom Line

| Question | Answer |
|----------|--------|
| **How much overlap?** | ~60-70% of core inventory functionality is duplicated |
| **Still need WalletRepository?** | Currently yes, for archived/forked tokens and transaction history |
| **Can InventorySyncService fully replace it?** | Yes, with ~2-3 weeks of refactoring work |
| **Should we replace it?** | **Yes** - current architecture violates spec and causes data loss |
| **Best approach?** | Option D: Gradual delegation, then elimination |

---

## 11. Files Referenced

| File | Purpose |
|------|---------|
| `/src/repositories/WalletRepository.ts` | Legacy wallet data access layer |
| `/src/components/wallet/L3/services/InventorySyncService.ts` | Spec-compliant inventory sync |
| `/src/components/wallet/L3/services/types/TxfTypes.ts` | TxfStorageData format definition |
| `/docs/TOKEN_INVENTORY_SPEC.md` | Specification (Section 6.1 is key) |

---

## 12. Action Items

### Immediate (To Fix Data Loss Risk)
- [ ] Add sync lock to prevent concurrent WalletRepository writes during InventorySyncService sync
- [ ] Add delegation in WalletRepository write methods to call `inventorySync()`

### Short-term
- [ ] Migrate NostrService, FaucetService to use `inventorySync()` directly
- [ ] Move archived/forked token storage into TxfStorageData format
- [ ] Deprecate WalletRepository write methods with console warnings

### Long-term
- [ ] Migrate all consumers to use `inventorySync()` or read-only queries
- [ ] Consider eliminating WalletRepository entirely
- [ ] Move transaction history to separate service or include in TxfStorageData

---

**Status: ANALYSIS COMPLETE**
**Recommendation: Proceed with Option D (Phased Delegation)**
