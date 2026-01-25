# IPFS CID Codec Detection: Quick Reference Guide

## Codec Cheat Sheet

```
CID Prefix           Codec Name       Code    Use Case
─────────────────────────────────────────────────────────
bafkrei...          raw              0x55    Binary data
bafy...             dag-pb           0x70    UnixFS/directories
bafyrei...          dag-cbor         0x71    CBOR data
bafyren...          json             0x0200  JSON objects
bafyrej...          dag-json         0x0201  DAG-JSON (modern)
Qm...               dag-pb (v0)      -       Legacy CIDv0
```

## Detection Algorithm (< 1ms)

```typescript
// Option 1: String prefix (fastest)
if (cid.startsWith('bafyren')) return 0x0200; // JSON

// Option 2: Proper decoding (recommended)
const cidObj = CID.parse(cid);
return cidObj.code;
```

## Verification Pattern

```typescript
// 1. Detect codec
const codec = detectCodecFromCid(cid);

// 2. Get raw bytes from gateway
const bytes = await fetch(`${gateway}/ipfs/${cid}`)
  .then(r => r.arrayBuffer())
  .then(b => new Uint8Array(b));

// 3. Verify: hash(bytes) should match CID
const hash = await sha256.digest(bytes);
const computed = CID.createV1(codec, hash).toString();
if (computed !== cid) return false; // Mismatch!

// 4. Decode based on codec
const content = decodeByCodec(bytes, codec);
```

## Gateway Codec Detection

```
Scenario: Which codec does this gateway use?

Solution: Upload test content, observe returned CID

await fetch(`${gateway}/api/v0/add`, {
  method: 'POST',
  body: formData // JSON content
})
.then(r => r.json())
.then(json => detectCodecFromCid(json.Hash))
// Returns: codec used by gateway
```

## HTTP Response Handling

```
Request:  GET /ipfs/{cid}
          Accept: application/octet-stream

Response: Raw bytes (never re-encoded!)
          Content-Type: varies
          Content-Length: bytes

Pattern:
1. Always request octet-stream (raw)
2. Never trust Content-Type header
3. Always verify CID matches
4. Decode based on detected codec
```

## IPNS Resolution

```
Flow:
1. GET /ipns/{name}
   ↓ Returns content with _cid field

2. Extract CID from response
   ↓ cid = response._cid

3. Detect codec from CID
   ↓ codec = detectCodecFromCid(cid)

4. Verify with authoritative sequence
   POST /api/v0/routing/get?arg=/ipns/{name}
   ↓ Returns IPNS record bytes

5. Parse record for sequence number
   ↓ Ensure consistency across devices
```

## Multi-Gateway Failover

```
Strategy: Race to first success

for each gateway in parallel:
  └─ fetch(cid)
     ├─ Detect codec
     ├─ Verify CID
     ├─ Decode content
     └─ Return on success

if all fail:
  └─ Try fallback codecs
     └─ Retry with different codec
```

## Codec Priority (Fallback Order)

```
1. detectCodecFromCid(cid)     ← Primary (detected)
2. 0x0200 (JSON)               ← Most common
3. 0x55 (Raw)                  ← Kubo default
4. 0x0201 (DAG-JSON)           ← Modern IPLD
5. 0x71 (DAG-CBOR)             ← Binary format
```

## Performance Targets

```
Operation                       Time        Status
─────────────────────────────────────────────────
Detect codec (string)           < 0.1ms     ✓ Easy
Detect codec (proper)           < 1ms       ✓ Easy
Verify CID (hash)               5-20ms      ✓ OK
Fetch from gateway              50-100ms    ✓ Network
Probe backend codec             200-500ms   ✓ One-time
Resolve IPNS                    100-300ms   ✓ Network
Total first fetch               56-121ms    ✓ Good
```

## Error Handling Checklist

- [ ] CID parse error → reject gracefully
- [ ] Codec detection fails → try fallback codecs
- [ ] CID verification fails → try next gateway
- [ ] Gateway timeout → skip to next
- [ ] Content decode error → log and skip
- [ ] All gateways fail → return error
- [ ] IPNS resolution fails → check cache, retry

