# IPFS Caching Infrastructure - Quick Reference

**Date**: 2026-01-24
**Purpose**: Fast reference for integrating Sphere app with IPFS caching backend

---

## TL;DR

The IPFS backend at `/home/vrogojin/ipfs-storage` provides **sub-second IPNS resolution** via a two-tier caching system:

1. **Nginx HTTP cache**: 30s TTL for IPNS, 7d for IPFS content
2. **SQLite sidecar**: 5-20ms IPNS lookups with sequence validation

**Performance**: 5-20ms cached (vs 1-5 seconds DHT) = **250x faster**

---

## Architecture (1-Minute Overview)

```
┌──────────────────────────────────────────────────────────┐
│         ipfs-storage Container (supervisord)              │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐   │
│  │   nginx    │──│ IPFS Kubo  │──│ nostr-pinner.py  │   │
│  │ HTTP cache │  │ :5001 API  │  │ SQLite sidecar   │   │
│  │ 30s IPNS   │  │ :8080 GW   │  │ 5-20ms lookups   │   │
│  └────────────┘  └────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**Key Components**:
- **Nginx**: TLS termination, HTTP caching, fast-path routing
- **Kubo**: Standard IPFS daemon with DHT
- **Sidecar**: Python service (port 9081) with SQLite database

---

## Fast-Path IPNS Resolution

### How It Works

```
Browser → nginx :443 → /api/v0/routing/get
              ↓
       ┌──────────────┐
       │  TRY SIDECAR │ (1s timeout)
       └──────────────┘
              │
      ┌───────┴────────┐
      │                │
   CACHE HIT       CACHE MISS
   (5-20ms)        (404)
      │                │
      │                ▼
      │         ┌────────────┐
      │         │ Kubo DHT   │
      │         │ (1-5 sec)  │
      │         └────────────┘
      │                │
      └────────────────┘
              │
         Return record
      (highest sequence wins)
```

### Nginx Configuration

**File**: `/home/vrogojin/ipfs-storage/config/nginx.conf.template`

```nginx
# Line 248: Fast-path IPNS resolution
location /api/v0/routing/get {
    # Try sidecar first (5-20ms)
    proxy_pass http://sidecar/routing-get$is_args$args;
    proxy_connect_timeout 1s;
    proxy_read_timeout 2s;

    # Fallback to Kubo DHT on 404
    proxy_intercept_errors on;
    error_page 404 500 502 504 = @routing_get_fallback;
}

location @routing_get_fallback {
    proxy_pass http://127.0.0.1:5001/api/v0/routing/get$is_args$args;
    proxy_read_timeout 30s;
}
```

### Sidecar Implementation

**File**: `/home/vrogojin/ipfs-storage/nostr-pinner/nostr_pinner.py`

**Database Schema**:

```sql
CREATE TABLE ipns_records (
    ipns_name TEXT PRIMARY KEY,
    marshalled_record BLOB NOT NULL,  -- Raw protobuf
    cid TEXT,                          -- Resolved CID
    sequence INTEGER DEFAULT 0,        -- IPNS sequence
    last_updated TIMESTAMP
);
```

**Lookup Logic** (lines 859-963):

```python
# Query sidecar DB
db_record, db_sequence = query_sidecar(ipns_name)

# Query Kubo for authoritative record
kubo_record, kubo_sequence = query_kubo_dht(ipns_name)

# Return record with highest sequence
if kubo_sequence > db_sequence:
    update_sidecar_cache(ipns_name, kubo_record)
    return kubo_record  # X-IPNS-Source: kubo
else:
    return db_record    # X-IPNS-Source: sidecar-cache
```

**Key Feature**: Always validates against Kubo, returns highest sequence number

---

## IPNS Record Interception

### Publishing Flow

```
Browser: POST /api/v0/routing/put?arg=/ipns/{name}
              │
              ▼
         ┌─────────┐
         │  nginx  │  Mirror request to sidecar
         └─────────┘
              │
      ┌───────┴────────┐
      │                │
  Forward to      Mirror to
  Kubo DHT        Sidecar
      │                │
      ▼                ▼
  Publishes to    Stores in
  IPFS network    SQLite DB
```

**Nginx Config** (line 229):

```nginx
location /api/v0/routing/put {
    # Mirror request to sidecar for caching
    mirror /internal/ipns-intercept;
    mirror_request_body on;

    # Forward to kubo for DHT publishing
    proxy_pass http://127.0.0.1:5001;
}
```

**Sidecar Handler** (lines 715-766):

```python
async def _handle_ipns_intercept(self, request):
    ipns_name = parse_query_param(request, 'arg')
    record_bytes = await parse_multipart_body(request)

    # Store with sequence validation
    self.ipns_store.store_record(ipns_name, record_bytes)
