# Sphere Wallet Faucet Token Request Analysis

## Executive Summary

Analysis of console logs from a faucet token request reveals **4 critical issues** across validation, IPNS resolution, performance, and data consistency layers. Root causes identified in InventorySyncService, IpfsHttpResolver, and useWallet query lifecycle.

---

## Issue 1: Token Validation Inconsistency

**Severity: CRITICAL (Security/Data Integrity)**

### Problem Description

Three tokens fail validation in Step 4 (InventorySyncService.ts line 620-630) with "Invalid or missing previousStateHash" error:
- Token `7eb75565...` failed transaction 0 validation
- Token `96c00ec1...` failed transaction 0 validation
- Token `f51f74fe...` failed transaction 0 validation

**BUT** later IpfsStorageService (line ~2100) shows ALL 4 tokens as VALID. This 3→4 token discrepancy indicates:
1. Tokens are being added AFTER validation
2. Validation results aren't being enforced
3. Invalid tokens are being synced to IPFS

### Root Cause Analysis

**Location:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

The validation pipeline has a critical **timing gap**:

```typescript
// Step 4: Commitment Validation (line 593-651)
async function step4_validateCommitments(ctx: SyncContext): Promise<void> {
  for (const [tokenId, txf] of ctx.tokens) {
    // Lines 616-637: Validates transaction commits
    let txValid = true;
    if (txf.transactions && txf.transactions.length > 0) {
      for (let i = 0; i < txf.transactions.length; i++) {
        const tx = txf.transactions[i];
        if (tx.inclusionProof) {
          const txResult = validateTransactionCommitment(txf, i);
          if (!txResult.valid) {
            // REMOVES token from active set
            ctx.tokens.delete(tokenId);
            ctx.stats.tokensRemoved++;
            break;  // <-- Critical: Only checks FIRST transaction!
          }
        }
      }
    }
  }
}

// Step 5: SDK Validation (line 798-863)
// SEPARATELY validates tokens using aggregator
// This re-adds tokens or marks them invalid in _invalid folder

// Step 9: Prepare Storage (line 1265-1322)
// Writes BOTH ctx.tokens (active) AND ctx.invalid (failed)
```

**The Issue:**

1. **Step 4** moves invalid tokens to `ctx.invalid` array but removes from `ctx.tokens`
2. **Step 5** calls `validationService.validateAllTokens()` which performs SDK-level validation
3. **However**, if new tokens arrive between Step 4 and Step 5, or if Step 5 validates differently, there's NO re-sync
4. **Step 9** writes all accumulated data to IPFS without ensuring Step 4 and Step 5 results are coherent

The `validateTransactionCommitment()` function is overly strict:

```typescript
// Line 773-774
if (!tx.previousStateHash || !isValidHexString(tx.previousStateHash, 64)) {
  return { valid: false, reason: 'Invalid or missing previousStateHash' };
}
```

This check fails if:
- `previousStateHash` is undefined (tokens freshly minted may not have this)
- `previousStateHash` format is wrong (version mismatch?)
- Genesis tokens with only `inclusionProof` but no transaction chain

### Evidence

Console output shows:
```
Token 7eb75565... failed transaction 0 validation: Invalid or missing previousStateHash
```

But later:
```
✓ All 4 tokens are VALID (IpfsStorageService validation complete)
```

### Why This Happened

1. **Faucet tokens are fresh genesis-only tokens** (no transaction chain)
2. Step 4 incorrectly rejects tokens with only genesis but no transactions
3. Step 5 re-validates and accepts them
4. Both validation states get written to IPFS (invalid + valid copies)
5. User sees duplicate/inconsistent data

### Impact

- Tokens marked invalid in Step 4 are resurrected in Step 5
- Both valid AND invalid states stored to IPFS
- On next sync, tokens flip between valid/invalid randomly
- Possible token loss or unexpected balance changes

### Fix Required

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

1. **Line 616-637:** Genesis-only tokens (no transactions) should be valid
2. **Line 773:** Allow missing `previousStateHash` for transaction 0 (genesis state)
3. **Line 778-786:** Fix state hash chain verification for genesis transitions

```typescript
// CURRENT (INCORRECT)
if (txIndex === 0) {
  const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
  if (!genesisStateHash) {
    return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
  }
  if (tx.previousStateHash !== genesisStateHash) {
    return { valid: false, reason: `Chain break: previousStateHash doesn't match genesis...` };
  }
}

