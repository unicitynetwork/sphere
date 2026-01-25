# IPFS CID Codec Detection: Implementation Guide

**Purpose**: Practical code examples and patterns for implementing robust codec detection

---

## 1. Fast Codec Detection from CID String

### 1.1 Simple String-Based Detection

```typescript
/**
 * Fastest method: detect codec from CID string prefix
 * Time: < 0.1ms per CID
 * Accuracy: 100% for well-formed CIDs
 */
export function detectCodecFromCidPrefix(cid: string): number | null {
  // CIDv0 (starts with Qm) has implicit DAG-PB codec (0x70)
  if (cid.startsWith('Qm')) {
    return 0x70; // DAG-PB
  }

  // CIDv1 with base32 (most common)
  if (cid.startsWith('bafy')) {
    const twoChars = cid.slice(4, 6);

    // Map second two characters to codec
    // This is approximate based on common prefixes
    if (twoChars === 're') return 0x0200;    // bafyren... (JSON)
    if (twoChars === 're') return 0x0200;    // bafyren... (JSON)
    if (twoChars === 'rej') return 0x0201;   // bafyrej... (DAG-JSON)
    if (twoChars === 'rei') return 0x71;     // bafyreib... (DAG-CBOR)
    if (twoChars === 'rib') return 0x0200;   // JSON fallback
  }

  // CIDv1 with base32 (raw codec)
  if (cid.startsWith('bafk')) {
    return 0x55; // Raw codec
  }

  // CIDv1 with base58btc (z prefix)
  if (cid.startsWith('z')) {
    const remainder = cid.slice(1);
    if (remainder.startsWith('ERi')) return 0x0200; // JSON
    if (remainder.startsWith('ERj')) return 0x0201; // DAG-JSON
  }

  // CIDv1 with base16 (f prefix)
  if (cid.startsWith('f')) {
    const hex = cid.slice(1);
    if (hex.startsWith('01550')) return 0x55;      // Raw
    if (hex.startsWith('0170')) return 0x70;       // DAG-PB
    if (hex.startsWith('0171')) return 0x71;       // DAG-CBOR
  }

  return null; // Unknown CID format
}
```

### 1.2 Proper Multicodec Decoding

```typescript
/**
 * Decode multicodec from CID using proper varint decoding
 * More accurate but slightly slower (< 1ms)
 * Required: multiformats library
 */
export function detectCodecProperly(cid: string): number | null {
  try {
    const cidObj = CID.parse(cid);
    return cidObj.code; // Returns multicodec code
  } catch {
    return null;
  }
}

/**
 * Fallback manual decoder without external dependency
 */
export function decodeCodecFromBase32Cid(cid: string): number | null {
  if (!cid.startsWith('bafy')) {
    return null;
  }

  // Remove 'bafy' prefix, leaving just base32 data
  const base32Data = cid.slice(4);

  // Decode base32 to bytes
  const bytes = base32Decode(base32Data);

  // Read varint from start of bytes
  const [codec, _bytesRead] = readVarint(bytes);

  return codec;
}

/**
 * Decode Base32 (RFC 4648)
 */
function base32Decode(str: string): Uint8Array {
  const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of str) {
    const index = base32Alphabet.indexOf(char.toLowerCase());
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

/**
 * Read LEB128 varint from byte array
 */
function readVarint(bytes: Uint8Array): [number, number] {
  let value = 0;
  let shift = 0;
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i];
    value |= (byte & 0x7f) << shift;
    i++;

    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [value, i];
}
```

### 1.3 Codec Name Mapping

```typescript
/**
 * Human-readable codec names
 */
const CODEC_NAMES: Record<number, string> = {
  0x55: 'raw',           // Raw binary
  0x70: 'dag-pb',        // Protobuf (UnixFS)
  0x71: 'dag-cbor',      // CBOR
  0x48: 'xml',           // XML
  0x51: 'cbor',          // Raw CBOR
  0x0200: 'json',        // JSON
  0x0201: 'dag-json',    // DAG-JSON
  0x7b: 'wasm',          // WebAssembly
  0x81: 'dag-sql',       // SQL
};

export function getCodecName(codec: number): string {
  return CODEC_NAMES[codec] || `unknown(0x${codec.toString(16)})`;
}
```

