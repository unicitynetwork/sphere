# CID Mismatch Investigation Summary

## The Problem

When fetching content from IPFS by CID, the gateway returns content that computes to a **different CID** than requested:

- **Expected CID**: `bagaaiera5tb3ebbkjhkyfjlu2ipdkpnrpyw3vg4upu4hw4d2miosv6oluetq`
- **Computed CID from response**: `bagaaiera6s5yxkajmw22t6ikooheqxmsywqedghqyypv7cgsrizz2w43vcxq`
- **Error location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts:419`

## Root Cause Analysis

### CID Decoding
Both CIDs use:
- **Version**: CIDv1
- **Codec**: 0x0200 (json codec from `multiformats/codecs/json`)
- **Hash**: SHA-256 (0x12)

The codec is the same, so the issue is **content differences**.

### Content Flow

1. **Storage** (`IpfsPublisher.ts` line 97-102):
   ```typescript
   const blob = new Blob([JSON.stringify(content)], {
     type: "application/json",
   });
   const response = await fetch(`${gatewayUrl}/api/v0/add`, {
     method: "POST",
     body: formData,
   });
   ```
   - Uses plain `JSON.stringify()` which **does NOT guarantee key order**
   - Content might be: `{"tokens":[],"meta":{"version":1},"tombstones":[]}`

2. **Retrieval** (`IpfsHttpResolver.ts` line 172-184):
   ```typescript
   const response = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
     headers: { Accept: "application/json" }
   });
   const content = await response.json();
   ```
   - Gateway returns the JSON bytes
   - `JSON.parse()` parses into a JavaScript object
   - **Object key order may differ** from the stringified version!
   - Content might become: `{"meta":{"version":1},"tombstones":[],"tokens":[]}`

3. **Verification** (`IpfsHttpResolver.ts` line 417):
   ```typescript
   const computedCid = await computeCidFromContent(result);
   ```
   - Uses `multiformats/codecs/json` which calls `JSON.stringify()`
   - **Different key order = Different bytes = Different hash = Different CID!**

### The JSON.stringify Problem

JavaScript's `JSON.stringify()` **is NOT deterministic**:

```javascript
// Test case:
const obj1 = { tokens: [], meta: { version: 1 }, tombstones: [] };
const obj2 = { meta: { version: 1 }, tombstones: [], tokens: [] };

JSON.stringify(obj1);
// => '{"tokens":[],"meta":{"version":1},"tombstones":[]}'

JSON.stringify(obj2);
// => '{"meta":{"version":1},"tombstones":[],"tokens":[]}'

// Same semantic content, DIFFERENT strings!
// Result: Different CIDs!
```

When content is:
1. Uploaded with one key order
2. Fetched and parsed (which may reorder keys)
3. Re-stringified for CID computation

The CID will mismatch if the key order changed!

## Why This Happens in IPFS

The IPFS `/api/v0/add` endpoint:
- Accepts raw file uploads
- When you upload JSON via FormData, it treats it as **opaque bytes**
- The codec in the CID depends on server configuration or defaults
- The backend appears to use json codec (0x0200) for JSON content-type
- But the encoding is **whatever bytes you sent**, preserving the original key order

When you fetch later:
- Gateway returns those exact bytes
- Your code does `JSON.parse()` which creates a JS object
- **JS object property order is implementation-dependent!**
- Re-encoding with `JSON.stringify()` may produce different bytes

## Solutions

### Solution 1: Use DAG-JSON Codec (RECOMMENDED)

Use IPFS's DAG-JSON codec which provides **deterministic, canonical JSON encoding**:

**A. Change storage** (`IpfsPublisher.ts`):
```typescript
// Instead of /api/v0/add, use /api/v0/dag/put
const response = await fetch(
  `${gatewayUrl}/api/v0/dag/put?store-codec=dag-json&input-codec=json`,
  {
    method: 'POST',
    body: formData,
  }
);
```

**B. Change CID computation** (`IpfsHttpResolver.ts`):
```typescript
import * as dagJson from '@ipld/dag-json';

export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  // Use DAG-JSON codec (deterministic encoding with sorted keys)
  const encoded = dagJson.encode(content);
  const hash = await sha256.digest(encoded);
  const computedCid = CID.createV1(dagJson.code, hash);  // codec 0x0129
  return computedCid.toString();
}
```

**Benefits**:
- Deterministic encoding (keys are sorted alphabetically)
- Proper IPFS content-addressed storage
- No key order issues
- CIDs will always match

### Solution 2: Don't Verify CID

The simplest fix - remove CID verification:

```typescript
// In IpfsHttpResolver.ts, line 413-421:
// Just return the content without verification
const content = await Promise.any(promises);
this.cache.setContent(cid, content);
return content;
```

**Benefits**:
- Quick fix
- Avoids the problem entirely

**Drawbacks**:
- Loses integrity checking
- Could accept corrupted data

### Solution 3: Store CID in Content

Include the CID as metadata within the content itself:

```typescript
// In IpfsPublisher.ts, after getting CID from /api/v0/add:
const contentWithCid = { ...tokenData, _cid: cid };
// Re-upload with CID embedded, or store mapping separately
```

### Solution 4: Normalize Before Comparison

Sort keys before stringification:

```typescript
function normalizeJson(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(normalizeJson);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeJson(obj[key]);
        return result;
      }, {} as any);
  }
  return obj;
}

export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  const normalized = normalizeJson(content);
  const encoded = jsonCodec.encode(normalized);
  const hash = await sha256.digest(encoded);
  const computedCid = CID.createV1(jsonCodec.code, hash);
  return computedCid.toString();
}
```

**Drawbacks**:
- Still won't match the original CID if keys were in different order on upload
- Partial solution

## Recommendation

**Use Solution 1** (DAG-JSON codec) because:
1. It's the proper IPFS way to store JSON
2. Provides content integrity guarantees
3. Deterministic encoding prevents these issues
4. Already available in dependencies (`@ipld/dag-json`)
5. Future-proof solution

The fix requires changes in:
- `IpfsPublisher.ts`: Use `/api/v0/dag/put` instead of `/api/v0/add`
- `IpfsHttpResolver.ts`: Use `dagJson.encode()` instead of `jsonCodec.encode()`
- Consider migrating existing data or supporting both codecs during transition