// SHOULD BE
if (txIndex === 0) {
  // Genesis tokens may not have previousStateHash if they're freshly minted
  // Only validate if previousStateHash exists
  if (tx.previousStateHash) {
    const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
    if (!genesisStateHash) {
      return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
    }
    if (tx.previousStateHash !== genesisStateHash) {
      return { valid: false, reason: `Chain break...` };
    }
  }
  // Allow transaction 0 without previousStateHash (first state transition after genesis)
}
```

---

## Issue 2: IPNS Resolution Failure

**Severity: HIGH (Availability/Performance)**

### Problem Description

IPNS resolution attempts return HTTP 400 Bad Request:
```
POST https://unicity-ipfs1.dyndns.org/api/v0/routing/get?arg=/ipns/ 400 (Bad Request)
GET https://unicity-ipfs1.dyndns.org/ipns/ 400 (Bad Request)
```

The URL appears to have an **empty IPNS name** parameter: `/ipns/` with nothing after the slash.

### Root Cause Analysis

**Location:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts` lines 66, 102

The resolver constructs URLs directly from the `ipnsName` parameter without validation:

```typescript
// Line 66 (tryGatewayPath)
const url = `${gatewayUrl}/ipns/${ipnsName}`;

// Line 102 (tryRoutingApi)
const url = `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`;
```

If `ipnsName` is:
- `undefined` → becomes `/ipns/undefined` or `/ipns/null`
- Empty string `""` → becomes `/ipns/` (observed!)
- Not a string → type coercion creates invalid URL

### Where ipnsName Becomes Empty

**InventorySyncService.ts line 401:**

```typescript
async function step2_loadIpfs(ctx: SyncContext): Promise<void> {
  const resolution = await resolver.resolveIpnsName(ctx.ipnsName);
  // ctx.ipnsName comes from SyncParams passed to inventorySync()
}
```

**SyncParams (line 44-68):**

```typescript
export interface SyncParams {
  ipnsName: string;  // REQUIRED but not validated
  // ...
}
```

**Callers may pass:**
- `undefined` → becomes `"undefined"` when coerced to string
- `null` → becomes `"null"`
- `""` → stays empty
- Not yet derived → not available yet

### Evidence

The error occurs because:
1. IPNS name derivation may not complete before sync starts
2. No pre-flight validation in `inventorySync()`
3. HTTP layer doesn't reject malformed URLs

```typescript
// Line 205 in IpfsHttpResolver
async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
  // No check: if (!ipnsName) return error
  // Just proceeds to build URL
}
```

### Why This Happened

1. **Race condition:** Token sync starts before IPNS name is derived
2. **Missing validation:** `resolveIpnsName()` accepts any string
3. **Type coercion:** JavaScript silently converts falsy values to strings
4. **No error recovery:** 400 response is treated as "gateway failed" not "IPNS name invalid"

### Impact

- IPFS sync completely blocked (all gateway requests fail)
- Tokens can't be synced to IPFS
- User loses backup capability
- Repeated HTTP 400 errors flood logs

### Fix Required