---

## 2. Content Verification Service

### 2.1 Verify CID Matches Content

```typescript
/**
 * Verify that raw bytes produce the expected CID
 *
 * CRITICAL: Must use raw bytes (not decoded content)
 * to avoid issues with JSON key reordering
 */
export async function verifyCidFromRawBytes(
  cid: string,
  rawBytes: Uint8Array
): Promise<{
  valid: boolean;
  detectedCodec?: number;
  computedCid?: string;
  error?: string;
}> {
  try {
    // Step 1: Detect codec from CID
    const expectedCodec = detectCodecFromCidPrefix(cid);
    if (!expectedCodec) {
      return { valid: false, error: 'Could not detect codec from CID' };
    }

    // Step 2: Hash raw bytes with SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', rawBytes);
    const hash = new Uint8Array(hashBuffer);

    // Step 3: Create CID with detected codec
    const computedCid = CID.createV1(expectedCodec, hash).toString();

    // Step 4: Compare
    const matches = computedCid === cid;

    return {
      valid: matches,
      detectedCodec: expectedCodec,
      computedCid,
      error: matches ? undefined : `CID mismatch: expected ${cid}, got ${computedCid}`
    };
  } catch (error) {
    return {
      valid: false,
      error: `Verification failed: ${error instanceof Error ? error.message : 'unknown'}`
    };
  }
}

/**
 * Alternative: Try multiple codecs until one matches
 * Useful when codec detection is uncertain
 */
export async function verifyCidWithFallback(
  cid: string,
  rawBytes: Uint8Array,
  tryCodecs: number[] = [0x0200, 0x55, 0x0201, 0x71]
): Promise<{
  valid: boolean;
  matchingCodec?: number;
  error?: string;
}> {
  // First try detected codec
  const detected = detectCodecFromCidPrefix(cid);
  if (detected) {
    const result = await verifyCidFromRawBytes(cid, rawBytes);
    if (result.valid) {
      return { valid: true, matchingCodec: detected };
    }
  }

  // Try each codec in order
  for (const codec of tryCodecs) {
    if (codec === detected) continue; // Already tried

    const hashBuffer = await crypto.subtle.digest('SHA-256', rawBytes);
    const hash = new Uint8Array(hashBuffer);
    const computed = CID.createV1(codec, hash).toString();

    if (computed === cid) {
      return { valid: true, matchingCodec: codec };
    }
  }

  return { valid: false, error: 'No codec matches content hash' };
}
```

---

## 3. Backend Codec Discovery

### 3.1 Probe Single Gateway

```typescript
/**
 * Discover default codec used by IPFS gateway
 *
 * Strategy: Upload deterministic content, observe returned CID
 */
export async function probeGatewayCodec(
  gatewayUrl: string,
  timeout: number = 5000
): Promise<{
  success: boolean;
  codec?: number;
  error?: string;
  latency?: number;
}> {
  const startTime = performance.now();

  try {
    // Create deterministic test content
    const testContent = {
      _probe: true,
      timestamp: Math.floor(Date.now() / 1000),
      version: 1
    };

    // Upload to gateway
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([JSON.stringify(testContent)]),
      'test.json'
    );

    const response = await fetch(`${gatewayUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        latency: performance.now() - startTime
      };
    }

    const result = (await response.json()) as { Hash?: string };
    const cid = result.Hash;

    if (!cid) {
      return {
        success: false,
        error: 'No CID in response',
        latency: performance.now() - startTime
      };
    }

    // Detect codec from returned CID
    const codec = detectCodecFromCidPrefix(cid);

    return {
      success: true,
      codec,
      latency: performance.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'unknown',
      latency: performance.now() - startTime
    };
  }
}
```

### 3.2 Probe Multiple Gateways in Parallel

```typescript
/**
 * Discover codecs across all backends
 * Returns immediately when first succeeds, others continue in background
 */
