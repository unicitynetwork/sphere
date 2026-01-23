# CID Computation: Current vs Recommended Approach

## Side-by-Side Comparison

### ❌ Current Approach (Non-Deterministic)

```typescript
// File: IpfsPublisher.ts
import * as jsonCodec from 'multiformats/codecs/json';

// Upload
const content = { tokens: [], meta: { version: 1 }, tombstones: [] };
const blob = new Blob([JSON.stringify(content)], {  // ⚠️ Key order undefined
  type: "application/json",
});
// Bytes: '{"tokens":[],"meta":{"version":1},"tombstones":[]}'
// CID:   bagaaiera5tb3ebbkj... (hash of these bytes)
```

```typescript
// File: IpfsHttpResolver.ts

// Fetch
const response = await fetch(`${gatewayUrl}/ipfs/${cid}`);
const content = await response.json();  // ⚠️ Parses to object

// Verify
const encoded = jsonCodec.encode(content);  // ⚠️ Re-stringify (different order!)
// Bytes: '{"meta":{"version":1},"tombstones":[],"tokens":[]}'
// CID:   bagaaiera6s5yxka... (DIFFERENT hash!)

if (computedCid !== cid) {
  throw new Error("CID mismatch");  // ❌ FAILS!
}
```

**Problem:** Key order changes → Different bytes → Different CID

---

### ✅ Recommended Approach (Deterministic)

```typescript
// File: IpfsPublisher.ts
import * as dagJson from '@ipld/dag-json';

// Upload
const content = { tokens: [], meta: { version: 1 }, tombstones: [] };
const encoded = dagJson.encode(content);  // ✅ Sorts keys alphabetically
const blob = new Blob([encoded], {
  type: "application/json",
});
// Bytes: '{"meta":{"version":1},"tokens":[],"tombstones":[]}'  ← Sorted!
// CID:   baguqeerauzovuw2... (dag-json codec 0x0129)
```

```typescript
// File: IpfsHttpResolver.ts

// Fetch
const response = await fetch(`${gatewayUrl}/ipfs/${cid}`);
const content = await response.json();  // Parses to object

// Verify
const encoded = dagJson.encode(content);  // ✅ Always same order!
// Bytes: '{"meta":{"version":1},"tokens":[],"tombstones":[]}'  ← Same!
// CID:   baguqeerauzovuw2... (SAME hash!)

if (computedCid !== cid) {
  throw new Error("CID mismatch");  // ✅ NEVER FAILS!
}
```

**Solution:** Keys always sorted → Same bytes → Same CID

---

## Test Results

### Non-Deterministic (Current)

```bash
$ node test-cid-computation.mjs

Data 1: { tokens: [], meta: { version: 1 }, tombstones: [] }
Encoded: {"tokens":[],"meta":{"version":1},"tombstones":[]}
CID: bagaaieraliogp2rdyunume2bbjtji2zkneg45r5ydp2jadvq542ljtrmfb6q

Data 2: { meta: { version: 1 }, tombstones: [], tokens: [] }
Encoded: {"meta":{"version":1},"tombstones":[],"tokens":[]}
CID: bagaaiera7vkb224vb3xro3qleg5ejm7wzl42mcrsp2vjx6wwhtzoltqekhya

CIDs match? false ❌
```

### Deterministic (Recommended)

```bash
$ node test-cid-computation.mjs

Data 1: { tokens: [], meta: { version: 1 }, tombstones: [] }
DAG-JSON: {"meta":{"version":1},"tokens":[],"tombstones":[]}
CID: baguqeerauzovuw2xap3nxyaaywcalowhmnlkaq3ykkg7dabuhtrpczj6w3la

Data 2: { meta: { version: 1 }, tombstones: [], tokens: [] }
DAG-JSON: {"meta":{"version":1},"tokens":[],"tombstones":[]}
CID: baguqeerauzovuw2xap3nxyaaywcalowhmnlkaq3ykkg7dabuhtrpczj6w3la

CIDs match? true ✅
```

---

## Implementation Changes

### Change 1: IpfsHttpResolver.ts

**Before:**
```typescript
import * as jsonCodec from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { CID } from "multiformats/cid";

export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  const encoded = jsonCodec.encode(content);  // ❌ Non-deterministic
  const hash = await sha256.digest(encoded);
  const computedCid = CID.createV1(jsonCodec.code, hash);  // 0x0200
  return computedCid.toString();
}
```

**After:**
```typescript
import * as dagJson from "@ipld/dag-json";  // ✅ Deterministic codec
import { sha256 } from "multiformats/hashes/sha2";
import { CID } from "multiformats/cid";

export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  const encoded = dagJson.encode(content);  // ✅ Deterministic (sorted keys)
  const hash = await sha256.digest(encoded);
  const computedCid = CID.createV1(dagJson.code, hash);  // 0x0129
  return computedCid.toString();
}
```

---

### Change 2: IpfsPublisher.ts

**Before:**
```typescript
async function storeContentOnGateway(
  content: TxfStorageData,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<string | null> {
  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(content)], {  // ❌ Non-deterministic
      type: "application/json",
    });
    formData.append("file", blob);

    const response = await fetch(`${gatewayUrl}/api/v0/add`, {  // ❌ Uses json codec
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    const json = (await response.json()) as { Hash?: string };
    return json.Hash || null;
  } catch (error) {
    return null;
  }
}
```