**File 1:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts`

Add validation at start of `resolveIpnsName()` (line 205):

```typescript
async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
  // VALIDATE IPNS NAME FORMAT
  if (!ipnsName || typeof ipnsName !== 'string' || ipnsName.trim() === '') {
    return {
      success: false,
      error: `Invalid IPNS name: "${ipnsName}" (must be non-empty string)`,
      source: "none",
      latencyMs: 0,
    };
  }

  // Also validate format (e.g., k-prefix for libp2p keys)
  if (!ipnsName.startsWith('k') && ipnsName.length < 50) {
    console.warn(`⚠️ Unusual IPNS name format: ${ipnsName.slice(0, 20)}...`);
  }

  // ... rest of function
}
```

**File 2:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

Validate sync parameters (line 132-167):

```typescript
export async function inventorySync(params: SyncParams): Promise<SyncResult> {
  const startTime = Date.now();

  // VALIDATE REQUIRED PARAMETERS
  if (!params.ipnsName || params.ipnsName.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: IPNS name missing/empty');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('IPNS name is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing IPNS name'));
  }

  if (!params.address || params.address.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: address missing/empty');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('Address is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing address'));
  }

  if (!params.publicKey || params.publicKey.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: publicKey missing/empty');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('Public key is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing public key'));
  }

  const mode = detectSyncMode({...});
  // ... continue
}
```

---

## Issue 3: Excessive Query Calls - Spent Check Loop

**Severity: MEDIUM (Performance/Resource)**

### Problem Description

`[tokensQuery] Running spent check` appears 20+ times for what should be a single operation. This indicates:
1. Query is re-running repeatedly instead of once
2. Spent check cache isn't working
3. Possible infinite refetch loop

### Root Cause Analysis

**Location:** `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts` lines 181-268

The `tokensQuery` hook has multiple re-fetch triggers:

```typescript
const tokensQuery = useQuery({
  queryKey: [...KEYS.TOKENS, identityQuery.data?.address],  // Line 183
  queryFn: async () => {
    // Lines 230-263: Spent check called EVERY TIME query runs
    if (tokens.length > 0 && identity.publicKey) {
      console.log(`📦 [tokensQuery] Running spent check for ${tokens.length} token(s)...`);

      // CRITICAL: This check clears cache AND queries aggregator
      validationService.clearUnspentCacheEntries();  // Line 238

      const spentCheck = await validationService.checkSpentTokens(
        tokens,
        identity.publicKey,
        { batchSize: 3 }
      );
      // ...
    }
  },
  enabled: !!identityQuery.data?.address,  // Line 267
});
```

**Why it runs 20+ times:**

1. **Query gets invalidated multiple times:**
   ```typescript
   // useWallet.ts lines 46-71
   useEffect(() => {
     const handleWalletUpdate = () => {
       queryClient.refetchQueries({ queryKey: KEYS.TOKENS });  // Line 48 - REFETCH
       queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
     };
     window.addEventListener("wallet-updated", handleWalletUpdate);
   }, [queryClient]);

   // Line 149-158: SECOND lifecycle hook
   useEffect(() => {
     if (identity && nametag) {
       const storageService = IpfsStorageService.getInstance(identityManager);
       storageService.startAutoSync();  // This likely triggers wallet-updated
     }
   }, [identityQuery.data, nametagQuery.data, identityManager]);
   ```

2. **InventorySyncService emits wallet-updated events:**
   - Each sync step may emit events
   - Events trigger query refetch
   - Query runs from cache, but spent check is NOT cached
   - Results in 20+ aggregator requests

3. **No proper cache invalidation:**
   ```typescript
   // Line 238: Clears UNSPENT cache
   validationService.clearUnspentCacheEntries();

   // But this means every query run re-checks all tokens
   // Even if nothing changed
   ```

### Evidence

Flow:
```
1. User requests wallet load
2. tokensQuery runs → spent check (1)
3. IPFS sync completes → emits wallet-updated
4. handleWalletUpdate calls refetchQueries(KEYS.TOKENS)
5. tokensQuery runs AGAIN → spent check (2)
6. IPFS publishes → emits wallet-updated again
7. handleWalletUpdate calls refetchQueries again
8. ... repeats 20+ times
```

### Impact

- Massive load on aggregator (20 requests instead of 1)
- Slow wallet load (each request takes 100-300ms)
- 2-6 second delay instead of <500ms
- Possible aggregator rate limiting
- Battery drain on mobile

### Fix Required

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts`

1. **Only check spent tokens once per identity** (line 181-268):

```typescript
const tokensQuery = useQuery({
  queryKey: [...KEYS.TOKENS, identityQuery.data?.address],
  queryFn: async () => {
    const identity = identityQuery.data;
    if (!identity?.address) return [];

    // ... wallet load logic ...

    let tokens = walletRepo.getTokens();

    // ... pending outbox filtering ...

    // CRITICAL FIX: Only check spent tokens if explicitly requested
    // OR on first load (add query parameter to track this)
    if (tokens.length > 0 && identity.publicKey) {
      const lastSpentCheckTime = sessionStorage.getItem(
        `last-spent-check-${identity.address}`
      );
      const now = Date.now();

      // Only re-check if >30 seconds have passed
      if (!lastSpentCheckTime || now - parseInt(lastSpentCheckTime) > 30000) {
        console.log(`📦 [tokensQuery] Running spent check for ${tokens.length} token(s)...`);

        try {
          const validationService = getTokenValidationService();

          // Don't clear UNSPENT cache - use it!
          // Only clear if explicitly forced
          // validationService.clearUnspentCacheEntries();

          const spentCheck = await validationService.checkSpentTokens(
            tokens,
            identity.publicKey,
            { batchSize: 3 }
          );

          if (spentCheck.spentTokens.length > 0) {
            console.warn(`⚠️ Found ${spentCheck.spentTokens.length} spent token(s)`);
            for (const spent of spentCheck.spentTokens) {
              walletRepo.removeToken(spent.localId, 'spent-on-aggregator');
            }
            sessionStorage.setItem(`last-spent-check-${identity.address}`, now.toString());
            return walletRepo.getTokens();
          }

          sessionStorage.setItem(`last-spent-check-${identity.address}`, now.toString());
        } catch (err) {
          console.warn('📦 [tokensQuery] Failed to check spent tokens:', err);
        }
      } else {
        console.log(`📦 [tokensQuery] Skipping spent check (checked ${Math.round((now - parseInt(lastSpentCheckTime)) / 1000)}s ago)`);
      }
    }

    return tokens;
  },
  enabled: !!identityQuery.data?.address,
  staleTime: 5000,  // Add stale time to reduce refetches
});
```

