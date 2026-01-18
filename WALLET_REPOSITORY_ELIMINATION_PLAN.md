# WalletRepository Elimination Migration Plan

## Executive Summary

This document provides a comprehensive analysis and migration plan for eliminating `WalletRepository` (a singleton with in-memory state) in favor of `InventorySyncService` (stateless, reads from localStorage each time).

**Status:** Phases 0-5 complete, Phase 6 partially complete (30% done)
**Remaining Work:** 10 files to migrate + architectural decisions + testing

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Remaining Files Analysis](#remaining-files-analysis)
3. [Critical Architectural Decisions](#critical-architectural-decisions)
4. [Migration Strategy](#migration-strategy)
5. [Risk Assessment](#risk-assessment)
6. [Testing Requirements](#testing-requirements)
7. [Implementation Order](#implementation-order)

---

## Architecture Overview

### Current State

**WalletRepository (Singleton - To Be Eliminated)**
- **In-memory state:** `_wallet`, `_nametag`, `_tombstones`, `_archivedTokens`, `_forkedTokens`
- **Methods Used:**
  - `getWallet()` - returns in-memory wallet object
  - `loadWalletForAddress(address)` - loads wallet from localStorage into memory
  - `createWallet(address)` - creates new wallet in memory + localStorage
  - `getTokens()` - returns `_wallet.tokens`
  - `addToken(token)` - adds to memory + saves to localStorage
  - `removeToken(id, reason)` - removes from memory + archives + adds tombstone
  - `getNametag()` - returns `_wallet.nametag`
  - `setNametag(nametag)` - sets in memory + saves
  - `forceRefreshCache()` - triggers UI refresh

**InventorySyncService (Stateless - Target)**
- **No in-memory state:** Reads directly from localStorage each call
- **Methods Available:**
  - `getTokensForAddress(address)` - reads tokens from localStorage
  - `addToken(address, publicKey, ipnsName, token, options)`
  - `removeToken(address, publicKey, ipnsName, tokenId, stateHash, options)`
  - `getNametagForAddress(address)`
  - `setNametagForAddress(address, nametag)`
  - `getTombstonesForAddress(address)`
  - `getArchivedTokensForAddress(address)`
  - `getForkedTokensForAddress(address)`
  - `dispatchWalletUpdated()` - triggers UI refresh

### Key Differences

| Aspect | WalletRepository | InventorySyncService |
|--------|------------------|---------------------|
| State | In-memory cache | Stateless (reads localStorage) |
| Wallet Management | getWallet(), loadWalletForAddress(), createWallet() | No wallet object concept |
| Token Add | addToken(token) | addToken(address, publicKey, ipnsName, token, options) |
| Token Remove | removeToken(id, reason) | removeToken(address, publicKey, ipnsName, tokenId, stateHash, options) |
| Nametag | getNametag() | getNametagForAddress(address) |
| Address Param | Implicit (loaded wallet) | Explicit (every call) |

---

## Remaining Files Analysis

### CRITICAL - High Priority (Must Fix First)

#### 1. `src/components/wallet/L3/hooks/useWallet.ts` (MAJOR CONSUMER)

**Line Count:** 1197 lines
**Impact:** CRITICAL - Core wallet hook, affects entire L3 wallet UI

**WalletRepository Methods Used:**
- Line 45: `const walletRepo = WalletRepository.getInstance()`
- Line 191-200: `walletRepo.getWallet()` - check if wallet loaded (nametagQuery)
- Line 195: `walletRepo.loadWalletForAddress(identity.address)` - load wallet for address
- Line 199: `walletRepo.createWallet(identity.address)` - create new wallet
- Line 204: `walletRepo.getNametag()` - get nametag from wallet
- Line 218: `walletRepo.clearNametag()` - clear corrupted nametag
- Line 324-334: `walletRepo.getWallet()`, `loadWalletForAddress()`, `createWallet()` - same pattern in tokensQuery
- Line 343: `walletRepo.getTokens()` - get tokens for spent check
- Line 399, 402: `walletRepo.removeToken(spent.localId, 'spent-on-aggregator')` - archive spent tokens
- Line 503: `walletRepo.createWallet(identity.address)` - createWalletMutation
- Line 521: `walletRepo.createWallet(identity.address)` - restoreWalletMutation
- Line 613: `walletRepo.removeToken(token.id)` - sendTokenMutation
- Line 654: `walletRepo.getTokens()` - sendAmountMutation (get all tokens for split calculation)
- Line 696: `walletRepo.getWallet()?.address` - get current wallet address for outbox
- Line 725: `walletRepo.forceRefreshCache()` - force immediate cache refresh for IPFS sync
- Line 759: `walletRepo.removeToken(burnedId, undefined, true)` - split operation
- Line 1035: `walletRepo.removeToken(uiId, recipientNametag)` - direct transfer
- Line 1146: `walletRepo.addToken(uiToken, true)` - save change token

**Migration Strategy:**
1. **Add address parameter to all functions**
   - `nametagQuery`, `tokensQuery` already have `identityQuery.data?.address`
   - Pass `identity.address` to InventorySyncService calls
2. **Replace wallet management methods:**
   - Remove `getWallet()`, `loadWalletForAddress()`, `createWallet()` - not needed with stateless approach
   - Wallet existence check: Use `hasTokensForAddress()` or just proceed with operations
3. **Replace getNametag():**
   ```typescript
   // OLD
   const nametagData = walletRepo.getNametag();

   // NEW
   const nametagData = InventorySyncService.getNametagForAddress(identity.address);
   ```
4. **Replace getTokens():**
   ```typescript
   // OLD
   const tokens = walletRepo.getTokens();

   // NEW
   const tokens = await InventorySyncService.getTokensForAddress(identity.address);
   ```
5. **Replace addToken():**
   ```typescript
   // OLD
   walletRepo.addToken(uiToken, true);

   // NEW
   await InventorySyncService.addToken(
     identity.address,
     identity.publicKey,
     identity.ipnsName,
     uiToken,
     { skipHistory: true }
   );
   ```
6. **Replace removeToken():**
   ```typescript
   // OLD
   walletRepo.removeToken(spent.localId, 'spent-on-aggregator');

   // NEW
   const stateHash = getCurrentStateHash(tokenToTxf(token));
   await InventorySyncService.removeToken(
     identity.address,
     identity.publicKey,
     identity.ipnsName,
     token.id,  // tokenId from SDK token
     stateHash,
     { archiveReason: 'spent-on-aggregator', skipHistory: true }
   );
   ```
7. **Replace forceRefreshCache():**
   ```typescript
   // OLD
   walletRepo.forceRefreshCache();

   // NEW
   InventorySyncService.dispatchWalletUpdated();
   ```

**Dependencies:**
- Must be done AFTER IdentityManager provides `address`, `publicKey`, `ipnsName` consistently
- Requires robust error handling for async operations
- Need to handle empty token list case (wallet doesn't exist yet)

**Breaking Changes:**
- All token operations become async (were sync before)
- Need to await token list retrieval before operations
- Wallet concept no longer exists - just tokens for an address

**Test Coverage Required:**
- [ ] nametagQuery loads nametag correctly
- [ ] nametagQuery handles corrupted nametag (clears from both local and IPFS)
- [ ] tokensQuery loads tokens correctly
- [ ] tokensQuery runs spent check and removes spent tokens
- [ ] createWalletMutation creates wallet and refreshes queries
- [ ] restoreWalletMutation restores wallet from mnemonic
- [ ] sendTokenMutation removes token after transfer
- [ ] sendAmountMutation calculates split correctly
- [ ] Change token saved immediately after mint (crash safety)
- [ ] Direct transfer removes token after Nostr send

---

#### 2. `src/components/wallet/L3/services/IpfsStorageService.ts` (MAJOR CONSUMER)

**Size:** 49867 tokens (file too large to read in one go)

**Known WalletRepository Usage (from grep):**
- Import at top: `import { WalletRepository } from "../../../../repositories/WalletRepository"`
- Extensive usage for sync operations

**Strategy:**
1. Read file in chunks to identify all usages
2. Replace with InventorySyncService calls
3. This file is the IPFS sync engine - migration must be careful to maintain sync integrity

**Migration will handle:**
- Token list retrieval for IPFS publishing
- Token addition from IPFS restore
- Nametag sync to/from IPFS
- Tombstone handling during sync

**Status:** Needs detailed analysis (file too large for single read)

---

### HIGH Priority

#### 3. `src/components/wallet/L3/hooks/useIpfsStorage.ts`

**Line Count:** 308 lines
**Impact:** High - IPFS operations UI hook

**WalletRepository Methods Used:**
- Line 11: `import { WalletRepository } from "../../../../repositories/WalletRepository"`
- Line 122: `const walletRepo = WalletRepository.getInstance()`
- Line 124: `walletRepo.addToken(token)` - restore mutation (add tokens from IPFS)
- Line 128: `walletRepo.setNametag(result.nametag)` - restore mutation (set nametag from IPFS)
- Line 137: `walletRepo.getTokens()` - post-restore validation
- Line 144: `walletRepo.removeToken(spent.localId, undefined, true)` - remove spent tokens after validation
- Line 170-176: Same pattern repeated in `restoreFromLastMutation`

**Migration Strategy:**
1. **Add identity parameter:**
   ```typescript
   const identity = await identityManager.getCurrentIdentity();
   if (!identity) throw new Error("No identity");
   ```

2. **Replace addToken in restore:**
   ```typescript
   // OLD
   for (const token of result.tokens) {
     walletRepo.addToken(token);
   }

   // NEW
   for (const token of result.tokens) {
     await InventorySyncService.addToken(
       identity.address,
       identity.publicKey,
       identity.ipnsName,
       token
     );
   }
   ```

3. **Replace setNametag:**
   ```typescript
   // OLD
   walletRepo.setNametag(result.nametag);

   // NEW
   await InventorySyncService.setNametagForAddress(
     identity.address,
     result.nametag
   );
   ```

4. **Replace getTokens for validation:**
   ```typescript
   // OLD
   const allTokens = walletRepo.getTokens();

   // NEW
   const allTokens = await InventorySyncService.getTokensForAddress(
     identity.address
   );
   ```

5. **Replace removeToken for spent:**
   ```typescript
   // OLD
   walletRepo.removeToken(spent.localId, undefined, true);

   // NEW
   const stateHash = getCurrentStateHash(tokenToTxf(spentToken));
   await InventorySyncService.removeToken(
     identity.address,
     identity.publicKey,
     identity.ipnsName,
     spent.tokenId,
     stateHash,
     { skipHistory: true }
   );
   ```

**Dependencies:**
- Requires IdentityManager to provide address/publicKey/ipnsName
- Must handle async operations in mutation functions

**Breaking Changes:**
- All restore operations become async
- Need to handle batch token addition (loop with await)

**Test Coverage Required:**
- [ ] Restore from CID adds all tokens correctly
- [ ] Restore from CID sets nametag
- [ ] Post-restore validation removes spent tokens
- [ ] Restore from last CID works same as restore from specific CID

---

#### 4. `src/components/wallet/L3/services/TokenRecoveryService.ts`

**Line Count:** 902 lines
**Impact:** High - Token recovery for failed transfers and orphaned splits

**WalletRepository Methods Used:**
- Line 16: `import { WalletRepository } from "../../../../repositories/WalletRepository"`
- Line 108: `private walletRepo: WalletRepository`
- Line 112: `this.walletRepo = WalletRepository.getInstance()`
- Line 150: `walletRepo.getArchivedTokens()` - scan archived tokens
- Line 159: `walletRepo.getTokens()` - get current tokens for comparison
- Line 413: `walletRepo.revertTokenToCommittedState(token.id, revertedToken)` - revert token
- Line 480: `walletRepo.removeToken(tokenId, undefined, true)` - remove spent token
- Line 695: `walletRepo.addToken(reconstructed, true)` - add recovered token
- Line 888: `walletRepo.addToken(reconstructed, true)` - add specific recovered token
- Line 868: `walletRepo.getArchivedTokens()` - manual recovery

**Migration Strategy:**
1. **Replace constructor dependency:**
   ```typescript
   // OLD
   private walletRepo: WalletRepository;
   constructor() {
     this.walletRepo = WalletRepository.getInstance();
   }

   // NEW
   // No wallet repo - get address from parameter
   constructor() { }
   ```

2. **Add address parameter to all public methods:**
   ```typescript
   // OLD
   async recoverOrphanedSplitTokens(): Promise<RecoveryResult>

   // NEW
   async recoverOrphanedSplitTokens(
     address: string,
     publicKey: string,
     ipnsName: string
   ): Promise<RecoveryResult>
   ```

3. **Replace getArchivedTokens:**
   ```typescript
   // OLD
   const archivedTokens = this.walletRepo.getArchivedTokens();

   // NEW
   const archivedTokens = InventorySyncService.getArchivedTokensForAddress(address);
   ```

4. **Replace getTokens:**
   ```typescript
   // OLD
   const currentTokens = this.walletRepo.getTokens();

   // NEW
   const currentTokens = await InventorySyncService.getTokensForAddress(address);
   ```

5. **Replace addToken for recovered tokens:**
   ```typescript
   // OLD
   this.walletRepo.addToken(reconstructed, true);

   // NEW
   await InventorySyncService.addToken(
     address,
     publicKey,
     ipnsName,
     reconstructed,
     { skipHistory: true }
   );
   ```

6. **Replace removeToken:**
   ```typescript
   // OLD
   this.walletRepo.removeToken(tokenId, undefined, true);

   // NEW
   const stateHash = getCurrentStateHash(tokenToTxf(token));
   await InventorySyncService.removeToken(
     address,
     publicKey,
     ipnsName,
     tokenId,
     stateHash,
     { skipHistory: true }
   );
   ```

7. **Replace revertTokenToCommittedState:**
   ```typescript
   // This method doesn't exist in InventorySyncService
   // Need to implement custom logic:
   // 1. Get token from localStorage
   // 2. Revert its transactions array
   // 3. Call addToken with reverted token (overwrites)

   const tokens = await InventorySyncService.getTokensForAddress(address);
   const token = tokens.find(t => t.id === localId);
   if (!token) return false;

   const revertedToken = this.revertToCommittedState(token);
   if (!revertedToken) return false;

   await InventorySyncService.addToken(
     address,
     publicKey,
     ipnsName,
     revertedToken,
     { skipHistory: true }
   );
   ```

**Dependencies:**
- Callers must provide address, publicKey, ipnsName
- Need to pass through to all internal methods

**Breaking Changes:**
- All recovery methods become async
- Method signatures change (new parameters)
- Callers must await and handle errors

**Test Coverage Required:**
- [ ] Orphan recovery scans archived tokens
- [ ] Orphan recovery reconstructs change tokens
- [ ] Orphan recovery adds recovered tokens
- [ ] Transfer failure recovery classifies errors
- [ ] Transfer failure recovery reverts tokens
- [ ] Transfer failure recovery removes spent tokens

---

#### 5. `src/components/wallet/L3/services/OutboxRecoveryService.ts`

**Line Count:** 1046 lines
**Impact:** High - Outbox recovery for incomplete transfers

**WalletRepository Methods Used:**
- Line 36: `import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository"`
- Line 398: `const walletRepo = WalletRepository.getInstance()`
- Line 399: `walletRepo.getTokens().find(t => t.id === entry.sourceTokenId)` - get source token for recovery
- Line 508: `walletRepo.getTokens().find(t => t.id === entry.sourceTokenId)` - same pattern
- Line 541: `walletRepo.getTokens().find(t => t.id === entry.sourceTokenId)` - same pattern
- Line 885: `walletRepo.getWallet()?.address` - get wallet address for outbox
- Line 973: `walletRepo.getTokens().find(t => t.id === uiTokenId)` - get UI token after burn failure
- Line 1009: `walletRepo.setNametag(nametagData)` - set recovered nametag

**Migration Strategy:**
1. **Add address parameter to recovery methods:**
   ```typescript
   // OLD
   async recoverPendingTransfers(
     walletAddress: string,
     nostrService: NostrService
   ): Promise<RecoveryResult>

   // NEW - walletAddress already provided!
   // Just need publicKey and ipnsName
   async recoverPendingTransfers(
     walletAddress: string,
     publicKey: string,
     ipnsName: string,
     nostrService: NostrService
   ): Promise<RecoveryResult>
   ```

2. **Replace getTokens().find():**
   ```typescript
   // OLD
   const sourceToken = walletRepo.getTokens().find(t => t.id === entry.sourceTokenId);

   // NEW
   const tokens = await InventorySyncService.getTokensForAddress(walletAddress);
   const sourceToken = tokens.find(t => t.id === entry.sourceTokenId);
   ```

3. **Replace getWallet()?.address:**
   ```typescript
   // OLD
   const wallet = walletRepo.getWallet();
   const walletAddress = wallet?.address || "";

   // NEW
   // walletAddress is already a parameter!
   // Just use it directly
   ```

4. **Replace setNametag:**
   ```typescript
   // OLD
   walletRepo.setNametag(nametagData);

   // NEW
   await InventorySyncService.setNametagForAddress(
     walletAddress,
     nametagData
   );
   ```

**Dependencies:**
- IdentityManager must provide publicKey and ipnsName to caller
- Caller passes these through to recoverPendingTransfers()

**Breaking Changes:**
- Method signatures change (new publicKey/ipnsName parameters)
- Token lookups become async

**Test Coverage Required:**
- [ ] Recovery loads source token for validation
- [ ] Recovery handles missing source token
- [ ] Mint recovery sets nametag correctly
- [ ] Mint recovery publishes Nostr binding

---

### MEDIUM Priority

#### 6. `src/components/wallet/L3/services/transfer/TokenSplitExecutor.ts`

**Analyzed Lines:** 1-500 (partial)
**Impact:** Medium - Token split operations

**WalletRepository Methods Used:**
- Line 22: `import { WalletRepository } from "../../../../../repositories/WalletRepository"`
- Line 312: `const walletRepo = WalletRepository.getInstance()`
- Line 313: `walletRepo.getTokens().find(t => t.id === uiTokenId)` - get UI token for burn failure recovery
- Line 453: `walletRepo.getTokens().find(t => t.id === uiTokenId)` - get UI token for mint failure recovery

**Migration Strategy:**
1. **Add context parameter with address info:**
   ```typescript
   // Already has outboxContext with walletAddress
   // Just need publicKey and ipnsName
   outboxContext?: {
     walletAddress: string;
     recipientNametag: string;
     recipientPubkey: string;
     ownerPublicKey: string;
     ipnsName: string;  // ADD THIS
   }
   ```

2. **Replace getTokens().find():**
   ```typescript
   // OLD
   const uiToken = walletRepo.getTokens().find(t => t.id === uiTokenId);

   // NEW
   const tokens = await InventorySyncService.getTokensForAddress(
     outboxContext.walletAddress
   );
   const uiToken = tokens.find(t => t.id === uiTokenId);
   ```

**Dependencies:**
- Caller (useWallet.ts) must add ipnsName to outboxContext
- TokenRecoveryService must accept address/publicKey/ipnsName parameters

**Breaking Changes:**
- Recovery lookups become async

**Test Coverage Required:**
- [ ] Split burn failure recovery loads token
- [ ] Split mint failure recovery loads token

---

#### 7. `src/components/wallet/L3/services/ConflictResolutionService.ts`

**Analyzed Lines:** 1-300 (partial)
**Impact:** Low - IPFS conflict resolution (no direct WalletRepository usage found)

**WalletRepository Usage:**
- Line 27: `import type { NametagData } from "../../../../repositories/WalletRepository"`
  - **Type import only** - no runtime dependency
  - NametagData type is used for nametag merging

**Migration Strategy:**
1. **Move NametagData type to shared location:**
   ```typescript
   // Create new file: src/components/wallet/L3/services/types/NametagTypes.ts
   export interface NametagData {
     name: string;
     token: object;
     timestamp: number;
     format: string;
     version: string;
   }
   ```

2. **Update imports:**
   ```typescript
   // OLD
   import type { NametagData } from "../../../../repositories/WalletRepository";

   // NEW
   import type { NametagData } from "./types/NametagTypes";
   ```

**Dependencies:** None (type-only change)

**Breaking Changes:** None

**Test Coverage Required:**
- [ ] Nametag merge still works with new type location

---

#### 8. `src/components/wallet/L3/services/InventoryBackgroundLoops.ts`

**Analyzed Lines:** 1-300 (partial)
**Impact:** Low - Background loops (no WalletRepository import found in analyzed section)

**Status:** Needs full file analysis

**Migration Strategy:**
- Grep for WalletRepository usage
- If none, mark as complete
- If found, migrate to InventorySyncService

---

### LOW Priority

#### 9. `src/utils/devTools.ts`

**Impact:** Low - Development utilities

**Expected WalletRepository Usage:**
- Likely uses for testing/debugging
- May have direct token manipulation

**Migration Strategy:**
1. Read file to identify usage
2. Replace with InventorySyncService calls
3. Add address parameter where needed

**Note:** Dev tools are low priority since they're not production code

---

#### 10. `src/utils/unicityIdValidator.ts`

**Impact:** Low - Validation utilities

**Expected WalletRepository Usage:**
- Type imports only (likely)
- No runtime dependency expected

**Migration Strategy:**
1. Check for type-only imports
2. If type-only, move types to shared location
3. If runtime usage, migrate to InventorySyncService

---

## Critical Architectural Decisions

### Decision 1: Wallet State Management

**Problem:** WalletRepository has `getWallet()`, `loadWalletForAddress()`, `createWallet()` that manage in-memory wallet state. InventorySyncService has no concept of "wallet" - just operations on tokens for an address.

**Options:**

**A. Eliminate wallet concept entirely (RECOMMENDED)**
- **Pro:** Aligns with stateless architecture
- **Pro:** Simpler - just "address + tokens"
- **Con:** Requires changing mental model in code
- **Implementation:**
  - Remove all `getWallet()` calls
  - Remove all `loadWalletForAddress()` calls
  - Remove all `createWallet()` calls
  - Just use address directly in InventorySyncService calls

**B. Create lightweight WalletFacade**
- **Pro:** Preserves wallet abstraction
- **Pro:** Easier migration path
- **Con:** Adds unnecessary layer
- **Con:** Still has state management issues
- **Implementation:**
  - Create facade with getWallet() that returns { address, tokens }
  - Facade queries InventorySyncService each time

**Recommendation:** Option A - Eliminate wallet concept
- More aligned with stateless design
- Cleaner long-term architecture
- Requires refactoring but results in better code

---

### Decision 2: removeToken() with Tombstone Handling

**Problem:** WalletRepository.removeToken() automatically:
1. Archives the token
2. Extracts state hash from token
3. Creates tombstone entry
4. Adds to transaction history (optional)

InventorySyncService.removeToken() requires explicit stateHash parameter.

**Options:**

**A. Extract state hash at call site (RECOMMENDED)**
- **Pro:** Explicit, caller controls logic
- **Pro:** Matches InventorySyncService API
- **Con:** Boilerplate at each call site
- **Implementation:**
  ```typescript
  const txf = tokenToTxf(token);
  const stateHash = getCurrentStateHash(txf) ?? '';
  await InventorySyncService.removeToken(
    address, publicKey, ipnsName,
    token.id, stateHash,
    { archiveReason: reason, skipHistory: true }
  );
  ```

**B. Create helper wrapper**
- **Pro:** Less boilerplate
- **Con:** Hides state hash extraction
- **Implementation:**
  ```typescript
  async function removeTokenWithTombstone(
    address: string,
    publicKey: string,
    ipnsName: string,
    token: Token,
    options?: { reason?: string; skipHistory?: boolean }
  ): Promise<void> {
    const txf = tokenToTxf(token);
    const stateHash = getCurrentStateHash(txf) ?? '';
    await InventorySyncService.removeToken(
      address, publicKey, ipnsName,
      token.id, stateHash,
      { archiveReason: options?.reason, skipHistory: options?.skipHistory }
    );
  }
  ```

**Recommendation:** Option B with Option A fallback
- Create helper for most common cases
- Use explicit extraction when custom logic needed
- Document both patterns

---

### Decision 3: NametagData Type Location

**Problem:** NametagData is currently defined in WalletRepository. Multiple services import it. When WalletRepository is eliminated, where should this type live?

**Options:**

**A. Move to shared types file (RECOMMENDED)**
- **Location:** `src/components/wallet/L3/services/types/NametagTypes.ts`
- **Pro:** Clear ownership, dedicated file
- **Pro:** Easy to find and maintain
- **Con:** One more file to manage

**B. Move to InventorySyncService types**
- **Location:** `src/components/wallet/L3/services/types/InventoryTypes.ts`
- **Pro:** Centralized with other inventory types
- **Con:** File may become large
- **Con:** Less clear ownership

**C. Keep in data/model**
- **Location:** `src/components/wallet/L3/data/model.ts`
- **Pro:** With other domain models (Token, Wallet)
- **Con:** May not fit with domain concepts

**Recommendation:** Option A
- Create `NametagTypes.ts` with NametagData interface
- Also include InvalidatedNametagEntry for consistency
- Update all imports

---

### Decision 4: DevTools Migration

**Problem:** `devTools.ts` likely has direct WalletRepository usage for testing/debugging. Should we migrate it?

**Options:**

**A. Migrate fully**
- **Pro:** Complete elimination of WalletRepository
- **Pro:** Dev tools stay functional
- **Con:** Extra work for non-production code

**B. Deprecate and create new dev tools**
- **Pro:** Clean slate for dev utilities
- **Pro:** Can design better API
- **Con:** Loss of existing dev tools during transition

**C. Keep as-is with compatibility layer**
- **Pro:** No immediate work needed
- **Con:** WalletRepository can't be deleted
- **Con:** Technical debt remains

**Recommendation:** Option A (migrate fully)
- Dev tools are valuable for debugging
- Migration is low-risk (only used in development)
- Allows complete WalletRepository deletion

---

## Migration Strategy

### Phase 6: Complete Low-Impact Consumer Migration (30% done)

**Remaining Tasks:**
1. ✅ ConflictResolutionService - type-only import, easy fix
2. ✅ InventoryBackgroundLoops - verify no usage
3. ✅ unicityIdValidator - type-only import likely
4. ❌ devTools.ts - needs migration
5. ❌ Type files - move NametagData to shared location

**Estimated Time:** 2-4 hours

---

### Phase 7: Core Services Migration (NEW PHASE)

**Priority Order:**

1. **TokenRecoveryService** (4-6 hours)
   - Add address/publicKey/ipnsName parameters to all methods
   - Replace getTokens(), getArchivedTokens()
   - Replace addToken(), removeToken()
   - Implement custom revertTokenToCommittedState logic
   - Update all callers (useWallet, OutboxRecoveryService, TokenSplitExecutor)

2. **OutboxRecoveryService** (3-5 hours)
   - Add publicKey/ipnsName parameters
   - Replace getTokens().find() with async lookup
   - Replace getWallet()?.address with parameter
   - Replace setNametag()
   - Update caller (ServicesProvider)

3. **TokenSplitExecutor** (2-3 hours)
   - Add ipnsName to outboxContext
   - Replace getTokens().find() with async lookup
   - Update caller (useWallet)

**Total Estimated Time:** 9-14 hours

---

### Phase 8: Major Consumer Migration (NEW PHASE)

**Priority Order:**

1. **useIpfsStorage** (3-4 hours)
   - Add identity parameter to mutations
   - Replace addToken() in restore loops
   - Replace setNametag()
   - Replace getTokens() for validation
   - Replace removeToken() for spent tokens
   - Test restore from CID
   - Test restore from last CID

2. **IpfsStorageService** (8-12 hours) - MOST COMPLEX
   - Read full file in chunks
   - Map all WalletRepository usage
   - Replace with InventorySyncService
   - Maintain sync integrity
   - Test bidirectional sync
   - Test conflict resolution
   - Test tombstone sync

3. **useWallet** (12-16 hours) - MOST CRITICAL
   - Replace wallet management (getWallet, loadWalletForAddress, createWallet)
   - Replace getNametag(), clearNametag(), setNametag()
   - Replace getTokens() throughout
   - Replace addToken() for change tokens
   - Replace removeToken() for spent tokens and transfers
   - Replace forceRefreshCache()
   - Add async/await throughout
   - Update error handling
   - Test all query and mutation flows
   - Test split operations
   - Test direct transfers
   - Test wallet creation/restoration

**Total Estimated Time:** 23-32 hours

---

### Phase 9: Final Cleanup and Testing (NEW PHASE)

1. **Delete WalletRepository** (1-2 hours)
   - Remove file: `src/repositories/WalletRepository.ts`
   - Update all imports (should fail if any missed)
   - Remove from exports

2. **Integration Testing** (8-12 hours)
   - Test wallet creation flow
   - Test wallet restoration flow
   - Test token receipt flow
   - Test token send flow (direct + split)
   - Test IPFS sync (bidirectional)
   - Test outbox recovery
   - Test token recovery
   - Test nametag minting
   - Test corrupted nametag handling
   - Test spent token detection

3. **Documentation** (2-3 hours)
   - Update CLAUDE.md
   - Update architecture diagrams
   - Document new patterns
   - Update onboarding docs

**Total Estimated Time:** 11-17 hours

---

## Implementation Order

### Recommended Order (by dependency graph):

```
Phase 6 (Low-Impact) - 2-4 hours
├── ConflictResolutionService (type-only)
├── InventoryBackgroundLoops (verify no usage)
├── unicityIdValidator (type-only)
├── devTools.ts (migrate)
└── Move NametagData type to shared location

Phase 7 (Core Services) - 9-14 hours
├── TokenRecoveryService (4-6 hours)
│   └── Required by: OutboxRecoveryService, TokenSplitExecutor, useWallet
├── OutboxRecoveryService (3-5 hours)
│   └── Required by: useWallet
└── TokenSplitExecutor (2-3 hours)
    └── Required by: useWallet

Phase 8 (Major Consumers) - 23-32 hours
├── useIpfsStorage (3-4 hours)
│   └── Standalone, low dependency
├── IpfsStorageService (8-12 hours)
│   └── Required by: useWallet (indirectly)
└── useWallet (12-16 hours)
    └── Final integration point

Phase 9 (Cleanup) - 11-17 hours
├── Delete WalletRepository (1-2 hours)
├── Integration Testing (8-12 hours)
└── Documentation (2-3 hours)

TOTAL: 45-67 hours (5-8 days of work)
```

---

## Risk Assessment

### High Risks

**Risk 1: Async Operations Breaking Sync Code**
- **Impact:** HIGH
- **Probability:** HIGH
- **Description:** Many WalletRepository methods are synchronous. Making them async breaks calling code.
- **Mitigation:**
  - Add `async/await` systematically
  - Update all callers in same PR
  - Test with console errors enabled
  - Use TypeScript strict mode to catch missing awaits

**Risk 2: State Hash Extraction Errors**
- **Impact:** HIGH
- **Probability:** MEDIUM
- **Description:** Incorrect state hash extraction breaks tombstone system, allowing zombie tokens.
- **Mitigation:**
  - Create helper function for state hash extraction
  - Add validation: throw if state hash is empty
  - Test with spent tokens
  - Add logging for state hash operations

**Risk 3: Lost Tokens During Migration**
- **Impact:** CRITICAL
- **Probability:** LOW
- **Description:** Improper migration could lose user tokens from localStorage.
- **Mitigation:**
  - NO destructive operations on localStorage
  - InventorySyncService reads same storage keys as WalletRepository
  - Test migration on staging data first
  - Add backup/restore mechanism for testing

### Medium Risks

**Risk 4: IPFS Sync Breaking**
- **Impact:** HIGH
- **Probability:** MEDIUM
- **Description:** IpfsStorageService migration errors break bidirectional sync.
- **Mitigation:**
  - Migrate IpfsStorageService in isolated PR
  - Test sync thoroughly before merging
  - Keep rollback path available
  - Monitor sync metrics

**Risk 5: Outbox Recovery Failing**
- **Impact:** MEDIUM
- **Probability:** LOW
- **Description:** OutboxRecoveryService migration breaks crash recovery.
- **Mitigation:**
  - Test with incomplete transfers
  - Verify all status transitions
  - Test with various failure modes
  - Keep extensive logging

### Low Risks

**Risk 6: Dev Tools Breaking**
- **Impact:** LOW
- **Probability:** MEDIUM
- **Description:** Dev tools migration may break testing utilities.
- **Mitigation:**
  - Migrate dev tools last
  - Accept temporary breakage during migration
  - Rebuild dev tools if needed

---

## Testing Requirements

### Unit Tests

**Per File:**
- [ ] TokenRecoveryService
  - Orphan recovery finds candidates
  - Orphan recovery reconstructs tokens
  - Transfer failure classification
  - Token reversion logic
  - Spent token removal
- [ ] OutboxRecoveryService
  - Recovery from each status
  - Mint recovery with nametag
  - Source token lookup
  - Nametag restoration
- [ ] TokenSplitExecutor
  - Burn failure recovery
  - Mint failure recovery
  - Token lookup during split
- [ ] useIpfsStorage
  - Restore from CID
  - Restore from last CID
  - Post-restore validation
  - Spent token removal
- [ ] useWallet
  - Query flows (identity, nametag, tokens, aggregated)
  - Mutation flows (create, restore, mint, send)
  - Spent token detection
  - Token archiving
  - Nametag corruption handling
  - Split operations
  - Direct transfers

### Integration Tests

**Critical Flows:**
- [ ] Wallet creation + nametag minting
- [ ] Wallet restoration from mnemonic
- [ ] Token receipt via Nostr
- [ ] Token send (direct)
- [ ] Token send (split)
- [ ] IPFS sync (local → IPFS)
- [ ] IPFS sync (IPFS → local)
- [ ] IPFS conflict resolution
- [ ] Outbox recovery after crash
- [ ] Token recovery (orphaned splits)
- [ ] Spent token detection and removal
- [ ] Corrupted nametag handling

### Regression Tests

**Existing Functionality:**
- [ ] L1 wallet still works
- [ ] L3 wallet displays correctly
- [ ] Address selection works
- [ ] Transaction history persists
- [ ] Nametag validation works
- [ ] Faucet token receipt works

---

## Success Criteria

### Phase Completion Criteria

**Phase 6 Complete:**
- [ ] All low-impact files migrated
- [ ] NametagData moved to shared types
- [ ] No WalletRepository imports in low-impact files
- [ ] All tests pass

**Phase 7 Complete:**
- [ ] TokenRecoveryService migrated and tested
- [ ] OutboxRecoveryService migrated and tested
- [ ] TokenSplitExecutor migrated and tested
- [ ] All callers updated
- [ ] All tests pass

**Phase 8 Complete:**
- [ ] useIpfsStorage migrated and tested
- [ ] IpfsStorageService migrated and tested
- [ ] useWallet migrated and tested
- [ ] All queries and mutations work
- [ ] All tests pass

**Phase 9 Complete:**
- [ ] WalletRepository deleted
- [ ] No compilation errors
- [ ] All integration tests pass
- [ ] Documentation updated
- [ ] Code review completed

### Final Acceptance Criteria

- [ ] Zero WalletRepository imports in codebase
- [ ] All unit tests pass (100% coverage on migrated files)
- [ ] All integration tests pass
- [ ] Manual testing of critical flows successful
- [ ] Performance acceptable (no regressions)
- [ ] IPFS sync works bidirectionally
- [ ] Outbox recovery works for all statuses
- [ ] Token recovery works for orphaned splits
- [ ] No data loss during migration
- [ ] Documentation complete and accurate

---

## Rollback Plan

### If Migration Fails

**Step 1: Identify Failure**
- Check which phase failed
- Identify specific file/function causing issue
- Document error messages and stack traces

**Step 2: Rollback Code**
- Revert commits for failed phase
- Keep earlier phase changes (6, 7 complete)
- Restore WalletRepository if deleted

**Step 3: Restore Data**
- No data restoration needed (migration doesn't change storage format)
- InventorySyncService uses same localStorage keys

**Step 4: Debug and Retry**
- Fix identified issue
- Test in isolation
- Re-attempt migration

### Emergency Rollback (Complete Failure)

**If entire migration must be reverted:**
1. Revert all commits back to Phase 5 completion
2. Restore WalletRepository from git history
3. Restore all original imports
4. Test that app works as before
5. Document lessons learned
6. Plan alternative approach

---

## Next Steps

### Immediate Actions (Next 2 Weeks)

1. **Week 1: Phase 6 + Start Phase 7**
   - Complete low-impact migration (ConflictResolutionService, devTools, type moves)
   - Start TokenRecoveryService migration
   - Write comprehensive tests for TokenRecoveryService

2. **Week 2: Complete Phase 7**
   - Finish TokenRecoveryService
   - Migrate OutboxRecoveryService
   - Migrate TokenSplitExecutor
   - Update all callers
   - Run integration tests

### Medium-term (Next 4 Weeks)

3. **Week 3: useIpfsStorage + Start IpfsStorageService**
   - Migrate useIpfsStorage (relatively simple)
   - Begin detailed analysis of IpfsStorageService
   - Map all WalletRepository usage in IpfsStorageService

4. **Week 4: Complete IpfsStorageService**
   - Complete IpfsStorageService migration
   - Test IPFS sync extensively
   - Test conflict resolution

### Long-term (Next 6 Weeks)

5. **Week 5-6: useWallet Migration**
   - Migrate useWallet (most complex file)
   - Update all queries and mutations
   - Add async/await throughout
   - Test all flows

6. **Week 7: Cleanup and Testing**
   - Delete WalletRepository
   - Run full integration test suite
   - Fix any remaining issues
   - Update documentation

---

## Appendix: Helper Functions

### Recommended Helper Functions to Create

```typescript
// src/components/wallet/L3/services/helpers/tokenHelpers.ts

import type { Token } from "../../data/model";
import { tokenToTxf, getCurrentStateHash } from "../TxfSerializer";
import { InventorySyncService } from "../InventorySyncService";

/**
 * Remove token with automatic state hash extraction and tombstone creation
 */
export async function removeTokenWithTombstone(
  address: string,
  publicKey: string,
  ipnsName: string,
  token: Token,
  options?: {
    archiveReason?: string;
    skipHistory?: boolean;
  }
): Promise<void> {
  const txf = tokenToTxf(token);
  if (!txf) {
    throw new Error(`Cannot convert token ${token.id} to TXF format`);
  }

  const stateHash = getCurrentStateHash(txf);
  if (!stateHash) {
    throw new Error(`Cannot extract state hash from token ${token.id}`);
  }

  await InventorySyncService.removeToken(
    address,
    publicKey,
    ipnsName,
    token.id,
    stateHash,
    {
      archiveReason: options?.archiveReason,
      skipHistory: options?.skipHistory,
    }
  );
}

/**
 * Get SDK token ID from UI token
 */
export function getSdkTokenId(token: Token): string | null {
  if (!token.jsonData) return null;
  try {
    const parsed = JSON.parse(token.jsonData);
    return parsed.genesis?.data?.tokenId || null;
  } catch {
    return null;
  }
}

/**
 * Batch add tokens (for restore operations)
 */
export async function addTokensBatch(
  address: string,
  publicKey: string,
  ipnsName: string,
  tokens: Token[],
  options?: {
    skipHistory?: boolean;
  }
): Promise<void> {
  for (const token of tokens) {
    await InventorySyncService.addToken(
      address,
      publicKey,
      ipnsName,
      token,
      options
    );
  }
}
```

---

## Conclusion

This migration is substantial but well-structured. The stateless architecture of InventorySyncService is superior to the stateful WalletRepository, and will result in more maintainable code.

**Key Success Factors:**
1. Methodical approach (phase by phase)
2. Comprehensive testing at each phase
3. Proper handling of async operations
4. Careful state hash extraction
5. Extensive integration testing

**Estimated Total Effort:** 45-67 hours (5-8 business days)

**Risk Level:** Medium (manageable with proper testing)

**Recommendation:** Proceed with migration following the phased approach outlined above.