```

**Sequence Validation** (lines 416-459):

```python
def store_record(ipns_name, record_bytes):
    new_seq = parse_ipns_sequence(record_bytes)
    existing_seq = db.get_sequence(ipns_name)

    if new_seq < existing_seq:
        return False  # Reject stale record

    db.insert_or_replace(ipns_name, record_bytes, new_seq)
    return True
```

---

## Integration Guide

### 1. Use Routing API (Not HTTP Gateway)

**BEFORE** (slow, no sidecar benefit):

```typescript
// IpfsHttpResolver.ts
const url = `https://unicity-ipfs1.dyndns.org/ipns/${nametag}`;
const response = await fetch(url);
const tokens = await response.json();
```

**AFTER** (fast, uses sidecar cache):

```typescript
// Use routing API for IPNS resolution
const url = `https://unicity-ipfs1.dyndns.org/api/v0/routing/get?arg=/ipns/${nametag}`;
const response = await fetch(url);
const data = await response.json();

// Decode IPNS record
const recordBytes = base64Decode(data.Extra);
const ipnsRecord = parseIpnsRecord(recordBytes);
const cid = ipnsRecord.value; // e.g., /ipfs/bafyXXX

// Check cache source
const source = response.headers.get('X-IPNS-Source');
const sequence = response.headers.get('X-IPNS-Sequence');

console.log(`IPNS resolved from ${source} (seq=${sequence})`);

// Fetch content from CID
const contentUrl = `https://unicity-ipfs1.dyndns.org/ipfs/${cid}`;
const contentResponse = await fetch(contentUrl);
const tokens = await contentResponse.json();
```

### 2. Monitor Cache Effectiveness

```typescript
// Track cache hit rate
const source = response.headers.get('X-IPNS-Source');

if (source === 'sidecar-cache') {
  // 5-20ms response time
  metrics.ipnsCacheHits++;
} else if (source === 'kubo') {
  // 1-5 second response time
  metrics.ipnsCacheMisses++;
}

// Log cache hit rate
const hitRate = metrics.ipnsCacheHits / (metrics.ipnsCacheHits + metrics.ipnsCacheMisses);
console.log(`IPNS cache hit rate: ${(hitRate * 100).toFixed(1)}%`);
```

### 3. Force Fresh Lookup (Optional)

```typescript
// For critical operations (e.g., nametag registration verification)
const headers = {'X-No-Cache': '1'};
const response = await fetch(url, {headers});
// This bypasses nginx cache and queries Kubo directly
```

---

## Performance Expectations

### Cold vs Warm Cache

| Operation | Cold (DHT) | Warm (Sidecar) | Speedup |
|-----------|------------|----------------|---------|
| IPNS resolution | 1-5 sec | 5-20ms | **250x** |
| IPFS content | 500ms-2s | 10-50ms | **50x** |
| Pin status | 100-200ms | 5ms | **40x** |

### Token Sync Breakdown

**Scenario**: User syncs 10 tokens via IPNS nametag

| Step | Current (no cache) | With Sidecar | Improvement |
|------|-------------------|--------------|-------------|
| Resolve nametag IPNS | 1-5s | 5-20ms | **250x** |
| Fetch IPNS CID | 500ms-2s | 10-50ms | **50x** |
| Fetch 10 token CIDs | 5-20s | 100-500ms | **40x** |
| **Total** | **10-30s** | **200-600ms** | **50x** |

**Note**: First sync is always slow (cold cache). Subsequent syncs are nearly instant.

---

## Sidecar API Endpoints

**Base URL**: `http://127.0.0.1:9081` (internal)

| Endpoint | Method | Purpose | Response Time |
|----------|--------|---------|---------------|
| `/routing-get?arg=/ipns/{name}` | GET/POST | Fast IPNS lookup | 5-20ms |
| `/pin-status?cid={cid}` | GET | Check pin status | 5ms |
| `/metrics` | GET | Service stats | 10ms |
| `/health` | GET | Health check | <1ms |
| `/reannounce` | POST | Manual re-publish | Async |

**Example Response Headers**:

```
X-IPNS-Source: sidecar-cache    # or 'kubo'
X-IPNS-Sequence: 42             # Current sequence number
X-Cache-Status: HIT             # Nginx cache status
```

---

## Configuration & Tuning

### Environment Variables

**Sidecar Configuration** (docker-compose.yml):

```bash
# Database
DB_PATH=/data/ipfs/propagation.db

# Rate limiting
MAX_PINS_PER_SECOND=100

# Re-announcement interval
ANNOUNCE_INTERVAL=0              # 0 = probabilistic (default)
ANNOUNCE_PROBABILITY=0.000277778 # ~1/hour

# Nostr relays
NOSTR_RELAYS=wss://nostr-relay.testnet.unicity.network,...
```

### Kubo Performance Tuning

**File**: `/home/vrogojin/ipfs-storage/scripts/configure-ipfs.sh`

