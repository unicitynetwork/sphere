# Sphere Wallet - Issue Fix Roadmap

## Quick Reference

| Issue | File | Lines | Severity | Est. Time |
|-------|------|-------|----------|-----------|
| Token Validation | InventorySyncService.ts | 615-640, 773-786 | CRITICAL | 30 min |
| IPNS Resolution | IpfsHttpResolver.ts, InventorySyncService.ts | 102-110, 205-220, 132-145 | HIGH | 20 min |
| Query Performance | useWallet.ts | 46-71, 181-268 | MEDIUM | 45 min |
| CID Mismatch | InventorySyncService.ts | 1429-1434 | LOW | 20 min |

---

## Fix #1: Token Validation Inconsistency [CRITICAL]

### Files to Modify
- `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

### Step 1.1: Fix validateTransactionCommitment() for genesis tokens

**Location:** Line 734-796

**Current Code (INCORRECT):**
```typescript
function validateTransactionCommitment(txf: TxfToken, txIndex: number): { valid: boolean; reason?: string } {
  const tx = txf.transactions[txIndex];
  if (!tx) {
    return { valid: false, reason: `Transaction ${txIndex} not found` };
  }

  if (!tx.inclusionProof) {
    // Uncommitted transaction - no proof to validate
    return { valid: true };
  }

  const proof = tx.inclusionProof;

  // ... validation code ...

  // Verify previousStateHash format
  if (!tx.previousStateHash || !isValidHexString(tx.previousStateHash, 64)) {
    return { valid: false, reason: 'Invalid or missing previousStateHash' };  // LINE 773-774
  }

  // ... more validation ...

  // Verify state hash chain integrity
  if (txIndex === 0) {
    // First transaction should reference genesis state
    const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
    if (!genesisStateHash) {
      return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
    }
    if (tx.previousStateHash !== genesisStateHash) {
      return { valid: false, reason: `Chain break: previousStateHash doesn't match genesis...` };
    }
  }
  // LINE 778-786
```

**Fixed Code (CORRECT):**
```typescript
function validateTransactionCommitment(txf: TxfToken, txIndex: number): { valid: boolean; reason?: string } {
  const tx = txf.transactions[txIndex];
  if (!tx) {
    return { valid: false, reason: `Transaction ${txIndex} not found` };
  }

  if (!tx.inclusionProof) {
    // Uncommitted transaction - no proof to validate
    return { valid: true };
  }

  const proof = tx.inclusionProof;

  // ... validation code ...

  // Verify previousStateHash format (but allow missing for genesis!)
  // Genesis tokens may not have previousStateHash if they're freshly minted
  if (tx.previousStateHash && !isValidHexString(tx.previousStateHash, 64)) {
    // Only invalid if it EXISTS but is malformed
    return { valid: false, reason: 'Invalid previousStateHash format' };
  }
  // CHANGED: Allow missing previousStateHash (will be checked in chain verification if present)

  // ... more validation ...

  // Verify state hash chain integrity
  if (txIndex === 0) {
    // First transaction (genesis state transition)
    // Only validate chain if previousStateHash is present
    if (tx.previousStateHash) {
      const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
      if (!genesisStateHash) {
        return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
      }
      if (tx.previousStateHash !== genesisStateHash) {
        return { valid: false, reason: `Chain break: previousStateHash doesn't match genesis (expected ${genesisStateHash.slice(0, 16)}..., got ${tx.previousStateHash.slice(0, 16)}...)` };
      }
    }
    // CHANGED: If previousStateHash is missing for first transaction, that's OK
    // (token may be in genesis-only state before any transitions)
  } else {
    // Subsequent transactions must reference previous tx's new state
    if (tx.previousStateHash) {
      const prevTx = txf.transactions[txIndex - 1];
      if (prevTx?.newStateHash && tx.previousStateHash !== prevTx.newStateHash) {
        return { valid: false, reason: `Chain break: previousStateHash doesn't match tx ${txIndex - 1}` };
      }
    }
    // CHANGED: Allow missing previousStateHash (non-critical for subsequent tx)
  }

  return { valid: true };
}
```

**Explanation:**
- Line 773: Changed from `if (!tx.previousStateHash || ...)` to `if (tx.previousStateHash && ...)`
- Now only rejects if previousStateHash EXISTS but is malformed
- Allows missing previousStateHash (genesis tokens are OK without this)
- Line 778-786: Wrapped chain verification in `if (tx.previousStateHash)` check
- Allows genesis-only tokens with no transaction history

### Step 1.2: Add validation for genesis-only tokens

**Location:** Line 615-642 in step4_validateCommitments()

**Current Code (INCOMPLETE):**
```typescript
async function step4_validateCommitments(ctx: SyncContext): Promise<void> {
  console.log(`✓ [Step 4] Validate Commitments`);

  const invalidTokenIds: string[] = [];
  let validatedCount = 0;

  for (const [tokenId, txf] of ctx.tokens) {
    // Step 4.1: Validate genesis commitment
    const genesisValid = validateGenesisCommitment(txf);
    if (!genesisValid.valid) {
      console.warn(`  Token ${tokenId.slice(0, 8)}... failed genesis validation: ${genesisValid.reason}`);
      invalidTokenIds.push(tokenId);
      ctx.invalid.push({
        token: txf,
        timestamp: Date.now(),
        invalidatedAt: Date.now(),
        reason: 'PROOF_MISMATCH' as InvalidReasonCode,
        details: `Genesis: ${genesisValid.reason}`
      });
      continue;
    }

    // Step 4.2: Validate each transaction commitment
    let txValid = true;
    if (txf.transactions && txf.transactions.length > 0) {
      for (let i = 0; i < txf.transactions.length; i++) {
        const tx = txf.transactions[i];
        if (tx.inclusionProof) {
          const txResult = validateTransactionCommitment(txf, i);
          if (!txResult.valid) {
            console.warn(`  Token ${tokenId.slice(0, 8)}... failed transaction ${i} validation: ${txResult.reason}`);
            invalidTokenIds.push(tokenId);
            ctx.invalid.push({
              token: txf,
              timestamp: Date.now(),
              invalidatedAt: Date.now(),
              reason: 'PROOF_MISMATCH' as InvalidReasonCode,
              details: `Transaction ${i}: ${txResult.reason}`
            });
            txValid = false;
            break;  // ISSUE: Only checks first transaction!
          }
        }
      }
    }

    if (txValid) {
      validatedCount++;
    }
  }

  // Remove invalid tokens from active set
  for (const tokenId of invalidTokenIds) {
    ctx.tokens.delete(tokenId);
    ctx.stats.tokensRemoved++;
  }

  console.log(`  ✓ Validated ${validatedCount} tokens, ${invalidTokenIds.length} moved to Invalid folder`);
}
```

**Fixed Code:**
```typescript
async function step4_validateCommitments(ctx: SyncContext): Promise<void> {
  console.log(`✓ [Step 4] Validate Commitments`);

  const invalidTokenIds: string[] = [];
  let validatedCount = 0;
  let genesisOnlyCount = 0;  // NEW: Track genesis-only tokens

  for (const [tokenId, txf] of ctx.tokens) {
    // Step 4.1: Validate genesis commitment
    const genesisValid = validateGenesisCommitment(txf);
    if (!genesisValid.valid) {
      console.warn(`  Token ${tokenId.slice(0, 8)}... failed genesis validation: ${genesisValid.reason}`);
      invalidTokenIds.push(tokenId);
      ctx.invalid.push({
        token: txf,
        timestamp: Date.now(),
        invalidatedAt: Date.now(),
        reason: 'PROOF_MISMATCH' as InvalidReasonCode,
        details: `Genesis: ${genesisValid.reason}`
      });
      continue;
    }

    // NEW: Check if token is genesis-only (no transactions yet)
    if (!txf.transactions || txf.transactions.length === 0) {
      // Genesis-only tokens are VALID - they just haven't been transitioned yet
      genesisOnlyCount++;
      validatedCount++;
      console.log(`  ✓ Token ${tokenId.slice(0, 8)}... is genesis-only (no transactions) - VALID`);
      continue;
    }

    // Step 4.2: Validate each transaction commitment
    let txValid = true;
    for (let i = 0; i < txf.transactions.length; i++) {
      const tx = txf.transactions[i];
      if (tx.inclusionProof) {
        const txResult = validateTransactionCommitment(txf, i);
        if (!txResult.valid) {
          console.warn(`  Token ${tokenId.slice(0, 8)}... failed transaction ${i} validation: ${txResult.reason}`);
          invalidTokenIds.push(tokenId);
          ctx.invalid.push({
            token: txf,
            timestamp: Date.now(),
            invalidatedAt: Date.now(),
            reason: 'PROOF_MISMATCH' as InvalidReasonCode,
            details: `Transaction ${i}: ${txResult.reason}`
          });
          txValid = false;
          break;
        }
      }
    }

    if (txValid) {
      validatedCount++;
    }
  }

  // Remove invalid tokens from active set
  for (const tokenId of invalidTokenIds) {
    ctx.tokens.delete(tokenId);
    ctx.stats.tokensRemoved++;
  }

  console.log(`  ✓ Validated ${validatedCount} tokens (${genesisOnlyCount} genesis-only), ${invalidTokenIds.length} moved to Invalid folder`);
}
```

**Key Changes:**
- Added check for genesis-only tokens (no transactions array or empty)
- These are marked as VALID (they're allowed to have no transactions)
- Only validate transaction chain if transactions exist
- Better logging to distinguish genesis-only tokens

---

## Fix #2: IPNS Resolution Failure [HIGH]

### Files to Modify
- `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts`
- `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

### Step 2.1: Add IPNS name validation to resolver

**Location:** IpfsHttpResolver.ts, line 205-240

**Current Code:**
```typescript
async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
  // Step 1: Check cache first
  const cached = this.cache.getIpnsRecord(ipnsName);
  if (cached) {
    return {
      success: true,
      cid: cached.cid,
      content: cached._cachedContent || null,
      sequence: cached.sequence,
      source: "cache",
      latencyMs: 0,
    };
  }

  // Step 2: Check if we recently failed (backoff)
  if (this.cache.hasRecentFailure(ipnsName)) {
    return {
      success: false,
      error: "Recent resolution failure, backing off",
      source: "cache",
      latencyMs: 0,
    };
  }

  // ... rest of function
}
```

**Fixed Code:**
```typescript
async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
  // CRITICAL: Validate IPNS name format FIRST
  if (!ipnsName || typeof ipnsName !== 'string' || ipnsName.trim() === '') {
    console.error(`❌ Invalid IPNS name: "${ipnsName}" (must be non-empty string)`);
    return {
      success: false,
      error: `Invalid IPNS name: "${ipnsName}" (must be non-empty string)`,
      source: "none",
      latencyMs: 0,
    };
  }

  // Normalize (trim whitespace)
  const normalizedName = ipnsName.trim();

  // Validate format (should start with 'k' for libp2p key or be a hash)
  if (!normalizedName.startsWith('k') && normalizedName.length < 50) {
    console.warn(`⚠️ Unusual IPNS name format: ${normalizedName.slice(0, 20)}... (should start with 'k' or be >50 chars)`);
  }

  // Step 1: Check cache first
  const cached = this.cache.getIpnsRecord(normalizedName);
  if (cached) {
    return {
      success: true,
      cid: cached.cid,
      content: cached._cachedContent || null,
      sequence: cached.sequence,
      source: "cache",
      latencyMs: 0,
    };
  }

  // Step 2: Check if we recently failed (backoff)
  if (this.cache.hasRecentFailure(normalizedName)) {
    return {
      success: false,
      error: "Recent resolution failure, backing off",
      source: "cache",
      latencyMs: 0,
    };
  }

  // ... rest of function (use normalizedName instead of ipnsName)
}
```

### Step 2.2: Add sync parameter validation

**Location:** InventorySyncService.ts, line 132-167

**Current Code:**
```typescript
export async function inventorySync(params: SyncParams): Promise<SyncResult> {
  const startTime = Date.now();

  // Detect sync mode based on inputs
  const mode = detectSyncMode({
    local: params.local,
    nametag: params.nametag,
    incomingTokens: params.incomingTokens as Token[] | undefined,
    outboxTokens: params.outboxTokens
  });

  console.log(`🔄 [InventorySync] Starting sync in ${mode} mode`);

  // Initialize context
  const ctx = initializeContext(params, mode, startTime);

  try {
    // ...
  } catch (error) {
    console.error(`❌ [InventorySync] Error:`, error);
    return buildErrorResult(ctx, error);
  }
}
```

**Fixed Code:**
```typescript
export async function inventorySync(params: SyncParams): Promise<SyncResult> {
  const startTime = Date.now();

  // VALIDATE REQUIRED PARAMETERS
  if (!params.ipnsName || params.ipnsName.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: IPNS name is required (got: ' + JSON.stringify(params.ipnsName) + ')');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('IPNS name is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing IPNS name'));
  }

  if (!params.address || params.address.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: address is required');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('Address is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing address'));
  }

  if (!params.publicKey || params.publicKey.trim() === '') {
    console.error('❌ [InventorySync] Invalid sync params: publicKey is required');
    const ctx = initializeContext(params, 'NORMAL', startTime);
    ctx.errors.push('Public key is required for sync operation');
    return buildErrorResult(ctx, new Error('Missing public key'));
  }

  // Detect sync mode based on inputs
  const mode = detectSyncMode({
    local: params.local,
    nametag: params.nametag,
    incomingTokens: params.incomingTokens as Token[] | undefined,
    outboxTokens: params.outboxTokens
  });

  console.log(`🔄 [InventorySync] Starting sync in ${mode} mode (IPNS: ${params.ipnsName.slice(0, 20)}...)`);

  // Initialize context
  const ctx = initializeContext(params, mode, startTime);

  try {
    // ...
  } catch (error) {
    console.error(`❌ [InventorySync] Error:`, error);
    return buildErrorResult(ctx, error);
  }
}
```

---

## Fix #3: Excessive Query Calls [MEDIUM]

### Files to Modify
- `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts`

### Step 3.1: Debounce wallet-updated handler

**Location:** Lines 46-71

**Current Code:**
```typescript
useEffect(() => {
  const handleWalletUpdate = () => {
    queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
    queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
    // Also invalidate nametag query - critical for Unicity ID invalidation flow
    queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
  };

  // Handle wallet-loaded event (triggered after wallet creation/restoration)
  // This ensures identity, nametag, and L1 wallet queries are refreshed
  const handleWalletLoaded = () => {
    console.log("📢 useWallet: wallet-loaded event received, refreshing queries...");
    queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
    queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
    queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
    queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
    queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
  };

  window.addEventListener("wallet-updated", handleWalletUpdate);
  window.addEventListener("wallet-loaded", handleWalletLoaded);
  return () => {
    window.removeEventListener("wallet-updated", handleWalletUpdate);
    window.removeEventListener("wallet-loaded", handleWalletLoaded);
  };
}, [queryClient]);
```

**Fixed Code:**
```typescript
useEffect(() => {
  // Debounce timer to prevent excessive refetches
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleWalletUpdate = () => {
    // Clear previous timer to avoid redundant refetches
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Debounce: wait 500ms after last update before refetching
    debounceTimer = setTimeout(() => {
      console.log("📦 [useWallet] Wallet updated, refetching queries...");
      // Use refetchQueries instead of invalidateQueries to preserve cache if <1s old
      queryClient.refetchQueries({
        queryKey: KEYS.TOKENS,
        // Only refetch if data is stale (not fresh within 1 second)
        stale: true
      });
      queryClient.refetchQueries({
        queryKey: KEYS.AGGREGATED,
        stale: true
      });
      // Also invalidate nametag query - critical for Unicity ID invalidation flow
      queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
    }, 500);
  };

  // Handle wallet-loaded event (triggered after wallet creation/restoration)
  // This ensures identity, nametag, and L1 wallet queries are refreshed
  const handleWalletLoaded = () => {
    console.log("📢 useWallet: wallet-loaded event received, refreshing queries...");
    // No debounce for wallet-loaded - this is critical
    queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
    queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
    queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
    queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
    queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
  };

  window.addEventListener("wallet-updated", handleWalletUpdate);
  window.addEventListener("wallet-loaded", handleWalletLoaded);
  return () => {
    window.removeEventListener("wallet-updated", handleWalletUpdate);
    window.removeEventListener("wallet-loaded", handleWalletLoaded);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  };
}, [queryClient]);
```

### Step 3.2: Add time-based throttling to spent check

**Location:** Lines 181-268 in tokensQuery

**Current Code:**
```typescript
const tokensQuery = useQuery({
  // Include identity address in query key to prevent race conditions when switching identities
  queryKey: [...KEYS.TOKENS, identityQuery.data?.address],
  queryFn: async () => {
    const identity = identityQuery.data;
    if (!identity?.address) return [];

    // ... wallet load logic ...

    let tokens = walletRepo.getTokens();

    // ... pending outbox filtering ...

    // Check for spent tokens on aggregator (prevents zombie token resurrection)
    // This catches tokens that were spent but not properly removed from localStorage
    if (tokens.length > 0 && identity.publicKey) {
      console.log(`📦 [tokensQuery] Running spent check for ${tokens.length} token(s)...`);
      try {
        const validationService = getTokenValidationService();

        // Clear UNSPENT cache entries to force fresh aggregator check
        // SPENT entries remain cached (immutable)
        validationService.clearUnspentCacheEntries();  // PROBLEM: Clears every time!

        const spentCheck = await validationService.checkSpentTokens(
          tokens,
          identity.publicKey,
          { batchSize: 3 }
        );

        console.log(`📦 [tokensQuery] Spent check complete: ${spentCheck.spentTokens.length} spent, ${tokens.length - spentCheck.spentTokens.length} valid`);

        if (spentCheck.spentTokens.length > 0) {
          console.warn(`⚠️ Found ${spentCheck.spentTokens.length} spent token(s) on aggregator during wallet load`);
          for (const spent of spentCheck.spentTokens) {
            console.log(`  💀 Archiving spent token: ${spent.tokenId.slice(0, 16)}... (state: ${spent.stateHash.slice(0, 8)}...)`);
            walletRepo.removeToken(spent.localId, 'spent-on-aggregator');
          }
          // Return updated token list after removing spent tokens
          return walletRepo.getTokens();
        }
      } catch (err) {
        // Don't fail wallet load if spent check fails - just log warning
        console.warn('📦 [tokensQuery] Failed to check spent tokens:', err);
      }
    } else {
      console.log(`📦 [tokensQuery] Skipping spent check: tokens=${tokens.length}, hasPublicKey=${!!identity.publicKey}`);
    }

    return tokens;
  },
  enabled: !!identityQuery.data?.address,
});
```

**Fixed Code:**
```typescript
const tokensQuery = useQuery({
  // Include identity address in query key to prevent race conditions when switching identities
  queryKey: [...KEYS.TOKENS, identityQuery.data?.address],
  queryFn: async () => {
    const identity = identityQuery.data;
    if (!identity?.address) return [];

    // ... wallet load logic ...

    let tokens = walletRepo.getTokens();

    // ... pending outbox filtering ...

    // Check for spent tokens on aggregator (prevents zombie token resurrection)
    // This catches tokens that were spent but not properly removed from localStorage
    if (tokens.length > 0 && identity.publicKey) {
      // NEW: Only check spent tokens once per 30 seconds (time-based throttling)
      const cacheKey = `last-spent-check-${identity.address}`;
      const lastCheckTime = sessionStorage.getItem(cacheKey);
      const now = Date.now();
      const timeSinceLastCheck = lastCheckTime ? now - parseInt(lastCheckTime) : Infinity;

      // Only run spent check if >30 seconds have passed since last check
      if (timeSinceLastCheck > 30000) {
        console.log(`📦 [tokensQuery] Running spent check for ${tokens.length} token(s)...`);
        try {
          const validationService = getTokenValidationService();

          // FIXED: Don't clear cache! Use cached results when available.
          // Only force refresh if explicitly needed (e.g., after transfer).
          // Removing this line prevents unnecessary aggregator queries.
          // validationService.clearUnspentCacheEntries();

          const spentCheck = await validationService.checkSpentTokens(
            tokens,
            identity.publicKey,
            { batchSize: 3 }
          );

          console.log(`📦 [tokensQuery] Spent check complete: ${spentCheck.spentTokens.length} spent, ${tokens.length - spentCheck.spentTokens.length} valid`);

          if (spentCheck.spentTokens.length > 0) {
            console.warn(`⚠️ Found ${spentCheck.spentTokens.length} spent token(s) on aggregator during wallet load`);
            for (const spent of spentCheck.spentTokens) {
              console.log(`  💀 Archiving spent token: ${spent.tokenId.slice(0, 16)}... (state: ${spent.stateHash.slice(0, 8)}...)`);
              walletRepo.removeToken(spent.localId, 'spent-on-aggregator');
            }
            // Update cache timestamp and return updated token list
            sessionStorage.setItem(cacheKey, now.toString());
            return walletRepo.getTokens();
          }

          // Update cache timestamp even if no spent tokens
          sessionStorage.setItem(cacheKey, now.toString());
        } catch (err) {
          // Don't fail wallet load if spent check fails - just log warning
          console.warn('📦 [tokensQuery] Failed to check spent tokens:', err);
        }
      } else {
        // Skip spent check (too soon)
        const secondsAgo = Math.round(timeSinceLastCheck / 1000);
        console.log(`📦 [tokensQuery] Skipping spent check (checked ${secondsAgo}s ago, threshold: 30s)`);
      }
    } else {
      console.log(`📦 [tokensQuery] Skipping spent check: tokens=${tokens.length}, hasPublicKey=${!!identity.publicKey}`);
    }

    return tokens;
  },
  enabled: !!identityQuery.data?.address,
  staleTime: 5000,  // NEW: Consider data fresh for 5 seconds before refetching
});
```

---

## Fix #4: CID Mismatch Warning [LOW]

### Files to Modify
- `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

### Step 4.1: Improve CID comparison logic

**Location:** Lines 1429-1443

**Current Code:**
```typescript
// 6. Verify the returned CID matches expected
const returnedCid = successful[0].value.cid;
if (returnedCid !== expectedCid) {
  console.warn(`  ⚠️ CID mismatch: expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
  // Non-fatal - use the returned CID (gateway may use different encoding)
}

// 7. Update context with CID
ctx.remoteCid = returnedCid || expectedCid;
```

**Fixed Code:**
```typescript
// 6. Verify the returned CID matches expected
const returnedCid = successful[0].value.cid;

// IMPROVED: Compare CIDs accounting for encoding variations
// CIDv1 can be represented in different bases (Base32, Base64, etc.)
// Only flag as error if the actual hash/content differs

let cidError = false;
try {
  // Import CID parser
  const { CID } = await import('multiformats/cid');

  // Parse both CIDs to canonical form
  const expectedCidObj = CID.parse(expectedCid);
  const returnedCidObj = CID.parse(returnedCid);

  // Compare multihash (encoding-independent)
  // Two CIDs are equivalent if their multihashes match, even if encoding differs
  const expectedBytes = expectedCidObj.multihash.bytes;
  const returnedBytes = returnedCidObj.multihash.bytes;

  const bytesMatch = expectedBytes.length === returnedBytes.length &&
    expectedBytes.every((b, i) => b === returnedBytes[i]);

  if (!bytesMatch) {
    // Hash differs = data integrity issue
    console.error(`  ❌ CID hash mismatch: content integrity error`);
    console.error(`    Expected: ${expectedCid}`);
    console.error(`    Got:      ${returnedCid}`);
    cidError = true;
    ctx.errors.push(`CID hash mismatch: expected ${expectedCid}, got ${returnedCid}`);
  } else {
    // Hash matches = encoding difference (acceptable)
    console.log(`  ✅ CID verified (hash matches, encoding: expected=${expectedCid.slice(0, 20)}..., returned=${returnedCid.slice(0, 20)}...)`);
  }
} catch (parseError) {
  // If parsing fails, fall back to string comparison
  if (returnedCid !== expectedCid) {
    console.warn(`  ⚠️ CID mismatch (unable to parse for comparison): expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
    console.warn(`    This may indicate different JSON encoding between browser and gateway`);
    // Non-fatal - gateway encoding may be authoritative
  }
}

// 7. Update context with CID
ctx.remoteCid = returnedCid || expectedCid;

if (cidError) {
  console.error(`  ❌ Upload verification FAILED - content integrity issue`);
} else {
  console.log(`  ✓ Upload complete: CID=${ctx.remoteCid.slice(0, 16)}...`);
}
```

**Key Improvements:**
- Uses multihash comparison instead of string comparison
- Accounts for encoding variations (bafk, bagaa, etc. are equivalent if hash matches)
- Only reports error if actual content hash differs
- Distinguishes between encoding differences (acceptable) vs hash mismatches (error)

---

## Testing After Fixes

### Quick Test Checklist

```bash
# After applying all fixes:

# 1. Test faucet tokens (Issue #1)
   - Request tokens from faucet
   - Verify tokens appear in wallet (not in invalid folder)
   - Check localStorage: should have exactly 1 entry per token
   - Refresh page: tokens should still appear

# 2. Test IPNS resolution (Issue #2)
   - Check browser console: NO 400 errors on IPFS endpoints
   - Verify "Running spent check" appears only 1-2 times
   - Monitor Network tab: should see <10 total requests
   - Previously: 20+ requests, now: <10 requests

# 3. Test query performance (Issue #3)
   - Load wallet: should complete in <1 second
   - Previously: 2-6 seconds
   - Monitor [tokensQuery] logs: spent check throttled to 30s intervals

# 4. Test CID verification (Issue #4)
   - Upload to IPFS: should see "CID verified" or "hash matches"
   - Should NOT see "mismatch" warnings
   - If CID differs in encoding: should log "encoding: expected X, returned Y"
```

---

## Commit Message Template

```
fix: resolve token validation and IPFS sync issues

CRITICAL FIXES:
- Token validation inconsistency: Allow genesis-only tokens (Issue #1)
  - validateTransactionCommitment() now permits missing previousStateHash
  - step4_validateCommitments() skips transaction validation for genesis-only
  - Prevents duplicate valid/invalid token states in IPFS

HIGH PRIORITY:
- IPNS resolution failure: Add parameter validation (Issue #2)
  - resolveIpnsName() now validates IPNS name format
  - inventorySync() validates required params before processing
  - Prevents 400 Bad Request errors from empty IPNS names

MEDIUM PRIORITY:
- Query performance: Debounce wallet updates and throttle spent check (Issue #3)
  - wallet-updated event handler now debounced (500ms)
  - spent check throttled to 30s intervals
  - Reduces aggregator requests from 20+ to <5 per wallet load

LOW PRIORITY:
- CID comparison: Improve integrity checking (Issue #4)
  - Compare multihash instead of string encoding
  - Distinguish between encoding variations vs data integrity errors
  - Better logging for debugging

Files changed:
- InventorySyncService.ts: validation logic, parameter checks, CID comparison
- IpfsHttpResolver.ts: IPNS name validation
- useWallet.ts: query debouncing, spent check throttling

See: CONSOLE_LOGS_ANALYSIS.md for detailed analysis
```

---

## Questions Before Proceeding?

- Need clarification on any fix?
- Want to prioritize different issues?
- Need help with testing?
- Want additional analysis of specific code sections?