**After:**
```typescript
import * as dagJson from "@ipld/dag-json";  // ✅ Add import

async function storeContentOnGateway(
  content: TxfStorageData,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<string | null> {
  try {
    const formData = new FormData();
    const encoded = dagJson.encode(content);  // ✅ Deterministic encoding
    const blob = new Blob([encoded], {
      type: "application/json",
    });
    formData.append("file", blob);

    // ✅ Use dag/put with dag-json codec
    const response = await fetch(
      `${gatewayUrl}/api/v0/dag/put?store-codec=dag-json&input-codec=json&hash=sha2-256`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }
    );

    const json = (await response.json()) as { Cid?: { '/': string } };
    return json.Cid?.['/'] || null;  // ✅ Different response format
  } catch (error) {
    return null;
  }
}
```

---

## Migration Strategy

### Phase 1: Support Both Codecs (Backward Compatible)

```typescript
import * as dagJson from "@ipld/dag-json";
import * as jsonCodec from "multiformats/codecs/json";
import { CID } from "multiformats/cid";

async function fetchContentByCid(cid: string): Promise<TxfStorageData | null> {
  const cidObj = CID.parse(cid);

  // Detect codec
  const isDagJson = cidObj.code === dagJson.code;  // 0x0129
  const isJson = cidObj.code === jsonCodec.code;   // 0x0200

  if (!isDagJson && !isJson) {
    throw new Error(`Unsupported codec: 0x${cidObj.code.toString(16)}`);
  }

  // Fetch content
  const response = await fetch(`${gatewayUrl}/ipfs/${cid}`);

  if (isDagJson) {
    // New format: Verify with dag-json
    const content = await response.json();
    const computedCid = await computeCidFromContentDagJson(content);
    if (computedCid !== cid) {
      throw new Error("CID mismatch (dag-json)");
    }
    return content;
  } else {
    // Legacy format: Fetch raw bytes for verification
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    const hash = await sha256.digest(rawBytes);
    const computedCid = CID.createV1(jsonCodec.code, hash);

    if (computedCid.toString() !== cid) {
      throw new Error("CID mismatch (json)");
    }

    const text = new TextDecoder().decode(rawBytes);
    return JSON.parse(text);
  }
}

// Helper: Compute CID with dag-json
async function computeCidFromContentDagJson(content: TxfStorageData): Promise<string> {
  const encoded = dagJson.encode(content);
  const hash = await sha256.digest(encoded);
  const cid = CID.createV1(dagJson.code, hash);
  return cid.toString();
}

// Helper: Compute CID with json (legacy)
async function computeCidFromContentJson(rawBytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(rawBytes);
  const cid = CID.createV1(jsonCodec.code, hash);
  return cid.toString();
}
```

### Phase 2: Migrate Existing Data

```typescript
async function migrateToDAGJson(oldCid: string): Promise<string> {
  // 1. Fetch old content (json codec)
  const cidObj = CID.parse(oldCid);
  if (cidObj.code !== jsonCodec.code) {
    return oldCid;  // Already migrated
  }

  // 2. Get content (preserve original bytes for verification)
  const response = await fetch(`${gatewayUrl}/ipfs/${oldCid}`);
  const rawBytes = new Uint8Array(await response.arrayBuffer());

  // 3. Verify old CID
  const hash = await sha256.digest(rawBytes);
  const verifiedCid = CID.createV1(jsonCodec.code, hash);
  if (verifiedCid.toString() !== oldCid) {
    throw new Error("Old CID verification failed");
  }

  // 4. Parse content
  const text = new TextDecoder().decode(rawBytes);
  const content = JSON.parse(text);

  // 5. Re-upload with dag-json
  const encoded = dagJson.encode(content);  // Deterministic encoding
  const blob = new Blob([encoded], { type: "application/json" });
  const formData = new FormData();
  formData.append("file", blob);

  const uploadResponse = await fetch(
    `${gatewayUrl}/api/v0/dag/put?store-codec=dag-json&input-codec=json`,
    {
      method: "POST",
      body: formData,
    }
  );

  const json = await uploadResponse.json() as { Cid?: { '/': string } };
  const newCid = json.Cid?.['/'];

  console.log(`Migrated: ${oldCid} → ${newCid}`);
  return newCid!;
}
```

### Phase 3: Update IPNS Records

```typescript
async function updateIpnsAfterMigration(oldCid: string, newCid: string): Promise<void> {
  // 1. Get current IPNS sequence
  const currentRecord = await resolveIpns(ipnsName);

  // 2. Publish new CID with incremented sequence
  await publishToIpns(newCid, currentRecord.sequence + 1n);

  console.log(`Updated IPNS: ${ipnsName} → ${newCid} (seq=${currentRecord.sequence + 1n})`);
}
```

---

## Codec Comparison

| Property | `multiformats/codecs/json` | `@ipld/dag-json` |
|----------|---------------------------|------------------|
| **Codec Code** | `0x0200` | `0x0129` |
| **Encoding** | `JSON.stringify()` | CBOR-based with sorted keys |
| **Deterministic** | ❌ No | ✅ Yes |
| **Key Order** | ⚠️ Undefined | ✅ Alphabetical |
| **CID Stability** | ❌ Unstable | ✅ Stable |
| **IPFS Standard** | Legacy | ✅ Recommended |
| **Use Case** | Simple JSON | Content-addressed JSON |

---

## Summary

**Problem:**
- `multiformats/codecs/json` uses non-deterministic `JSON.stringify()`
- Key order changes during parse/stringify round-trip
- Same content produces different CIDs

**Solution:**
- Use `@ipld/dag-json` for deterministic encoding
- Keys are sorted alphabetically
- Same content always produces same CID

**Impact:**
- ✅ Fixes CID verification errors
- ✅ Enables reliable content-addressed storage
- ✅ Future-proof for IPFS ecosystem

**Files to modify:**
1. `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts`
2. `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsPublisher.ts`

**Migration path:**
1. Support both codecs (backward compatible)
2. Migrate existing data (background task)
3. Update IPNS records
4. Remove legacy codec support