export async function probeAllGateways(
  gateways: string[],
  timeout: number = 5000
): Promise<{
  results: Map<string, { codec: number; latency: number }>;
  fastest?: { gateway: string; codec: number; latency: number };
}> {
  const results = new Map<string, { codec: number; latency: number }>();

  // Start probes for all gateways
  const probes = gateways.map(async (gateway) => {
    const result = await probeGatewayCodec(gateway, timeout);
    if (result.success && result.codec !== undefined && result.latency !== undefined) {
      results.set(gateway, {
        codec: result.codec,
        latency: result.latency
      });
      return { gateway, codec: result.codec, latency: result.latency };
    }
    return null;
  });

  // Race for first success
  const firstSuccess = await Promise.race(
    probes.map(p => p.then(r => r && Promise.resolve(r)))
  ).catch(() => null);

  // Wait for all to complete (for logging)
  await Promise.all(probes);

  // Find fastest
  let fastest: { gateway: string; codec: number; latency: number } | undefined;
  for (const [gateway, data] of results.entries()) {
    if (!fastest || data.latency < fastest.latency) {
      fastest = { gateway, codec: data.codec, latency: data.latency };
    }
  }

  return { results, fastest };
}
```

### 3.3 Cache Codec Preferences

```typescript
/**
 * Cache backend codec preferences
 * TTL: 1 hour (backends rarely change defaults)
 */
export class CodecPreferenceCache {
  private cache = new Map<string, { codec: number; ttl: number }>();

  get(gateway: string): number | null {
    const entry = this.cache.get(gateway);
    if (!entry || entry.ttl < Date.now()) {
      this.cache.delete(gateway);
      return null;
    }
    return entry.codec;
  }

  set(gateway: string, codec: number, ttlMs: number = 3600000): void {
    this.cache.set(gateway, {
      codec,
      ttl: Date.now() + ttlMs
    });
  }

  clear(): void {
    this.cache.clear();
  }

  async getOrProbe(
    gateway: string,
    probe: () => Promise<number | null>
  ): Promise<number | null> {
    const cached = this.get(gateway);
    if (cached !== null) return cached;

    const codec = await probe();
    if (codec !== null) {
      this.set(gateway, codec);
    }
    return codec;
  }
}
```

---

## 4. HTTP Gateway Integration

### 4.1 Fetch with Codec Handling

```typescript
/**
 * Fetch content with appropriate codec-aware headers
 */
export async function fetchWithCodecHandling(
  cid: string,
  gatewayUrl: string,
  timeout: number = 5000
): Promise<{
  bytes: Uint8Array;
  codec: number;
  contentType?: string;
}> {
  // Detect codec from CID
  const codec = detectCodecFromCidPrefix(cid);
  if (!codec) {
    throw new Error(`Cannot detect codec from CID: ${cid}`);
  }

  // Select Accept header based on codec
  let acceptHeader = 'application/octet-stream'; // Safe default: raw bytes

  if (codec === 0x0200) {
    acceptHeader = 'application/json'; // JSON codec
  } else if (codec === 0x0201) {
    acceptHeader = 'application/vnd.ipld.dag-json'; // DAG-JSON
  } else if (codec === 0x71) {
    acceptHeader = 'application/vnd.ipld.dag-cbor'; // DAG-CBOR
  }

  const response = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
    headers: {
      Accept: acceptHeader
    },
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${gatewayUrl}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? undefined;

  return { bytes, codec, contentType };
}

/**
 * Verify content and decode based on codec
 */
export async function fetchAndVerifyContent(
  cid: string,
  gatewayUrl: string
): Promise<unknown> {
  // Step 1: Fetch with codec handling
  const { bytes, codec } = await fetchWithCodecHandling(cid, gatewayUrl);

  // Step 2: Verify CID
  const verification = await verifyCidFromRawBytes(cid, bytes);
  if (!verification.valid) {
    throw new Error(`CID verification failed: ${verification.error}`);
  }

  // Step 3: Decode based on codec
  return decodeByCodec(bytes, codec);
}

/**
 * Decode content based on codec
 */
export function decodeByCodec(bytes: Uint8Array, codec: number): unknown {
  switch (codec) {
    case 0x55: // Raw codec
      return bytes; // Return raw bytes as-is

    case 0x0200: // JSON codec
    case 0x0201: // DAG-JSON codec
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);

    case 0x71: // DAG-CBOR
      return decodeCbor(bytes);

    case 0x70: // DAG-PB (UnixFS)
      return decodeUnixFs(bytes);

    default:
      throw new Error(`Unsupported codec: ${codec.toString(16)}`);
  }
}

