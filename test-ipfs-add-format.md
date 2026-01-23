# IPFS /api/v0/add Format Issue

## Problem

When content is added to IPFS via `/api/v0/add`, IPFS treats the uploaded file as **raw bytes** and stores it with the `raw` codec (0x55), not the `json` codec (0x0200) or `dag-json` codec (0x0129).

## What happens:

1. **Upload to IPFS** (IpfsPublisher.ts line 97-100):
   ```typescript
   const blob = new Blob([JSON.stringify(content)], {
     type: "application/json",
   });
   ```
   - Creates a JSON string: `{"tokens":[],"meta":{"version":1},"tombstones":[]}`
   - IPFS stores this as RAW BYTES with the **raw codec**
   - Returns a CID like: `bafkreixxx...` (CIDv1 with raw codec 0x55)

2. **Fetch from IPFS** (IpfsHttpResolver.ts line 172-184):
   ```typescript
   const response = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
     headers: { Accept: "application/json" }
   });
   const content = await response.json();
   ```
   - Gateway returns the raw bytes
   - `JSON.parse()` parses the string
   - **Key order is NOT guaranteed** - JavaScript objects don't preserve insertion order in all cases
   - Could become: `{"meta":{"version":1},"tombstones":[],"tokens":[]}`

3. **CID Verification** (IpfsHttpResolver.ts line 417):
   ```typescript
   const computedCid = await computeCidFromContent(result);
   ```
   - Uses `multiformats/codecs/json` (plain `JSON.stringify`)
   - Encodes with **whatever key order** the parsed object has
   - Computes CID with **json codec 0x0200**
   - **MISMATCH**: Different codec (0x0200 vs 0x55) AND different key ordering!

## Root Causes

1. **Codec mismatch**: Content stored with `raw` codec (0x55), verified with `json` codec (0x0200)
2. **Non-deterministic encoding**: `JSON.stringify` doesn't guarantee key order
3. **Wrong assumption**: Code assumes IPFS stores JSON with json codec, but it stores as raw bytes

## Solutions

### Option 1: Use dag-json codec for storage
Modify IpfsPublisher to use `/api/v0/dag/put` instead of `/api/v0/add`:

```typescript
// Use dag-json codec which provides deterministic encoding
const response = await fetch(`${gatewayUrl}/api/v0/dag/put?store-codec=dag-json&input-codec=json`, {
  method: 'POST',
  body: formData,
});
```

This ensures:
- Content is stored with dag-json codec (0x0129)
- Key ordering is deterministic (sorted)
- CID is computed from canonical representation

### Option 2: Store CID with content
Don't verify CID, just trust the CID returned by IPFS on upload:

```typescript
// In IpfsPublisher, store the CID in the content itself
const contentWithCid = { ...content, _cid: returnedCid };
```

### Option 3: Use raw codec for verification
Change `computeCidFromContent` to match how IPFS stores the content:

```typescript
import { raw } from 'multiformats/codecs/raw';

export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  // Encode as raw bytes (same as IPFS does)
  const jsonString = JSON.stringify(content);
  const bytes = new TextEncoder().encode(jsonString);
  const hash = await sha256.digest(bytes);
  const computedCid = CID.createV1(raw.code, hash); // Use raw codec 0x55
  return computedCid.toString();
}
```

But this still has the key ordering issue!

### Option 4 (RECOMMENDED): Use dag-json everywhere
1. Store with dag-json codec
2. Fetch with dag-json codec
3. Verify with dag-json codec

This is the proper IPFS way to handle JSON data.