```bash
# CRITICAL: Accelerated DHT for fast IPNS lookups
ipfs config --json Routing.AcceleratedDHTClient true

# Increase IPNS cache size
ipfs config --json Ipns.ResolveCacheSize 4096

# Optimize datastore
ipfs config --json Datastore.BloomFilterSize 1048576
```

### Nginx Cache Settings

```nginx
# Cache path: 100MB metadata, 10GB content
proxy_cache_path /var/cache/nginx/ipfs
    keys_zone=ipfs_cache:100m
    max_size=10g
    inactive=7d;

# IPFS content: 7-day TTL (immutable)
location /ipfs/ {
    proxy_cache_valid 200 7d;
    gzip off;  # CRITICAL for CID verification
}

# IPNS content: 30-second TTL (mutable)
location /ipns/ {
    proxy_cache_valid 200 30s;
    proxy_cache_bypass $http_x_no_cache;
    gzip off;  # CRITICAL for CID verification
}
```

---

## Monitoring

### Check Sidecar Metrics

```bash
curl -s http://localhost:9081/metrics | jq
```

**Response**:

```json
{
  "database": {
    "total_pinned_cids": 1523,
    "total_ipns_records": 42,
    "ipns_announcements": 8
  },
  "session": {
    "cids_pinned": 1500,
    "ipns_records_stored": 42,
    "reannouncements": 3
  }
}
```

### Check Cache Hit Rate

```bash
# View cache status distribution
docker logs ipfs-kubo 2>&1 | grep "X-Cache-Status" | awk '{print $NF}' | sort | uniq -c
```

### Check IPNS Source Distribution

```bash
# Count sidecar hits vs Kubo fallbacks
docker logs ipfs-kubo 2>&1 | grep "X-IPNS-Source" | awk '{print $NF}' | sort | uniq -c
```

**Example Output**:

```
245 sidecar-cache  # 85% cache hits
 42 kubo           # 15% DHT fallbacks
```

---

## Troubleshooting

### Issue: Still seeing slow IPNS resolution

**Check 1**: Verify you're using routing API (not HTTP gateway)

```typescript
// WRONG: Uses HTTP gateway, bypasses sidecar
const url = `/ipns/${nametag}`;

// CORRECT: Uses routing API, hits sidecar
const url = `/api/v0/routing/get?arg=/ipns/${nametag}`;
```

**Check 2**: Inspect response headers

```bash
curl -I 'https://unicity-ipfs1.dyndns.org/api/v0/routing/get?arg=/ipns/k51...'
# Look for: X-IPNS-Source: sidecar-cache
```

**Check 3**: Verify sidecar is running

```bash
docker exec ipfs-kubo supervisorctl status
# Output should show:
# nostr-pinner    RUNNING    pid 123, uptime 1:23:45
```

### Issue: Cache misses despite repeated lookups

**Cause**: Nginx cache expired (30s TTL) but sidecar DB still has record

**Solution**: The sidecar should still serve fast (5-20ms). If not, check:

```bash
# Check sidecar DB
docker exec ipfs-kubo sqlite3 /data/ipfs/propagation.db "SELECT COUNT(*) FROM ipns_records;"
# Should show > 0 if records are cached

# Check sidecar logs
docker logs ipfs-kubo 2>&1 | grep "routing-get"
```

### Issue: Wrong sequence number returned

**Cause**: Sidecar DB is stale, Kubo has newer record

**Expected Behavior**: Sidecar automatically queries Kubo and updates DB

**Verify**:

```bash
curl -s 'http://localhost:9081/routing-get?arg=/ipns/k51...' -I | grep X-IPNS-Sequence
# Compare with Kubo:
curl -s 'http://localhost:5001/api/v0/routing/get?arg=/ipns/k51...' | jq -r '.Extra' | base64 -d | hexdump
```

---

## Key Takeaways

1. **Use `/api/v0/routing/get`** instead of `/ipns/` HTTP gateway for IPNS resolution
2. **Sidecar provides 250x speedup** for cached IPNS records (5-20ms vs 1-5 seconds)
3. **Sequence validation** ensures you always get the latest record
4. **Dual-source queries** (sidecar + Kubo) prevent stale cache serving
5. **Automatic fallback** to DHT if cache miss (transparent to client)

**Expected Result**: Token sync time reduced from **10-30 seconds** to **200-600ms** after first sync.

---

## Next Steps

1. ✅ **Understand caching architecture** (this document)
2. 🔄 **Update IpfsHttpResolver.ts** to use routing API
3. 📊 **Add cache hit rate monitoring** via response headers
4. 🚀 **Deploy and measure performance** improvement
5. 🔧 **Tune re-announcement interval** based on usage

---

**Full Analysis**: See `/home/vrogojin/sphere/IPFS_CACHING_INFRASTRUCTURE_ANALYSIS.md`
**Backend Code**: `/home/vrogojin/ipfs-storage/`
**Status**: ✅ Research complete, ready for integration