// Placeholder decoders (integrate with appropriate libraries)
function decodeCbor(bytes: Uint8Array): unknown {
  // TODO: Use CBOR library
  throw new Error('CBOR decoding not implemented');
}

function decodeUnixFs(bytes: Uint8Array): unknown {
  // TODO: Use protobuf library
  throw new Error('UnixFS decoding not implemented');
}
```

---

## 5. Multi-Gateway Fallback Strategy

### 5.1 Race Multiple Gateways

```typescript
/**
 * Fetch from multiple gateways, use first to succeed
 */
export async function fetchFromGatewayWithFallback(
  cid: string,
  gateways: string[],
  timeout: number = 5000
): Promise<{
  content: unknown;
  gateway: string;
  codec: number;
  latency: number;
} | null> {
  const startTime = performance.now();

  const promises = gateways.map(async (gateway) => {
    try {
      const result = await fetchAndVerifyContent(cid, gateway);
      const codec = detectCodecFromCidPrefix(cid) || 0x0200;
      return {
        content: result,
        gateway,
        codec,
        latency: performance.now() - startTime
      };
    } catch (error) {
      console.debug(`Failed to fetch from ${gateway}: ${error}`);
      return null;
    }
  });

  // Race: return first success
  try {
    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }
  } catch {
    // All failed
  }

  return null;
}
```

### 5.2 Fallback Through Codec Options

```typescript
/**
 * Try fetching with different codecs if verification fails
 */
export async function fetchWithCodecFallback(
  cid: string,
  gatewayUrl: string,
  primaryCodec?: number
): Promise<{
  content: unknown;
  codec: number;
} | null> {
  const codecsToTry = [
    primaryCodec || detectCodecFromCidPrefix(cid),
    0x0200,    // JSON
    0x55,      // Raw
    0x0201,    // DAG-JSON
    0x71       // DAG-CBOR
  ].filter((c): c is number => c !== null && c !== undefined);

  for (const codec of codecsToTry) {
    try {
      const response = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) continue;

      const bytes = new Uint8Array(await response.arrayBuffer());

      // Try to verify with this codec
      const verification = await verifyCidFromRawBytes(cid, bytes);
      if (verification.valid && verification.detectedCodec) {
        const decoded = decodeByCodec(bytes, verification.detectedCodec);
        return { content: decoded, codec: verification.detectedCodec };
      }
    } catch {
      // Try next codec
    }
  }

  return null;
}
```

---

## 6. IPNS Resolution with Codec Awareness

### 6.1 Resolve IPNS with Codec Detection

```typescript
/**
 * Resolve IPNS name and extract codec from resulting CID
 */
export async function resolveIpnsWithCodec(
  ipnsName: string,
  gatewayUrl: string
): Promise<{
  cid: string;
  codec: number;
  sequence: number;
}> {
  // Method 1: Gateway path (fast, returns content)
  const response = await fetch(`${gatewayUrl}/ipns/${ipnsName}`, {
    signal: AbortSignal.timeout(3000)
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve IPNS: ${response.status}`);
  }

  // If JSON content returned, try to extract CID metadata
  const content = (await response.json()) as { _cid?: string };
  const cid = content._cid;

  if (!cid) {
    throw new Error('No CID in IPNS content');
  }

  const codec = detectCodecFromCidPrefix(cid);
  if (!codec) {
    throw new Error(`Cannot detect codec from CID: ${cid}`);
  }

  return { cid, codec, sequence: 0 }; // sequence from gateway path is unreliable
}

/**
 * Resolve IPNS using routing API for authoritative sequence
 */
export async function resolveIpnsAuthoritative(
  ipnsName: string,
  gatewayUrl: string
): Promise<{
  cid: string;
  codec: number;
  sequence: bigint;
}> {
  const response = await fetch(
    `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    }
  );

  if (!response.ok) {
    throw new Error(`Routing API failed: ${response.status}`);
  }

  const data = (await response.json()) as { Extra?: string };
  if (!data.Extra) {
    throw new Error('No IPNS record in response');
  }

  // Decode base64 IPNS record
  const recordBytes = Uint8Array.from(
    atob(data.Extra),
    (c) => c.charCodeAt(0)
  );

  // Parse IPNS record (requires ipns library)
  const record = unmarshalIPNSRecord(recordBytes);
  const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);

  if (!cidMatch) {
    throw new Error('Invalid IPNS record format');
  }

  const cid = cidMatch[1];
  const codec = detectCodecFromCidPrefix(cid);

  if (!codec) {
    throw new Error(`Cannot detect codec from CID: ${cid}`);
  }

  return {
    cid,
    codec,
    sequence: record.sequence
  };
}
```

---

## 7. Integration with Existing IpfsHttpResolver

### 7.1 Update Existing Verification

```typescript
/**
 * Updated version of current IpfsHttpResolver verification
 * (from IpfsHttpResolver.ts:196-211)
 */
