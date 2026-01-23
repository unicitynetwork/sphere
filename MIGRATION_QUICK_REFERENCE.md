# WalletRepository → InventorySyncService Migration Quick Reference

## Cheat Sheet: Common Migration Patterns

### Pattern 1: Get Tokens

```typescript
// ❌ OLD (WalletRepository)
const tokens = walletRepo.getTokens();

// ✅ NEW (InventorySyncService)
const tokens = await InventorySyncService.getTokensForAddress(address);
```

### Pattern 2: Add Token

```typescript
// ❌ OLD
walletRepo.addToken(token, skipHistory);

// ✅ NEW
await InventorySyncService.addToken(
  address,
  publicKey,
  ipnsName,
  token,
  { skipHistory: true }
);
```

### Pattern 3: Remove Token (with tombstone)

```typescript
// ❌ OLD
walletRepo.removeToken(token.id, reason, skipHistory);

// ✅ NEW
import { tokenToTxf, getCurrentStateHash } from "./TxfSerializer";

const txf = tokenToTxf(token);
const stateHash = getCurrentStateHash(txf) ?? '';
await InventorySyncService.removeToken(
  address,
  publicKey,
  ipnsName,
  token.id,
  stateHash,
  { archiveReason: reason, skipHistory: true }
);

// OR use helper (recommended):
await removeTokenWithTombstone(address, publicKey, ipnsName, token, {
  archiveReason: reason,
  skipHistory: true
});
```

### Pattern 4: Get/Set Nametag

```typescript
// ❌ OLD
const nametag = walletRepo.getNametag();
walletRepo.setNametag(nametagData);

// ✅ NEW
const nametag = InventorySyncService.getNametagForAddress(address);
await InventorySyncService.setNametagForAddress(address, nametagData);
```

### Pattern 5: Trigger UI Refresh

```typescript
// ❌ OLD
walletRepo.forceRefreshCache();

// ✅ NEW
InventorySyncService.dispatchWalletUpdated();
```

### Pattern 6: Check Wallet Exists / Load Wallet

```typescript
// ❌ OLD
const wallet = walletRepo.getWallet();
if (!wallet || wallet.address !== identity.address) {
  const loaded = walletRepo.loadWalletForAddress(identity.address);
  if (!loaded) {
    walletRepo.createWallet(identity.address);
  }
}

// ✅ NEW
// No wallet concept! Just use address directly.
// If no tokens exist, operations will work on empty list.
// No need to "create" wallet - it's implicit.
```

### Pattern 7: Get Archived Tokens

```typescript
// ❌ OLD
const archived = walletRepo.getArchivedTokens();

// ✅ NEW
const archived = InventorySyncService.getArchivedTokensForAddress(address);
```

### Pattern 8: Get Tombstones

```typescript
// ❌ OLD
// (no direct method, used internally)

// ✅ NEW
const tombstones = InventorySyncService.getTombstonesForAddress(address);
```

---

## File-by-File Migration Checklist

### ✅ COMPLETED (Phases 0-5)
- [x] SendModal.tsx
- [x] L3WalletView.tsx
- [x] AddressSelector.tsx
- [x] useL1Wallet.ts
- [x] L1WalletView.tsx
- [x] L1WalletModal.tsx
- [x] useAddressNametags.ts
- [x] scan.ts
- [x] useWalletImport.ts
- [x] NostrService.ts
- [x] NametagService.ts
- [x] useOnboardingFlow.ts

### 🔄 PHASE 6 - Low Impact (30% done, 2-4 hours remaining)
- [ ] ConflictResolutionService.ts (type-only import, move NametagData type)
- [ ] InventoryBackgroundLoops.ts (verify no usage)
- [ ] unicityIdValidator.ts (type-only import likely)
- [ ] devTools.ts (migrate dev utilities)

### 📋 PHASE 7 - Core Services (9-14 hours)
Priority order (by dependency):
1. [ ] TokenRecoveryService.ts (4-6 hours) - Required by multiple files
2. [ ] OutboxRecoveryService.ts (3-5 hours) - Required by useWallet
3. [ ] TokenSplitExecutor.ts (2-3 hours) - Required by useWallet

### 🎯 PHASE 8 - Major Consumers (23-32 hours)
Priority order:
1. [ ] useIpfsStorage.ts (3-4 hours) - Standalone
2. [ ] IpfsStorageService.ts (8-12 hours) - Most complex
3. [ ] useWallet.ts (12-16 hours) - Final integration

### 🧹 PHASE 9 - Cleanup (11-17 hours)
- [ ] Delete WalletRepository.ts
- [ ] Integration testing
- [ ] Documentation updates

---

## Common Gotchas

### Gotcha 1: Forgot to await

```typescript
// ❌ WRONG - Missing await
const tokens = InventorySyncService.getTokensForAddress(address);

// ✅ CORRECT
const tokens = await InventorySyncService.getTokensForAddress(address);
```

### Gotcha 2: Missing state hash

```typescript
// ❌ WRONG - No state hash
await InventorySyncService.removeToken(address, publicKey, ipnsName, token.id);

// ✅ CORRECT
const txf = tokenToTxf(token);
const stateHash = getCurrentStateHash(txf) ?? '';
await InventorySyncService.removeToken(
  address, publicKey, ipnsName, token.id, stateHash
);
```

### Gotcha 3: Using wallet concept