## Implementation Checklist

- [ ] Add `IpfsCodecDetector` service
- [ ] Implement codec detection (string + proper)
- [ ] Add CID verification
- [ ] Update gateway fetch to use codec
- [ ] Add fallback strategy
- [ ] Implement backend probing
- [ ] Add gateway cache for codecs
- [ ] Update IPNS resolution
- [ ] Add error handling
- [ ] Write tests
- [ ] Benchmark performance
- [ ] Monitor in production

## Security Checklist

- [ ] Always verify CID (prevent spoofing)
- [ ] Request raw bytes (prevent re-encoding)
- [ ] Don't trust Content-Type header
- [ ] Validate codec is known (prevent injection)
- [ ] Check sequence number (IPNS integrity)
- [ ] Log codec mismatches (audit trail)
- [ ] Handle timeouts gracefully (DoS resistant)

## Code Snippets

### Detect
```typescript
const codec = CID.parse(cid).code;
```

### Verify
```typescript
const hash = await sha256.digest(rawBytes);
const verified = CID.createV1(codec, hash).toString() === cid;
```

### Fetch
```typescript
const bytes = await fetch(`${gateway}/ipfs/${cid}`)
  .then(r => r.arrayBuffer())
  .then(b => new Uint8Array(b));
```

### Probe
```typescript
const cid = await fetch(`${gateway}/api/v0/add`, {
  method: 'POST',
  body: testContent
}).then(r => r.json()).then(j => j.Hash);
const codec = CID.parse(cid).code;
```

## Common Issues & Solutions

**Issue**: CID verification fails
- Check: Are you using raw bytes? (not re-encoded)
- Check: Is codec detected correctly?
- Solution: Try alternative codecs in fallback

**Issue**: Different gateways return different CIDs
- Cause: Different backends use different default codecs
- Solution: Normalize to canonical codec before publishing

**Issue**: IPNS points to different codec than before
- Cause: Device published with different codec
- Solution: Verify codec, re-publish if needed

**Issue**: Performance degradation
- Check: Is codec detection cached?
- Check: Is gateway fetch using cache?
- Solution: Ensure cache TTLs appropriate

## Debugging Tips

```typescript
// Log codec for CID
console.log(`CID ${cid.slice(0,16)}... uses codec 0x${codec.toString(16)}`);

// Log verification result
if (verification.valid) {
  console.log(`✓ CID verified with ${CODEC_NAMES[codec]}`);
} else {
  console.warn(`✗ CID verification failed: ${verification.error}`);
}

// Log gateway codec preference
console.log(`Gateway ${gateway} prefers 0x${gatewayCodec.toString(16)}`);

// Log fallback attempt
console.log(`Falling back to codec 0x${fallbackCodec.toString(16)}`);
```

## Network Diagram

```
Browser Client
  │
  ├─ Detect Codec (< 1ms)
  │  CID string → extract multicodec
  │
  ├─ Fetch from Gateway (50-100ms)
  │  GET /ipfs/{cid} → raw bytes
  │
  ├─ Verify CID (5-20ms)
  │  SHA-256(bytes) → hash → createV1() → CID
  │
  └─ Decode (< 1ms)
     bytes + codec → content

Multi-Gateway:
  For each gateway in parallel:
    ├─ Try primary codec
    └─ If fails: try fallback codecs
  Return first success
```

## IPNS Flow

```
Resolve IPNS Name
  │
  ├─ GET /ipns/{name}
  │  └─ Get content + CID hint
  │
  └─ POST /api/v0/routing/get
     └─ Get authoritative record + sequence

Extract CID from record
  │
  ├─ Detect codec
  └─ Verify consistency

Fetch content by CID
  │
  ├─ Use detected codec
  ├─ Verify CID
  └─ Decode with correct codec
```

## References

- CID Format: https://github.com/multiformats/cid
- Multicodec: https://github.com/multiformats/multicodec/blob/master/table.csv
- IPNS Records: https://github.com/ipfs/specs/tree/master/ipns
- Kubo API: https://docs.ipfs.tech/reference/kubo/rpc/

---

**Last Updated**: 2026-01-24
**Status**: Ready for Implementation