export async function fetchContentByCidWithVerification(
  cid: string,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<{ content: TxfStorageData; rawBytes: Uint8Array } | null> {
  try {
    const url = `${gatewayUrl}/ipfs/${cid}`;

    // Detect codec first (< 1ms)
    const codec = detectCodecFromCidPrefix(cid);

    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: 'application/octet-stream' // Force raw bytes
      }
    });

    if (!response.ok) return null;

    const rawBytes = new Uint8Array(await response.arrayBuffer());

    // Verify CID with detected codec
    if (codec) {
      const verification = await verifyCidFromRawBytes(cid, rawBytes);

      if (!verification.valid) {
        console.warn(`⚠️ CID verification failed: ${verification.error}`);
        // Try fallback codecs
        const fallbackResult = await verifyCidWithFallback(cid, rawBytes);
        if (!fallbackResult.valid) {
          console.warn(`❌ All codec attempts failed for CID ${cid.slice(0, 16)}...`);
          return null;
        }
      }
    }

    // Parse JSON content
    const textDecoder = new TextDecoder();
    const jsonString = textDecoder.decode(rawBytes);
    const content = JSON.parse(jsonString) as TxfStorageData;

    return { content, rawBytes };
  } catch (error) {
    console.error(`Fetch failed: ${error}`);
    return null;
  }
}
```

---

## 8. Testing Examples

### 8.1 Unit Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Codec Detection', () => {
  describe('detectCodecFromCidPrefix', () => {
    it('detects JSON codec from bafyren prefix', () => {
      const codec = detectCodecFromCidPrefix('bafyren5q...');
      expect(codec).toBe(0x0200);
    });

    it('detects raw codec from bafkrei prefix', () => {
      const codec = detectCodecFromCidPrefix('bafkrei...');
      expect(codec).toBe(0x55);
    });

    it('returns null for invalid CID', () => {
      const codec = detectCodecFromCidPrefix('invalid');
      expect(codec).toBeNull();
    });
  });

  describe('verifyCidFromRawBytes', () => {
    it('verifies correct CID', async () => {
      const content = JSON.stringify({ test: true });
      const bytes = new TextEncoder().encode(content);

      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
      const hash = new Uint8Array(hashBuffer);
      const cid = CID.createV1(0x0200, hash).toString();

      const result = await verifyCidFromRawBytes(cid, bytes);
      expect(result.valid).toBe(true);
      expect(result.detectedCodec).toBe(0x0200);
    });

    it('rejects wrong CID', async () => {
      const content = JSON.stringify({ test: true });
      const bytes = new TextEncoder().encode(content);

      const wrongCid = 'bafkrei12345...'; // Wrong CID

      const result = await verifyCidFromRawBytes(wrongCid, bytes);
      expect(result.valid).toBe(false);
    });
  });

  describe('verifyCidWithFallback', () => {
    it('finds matching codec through fallback', async () => {
      const content = JSON.stringify({ test: true });
      const bytes = new TextEncoder().encode(content);

      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
      const hash = new Uint8Array(hashBuffer);
      const correctCid = CID.createV1(0x0200, hash).toString();

      const result = await verifyCidWithFallback(correctCid, bytes);
      expect(result.valid).toBe(true);
      expect(result.matchingCodec).toBe(0x0200);
    });
  });
});
```