```typescript
// ❌ WRONG - No wallet object exists
const wallet = getWallet();
if (wallet) { ... }

// ✅ CORRECT - Just use address
const tokens = await InventorySyncService.getTokensForAddress(address);
if (tokens.length > 0) { ... }
```

### Gotcha 4: Synchronous in async context

```typescript
// ❌ WRONG - Can't use sync getTokens() in async function
async function myFunction() {
  const tokens = walletRepo.getTokens(); // OLD - sync
  for (const token of tokens) {
    await processToken(token);
  }
}

// ✅ CORRECT
async function myFunction() {
  const tokens = await InventorySyncService.getTokensForAddress(address);
  for (const token of tokens) {
    await processToken(token);
  }
}
```

### Gotcha 5: Missing address/publicKey/ipnsName

```typescript
// ❌ WRONG - Where does InventorySyncService get address?
await InventorySyncService.addToken(token);

// ✅ CORRECT - Must provide context
const identity = await identityManager.getCurrentIdentity();
if (!identity) throw new Error("No identity");

await InventorySyncService.addToken(
  identity.address,
  identity.publicKey,
  identity.ipnsName,
  token
);
```

---

## Testing Checklist Per File

When migrating a file, test these scenarios:

### Basic Operations
- [ ] Token list loads correctly
- [ ] Token addition works
- [ ] Token removal works
- [ ] Nametag loads correctly
- [ ] Nametag updates correctly

### Edge Cases
- [ ] Empty token list (no wallet exists yet)
- [ ] Corrupted token data
- [ ] Missing identity
- [ ] Missing nametag
- [ ] Concurrent operations

### Error Handling
- [ ] Network errors during async operations
- [ ] Invalid token JSON
- [ ] Missing state hash
- [ ] Invalid address

### Performance
- [ ] No excessive localStorage reads
- [ ] Async operations don't block UI
- [ ] Batch operations when possible

---

## Helper Function Library

Create this file: `src/components/wallet/L3/services/helpers/tokenHelpers.ts`

```typescript
import type { Token } from "../../data/model";
import { tokenToTxf, getCurrentStateHash } from "../TxfSerializer";
import { InventorySyncService } from "../InventorySyncService";

/**
 * Remove token with automatic state hash extraction
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
 * Batch add tokens (for restore operations)
 */
export async function addTokensBatch(
  address: string,
  publicKey: string,
  ipnsName: string,
  tokens: Token[],
  options?: { skipHistory?: boolean }
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

/**
 * Get identity context (DRY helper)
 */
export async function getIdentityContext(
  identityManager: IdentityManager
): Promise<{
  address: string;
  publicKey: string;
  ipnsName: string;
}> {
  const identity = await identityManager.getCurrentIdentity();
  if (!identity) {
    throw new Error("No identity available");
  }
  if (!identity.address || !identity.publicKey || !identity.ipnsName) {
    throw new Error("Incomplete identity data");
  }
  return {
    address: identity.address,
    publicKey: identity.publicKey,
    ipnsName: identity.ipnsName,
  };
}
```

Usage:
```typescript
// Instead of this boilerplate everywhere:
const identity = await identityManager.getCurrentIdentity();
if (!identity) throw new Error("No identity");
await InventorySyncService.removeToken(
  identity.address,
  identity.publicKey,
  identity.ipnsName,
  token.id,
  stateHash
);

// Use helpers:
const { address, publicKey, ipnsName } = await getIdentityContext(identityManager);
await removeTokenWithTombstone(address, publicKey, ipnsName, token);
```

---

## Timeline Summary

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| 0-5 | Foundation + low-impact files | 30 hours | ✅ Complete |
| 6 | Complete low-impact migration | 2-4 hours | 🔄 30% done |
| 7 | Core services (Recovery, Outbox, Split) | 9-14 hours | 📋 Pending |
| 8 | Major consumers (useWallet, IPFS) | 23-32 hours | 📋 Pending |
| 9 | Cleanup + testing + docs | 11-17 hours | 📋 Pending |
| **TOTAL** | **All phases** | **45-67 hours** | **~50% done** |

---

## Emergency Contacts

If stuck on migration:

1. **State hash issues:** Check `TxfSerializer.ts` - `getCurrentStateHash()` function
2. **Async/await errors:** Ensure all InventorySyncService calls are awaited
3. **Missing identity:** Check `IdentityManager.getCurrentIdentity()` returns all fields
4. **Tombstone issues:** Verify state hash matches token's current state
5. **IPFS sync issues:** Check `IpfsStorageService` and `SyncCoordinator`

Common debugging commands:
```typescript
// Check localStorage directly
console.log(localStorage.getItem(`sphere_wallet_${address}`));

// Check if token has valid TXF
const txf = tokenToTxf(token);
console.log('TXF valid:', !!txf);
console.log('State hash:', getCurrentStateHash(txf));

// Check tombstones
console.log(InventorySyncService.getTombstonesForAddress(address));
```

---

## Success Metrics

After each phase, verify:

- [ ] No TypeScript errors
- [ ] No console errors in browser
- [ ] All unit tests pass
- [ ] Manual testing of affected features works
- [ ] No performance regressions
- [ ] IPFS sync still works (if applicable)
- [ ] Outbox recovery still works (if applicable)

Final success criteria:
- [ ] WalletRepository.ts deleted
- [ ] Zero imports of WalletRepository anywhere
- [ ] All tests pass (unit + integration)
- [ ] Manual E2E testing successful
- [ ] Documentation updated
- [ ] Code review completed