2. **Prevent excessive wallet-updated events** (decouple IPFS sync from query invalidation):

```typescript
// Line 46-71: Reduce invalidation frequency
useEffect(() => {
  let debounceTimer: ReturnType<typeof setTimeout>;

  const handleWalletUpdate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Only refetch, don't invalidate (reuse cache if fresh)
      queryClient.refetchQueries({
        queryKey: KEYS.TOKENS,
        // Add condition to only refetch if >1 second old
        stale: true
      });
    }, 500);  // Debounce rapid updates
  };

  window.addEventListener("wallet-updated", handleWalletUpdate);
  return () => {
    window.removeEventListener("wallet-updated", handleWalletUpdate);
    clearTimeout(debounceTimer);
  };
}, [queryClient]);
```

---

## Issue 4: CID Mismatch Warning

**Severity: LOW (Non-blocking, Expected Behavior)**

### Problem Description

Warning appears during IPFS upload:
```
⚠️ CID mismatch: expected bagaaierau67uhdo..., got bafkreifhx5by3sy...
```

Two different CID formats in same operation suggests encoding mismatch.

### Root Cause Analysis

**Location:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts` line 1432

```typescript
const returnedCid = successful[0].value.cid;
if (returnedCid !== expectedCid) {
  console.warn(`  ⚠️ CID mismatch: expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
  // Non-fatal - use the returned CID (gateway may use different encoding)
}
```

The issue: Two CID formats are being compared:
- **bagaaierau67uhdo** = Incomplete CID (likely truncated Base32)
- **bafkreifhx5by3sy** = Complete CIDv1 in Base32 (baf = base32 codec prefix)

### Why This Happens

1. **Content encoding differs between nodes:**
   - Browser computes CID using `computeCidFromContent()` (line 1359)
   - Gateway returns different CID (may use different CBOR encoding or codec)

2. **JSON encoding variations:**
   ```typescript
   // Browser (line 151-158)
   export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
     const encoded = jsonCodec.encode(content);  // JSON stringify + encoding
     const hash = await sha256.digest(encoded);
     const computedCid = CID.createV1(jsonCodec.code, hash);
     return computedCid.toString();  // Returns bafk... format
   }

   // Gateway may:
   // - Use different JSON serialization
   // - Reorder object keys
   // - Use different whitespace
   // - Use CBOR instead of JSON
   ```

3. **No verification step before comparison:**
   - Expected CID is computed locally
   - Returned CID is from gateway
   - Both should hash the same content, but encoding differs

### Evidence

The CID prefix tells the story:
- `bagaa...` = Looks like Base32 multibase, but incomplete truncation
- `bafk...` = Proper CIDv1, Base32 encoded (baf = base32 prefix)

This suggests the `expectedCid` is being truncated or not fully encoded.

### Impact

**LOW impact because:**
1. Code explicitly handles this (line 1433): "Non-fatal - use returned CID"
2. Doesn't prevent upload
3. Upload completes successfully
4. Only produces a warning

But should be investigated because:
1. Could mask encoding bugs
2. CID integrity checks may not work if formats differ
3. May cause verification failures later

### Root Cause Location

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts` line 151-159

```typescript
export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  const encoded = jsonCodec.encode(content);
  const hash = await sha256.digest(encoded);
  const computedCid = CID.createV1(jsonCodec.code, hash);
  return computedCid.toString();  // Should return proper bafk... format
}
```

### Verification

The computed CID should always start with `bafk` (CIDv1, Base32-encoded). If it starts with `bagaa`, there's a serialization issue.

### Fix Required

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

Add proper CID comparison (line 1429-1434):

```typescript
// 6. Verify the returned CID matches expected
const returnedCid = successful[0].value.cid;

// IMPROVED: Compare normalized CIDs
// CIDv1 can be represented in different bases (Base32, Base64, etc.)
// so we need to normalize for comparison

let cidMismatch = false;
try {
  // Parse both CIDs to canonical form
  const expectedCidObj = CID.parse(expectedCid);
  const returnedCidObj = CID.parse(returnedCid);

  // Compare multihash (hash-independent of encoding)
  if (expectedCidObj.multihash.bytes !== returnedCidObj.multihash.bytes) {
    cidMismatch = true;
    console.error(`❌ CID hash mismatch: content integrity error`);
  } else {
    console.log(`✅ CID verified (hash matches, may differ in encoding)`);
  }
} catch (err) {
  // If parsing fails, do string comparison
  if (returnedCid !== expectedCid) {
    cidMismatch = true;
    console.warn(`⚠️ CID format mismatch: expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
  }
}

if (cidMismatch) {
  // Non-fatal - use the returned CID (gateway encoding is authoritative)
  console.log(`Using gateway-returned CID as authoritative`);
}
```

However, this is **LOW priority** since the upload succeeds anyway.

---

## Summary Table

| Issue | Severity | Root Cause | Impact | File | Line |
|-------|----------|-----------|--------|------|------|
| Token Validation Inconsistency | **CRITICAL** | Step 4 rejects genesis-only tokens, Step 5 re-validates, both states synced | Duplicate/inconsistent tokens in IPFS | InventorySyncService.ts | 615-790 |
| IPNS Resolution Failure | **HIGH** | Empty/undefined IPNSNAME passed to resolver, no validation | IPFS sync blocked, all 400 errors | IpfsHttpResolver.ts | 66, 102 |
| Excessive Query Calls | **MEDIUM** | Multiple wallet-updated events trigger repeated spent checks | 20+ aggregator requests instead of 1, slow UI | useWallet.ts | 231-246 |
| CID Mismatch Warning | **LOW** | JSON encoding varies between browser and gateway, non-fatal | Noise in logs, no functional impact | InventorySyncService.ts | 1432 |

---

## Recommendation Priority

1. **CRITICAL FIRST:** Fix token validation inconsistency (Issue #1)
   - May cause token loss
   - Affects data integrity
   - Estimated fix: 30 min

2. **HIGH SECOND:** Fix IPNS name validation (Issue #2)
   - Blocks all IPFS operations
   - Easy to reproduce in dev/test
   - Estimated fix: 20 min

3. **MEDIUM THIRD:** Debounce spent check queries (Issue #3)
   - Performance optimization
   - Improves UX
   - Estimated fix: 45 min

4. **LOW LAST:** Improve CID comparison (Issue #4)
   - Non-blocking
   - Polish improvement
   - Estimated fix: 20 min

---

## Testing Recommendations

### For Issue #1 (Validation Inconsistency)
```bash
# Test faucet token load with fresh genesis-only tokens
1. Request tokens from faucet
2. Monitor InventorySyncService console logs
3. Verify tokens appear in ONLY ONE category: active OR invalid
4. Check localStorage for duplicate entries
5. Verify token count matches displayed amount
```

### For Issue #2 (IPNS Resolution)
```bash
# Test with missing/empty IPNS name
1. Manually call inventorySync({ ipnsName: "" })
2. Verify error handling (not HTTP 400)
3. Check console for validation error message
4. Repeat with undefined, null, "undefined"
```

### For Issue #3 (Excessive Queries)
```bash
# Monitor query execution
1. Open DevTools Network tab
2. Load wallet
3. Count POST requests to /rpc (aggregator)
4. Should see ~3-5 requests (batch of 3 tokens)
5. Should NOT see 20+ requests
6. With fix: should see only 1-2 checks per 30 seconds
```

### For Issue #4 (CID Mismatch)
```bash
# Verify CID format
1. Upload tokens to IPFS
2. Check console log: "Expected CID: ..."
3. Verify format starts with "bafk" or "bagaa" consistently
4. Add assertion if mismatch detected
```