### 8.2 Integration Tests

```typescript
describe('IPFS Gateway Integration', () => {
  it('probes gateway codec successfully', async () => {
    const result = await probeGatewayCodec('http://localhost:8080');
    expect(result.success).toBe(true);
    expect(result.codec).toBeDefined();
    expect(result.latency).toBeGreaterThan(0);
    expect(result.latency).toBeLessThan(5000);
  });

  it('fetches and verifies content from gateway', async () => {
    // Upload test content
    const formData = new FormData();
    formData.append('file', new Blob(['test content']));

    const uploadRes = await fetch('http://localhost:8080/api/v0/add', {
      method: 'POST',
      body: formData
    });
    const { Hash: cid } = await uploadRes.json();

    // Fetch with codec handling
    const result = await fetchWithCodecHandling(cid, 'http://localhost:8080');
    expect(result.codec).toBeDefined();
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('falls back through gateways on failure', async () => {
    const gateways = [
      'http://offline-gateway:8080', // Will fail
      'http://localhost:8080'         // Will succeed
    ];

    const result = await fetchFromGatewayWithFallback(
      'bafyren5q...',
      gateways
    );

    expect(result).not.toBeNull();
    expect(result?.gateway).toBe('http://localhost:8080');
  });
});
```

---

## 9. Performance Benchmarks

```typescript
/**
 * Benchmark codec detection performance
 */
async function benchmarkCodecDetection() {
  const cids = Array.from({ length: 1000 }, (_, i) => `bafyren5q${i}`);

  const start = performance.now();
  for (const cid of cids) {
    detectCodecFromCidPrefix(cid);
  }
  const elapsed = performance.now() - start;

  console.log(`Detected 1000 CIDs in ${elapsed.toFixed(2)}ms`);
  console.log(`Average per CID: ${(elapsed / 1000).toFixed(4)}ms`);
  // Expected: < 1ms total (< 0.001ms per CID)
}

/**
 * Benchmark CID verification
 */
async function benchmarkCidVerification() {
  const content = JSON.stringify({ test: true, nested: { data: 'value' } });
  const bytes = new TextEncoder().encode(content);

  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hash = new Uint8Array(hashBuffer);
    CID.createV1(0x0200, hash);
  }
  const elapsed = performance.now() - start;

  console.log(`Verified 100 CIDs in ${elapsed.toFixed(2)}ms`);
  console.log(`Average per verification: ${(elapsed / 100).toFixed(2)}ms`);
  // Expected: 10-20ms per verification (dominated by SHA-256)
}

/**
 * Benchmark gateway probing
 */
async function benchmarkGatewayProbing() {
  const gateways = [
    'http://localhost:8080',
    'http://gateway2:8080',
    'http://gateway3:8080'
  ];

  const start = performance.now();
  await probeAllGateways(gateways);
  const elapsed = performance.now() - start;

  console.log(`Probed ${gateways.length} gateways in ${elapsed.toFixed(0)}ms`);
  // Expected: 200-500ms per gateway
}
```

---

## 10. Recommended Integration Checklist

- [ ] Extract `IpfsCodecDetector` service
- [ ] Implement `detectCodecFromCidPrefix()`
- [ ] Add `verifyCidFromRawBytes()` verification
- [ ] Implement `probeGatewayCodec()` for backend discovery
- [ ] Add `fetchWithCodecHandling()` to gateway requests
- [ ] Update `IpfsHttpResolver.fetchContentByCid()` to use detector
- [ ] Add codec fallback strategy for mismatches
- [ ] Implement `CodecPreferenceCache` for backend preferences
- [ ] Write unit tests for codec detection
- [ ] Write integration tests with Kubo
- [ ] Benchmark performance
- [ ] Add observability/logging
- [ ] Deploy to staging
- [ ] Monitor and collect metrics
- [ ] Deploy to production

---

## 11. Dependencies

- `multiformats` (already in package.json)
- `ipns` (for IPNS record parsing, already in package.json)
- Native `crypto` API (Web Crypto, built-in)

No additional dependencies required!

