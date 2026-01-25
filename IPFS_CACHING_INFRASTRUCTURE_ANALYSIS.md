# IPFS Caching Infrastructure Analysis

**Date**: 2026-01-24
**Project**: AgentSphere - IPFS Storage Backend
**Purpose**: Research and analysis of custom IPFS caching service for sub-second IPNS resolution

---

## Executive Summary

The `/home/vrogojin/ipfs-storage` repository contains a **production-grade IPFS caching infrastructure** with:

1. **Nginx-based HTTP caching** for IPFS content and IPNS records
2. **Python sidecar service** (nostr-pinner) with SQLite database for IPNS record caching
3. **Fast-path routing** that bypasses DHT lookups for cached IPNS records
4. **Dual publishing strategy** - HTTP API to backend + browser DHT propagation
5. **Sub-second IPNS resolution** when records are cached (5-20ms vs 1-5 seconds)

**Key Insight**: This is a **two-tier caching system** - nginx for HTTP-level caching (30s TTL for IPNS) and a Python sidecar for database-backed IPNS record storage with sequence validation.

---

## 1. Architecture Overview

### 1.1 Component Structure

```
┌─────────────────────────────────────────────────────────────┐
│                  ipfs-storage Container                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    supervisord                        │  │
│  │  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │  │
│  │  │  nginx   │──│ IPFS Kubo  │──│ nostr-pinner.py  │  │  │
│  │  │  :443    │  │  :5001 API │  │  :9081 sidecar   │  │  │
│  │  │  :4003   │  │  :8080 GW  │  │  SQLite DB       │  │  │
│  │  └──────────┘  └────────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │               │                    │
         ▼               ▼                    ▼
    WSS/HTTPS      libp2p Swarm         Nostr Relays
```

**All services run in a single Docker container, managed by supervisord.**

### 1.2 Port Mapping

| Port | Protocol | Service | Purpose |
|------|----------|---------|---------|
| 443 | HTTPS | nginx → kubo:8080 | HTTPS gateway (cached) |
| 4001 | TCP/UDP | kubo | IPFS Swarm (p2p connections) |
| 4003 | WSS | nginx → kubo:4002 | TLS-terminated WebSocket |
| 9080 | HTTP | nginx → kubo:8080 | HTTP gateway (exposed) |
| 5001 | HTTP | kubo | IPFS API (internal only) |
| 8080 | HTTP | kubo | IPFS Gateway (internal) |
| 9081 | HTTP | nostr-pinner | Sidecar API (internal) |

---

## 2. Caching Architecture

### 2.1 Two-Tier Caching System

The infrastructure implements **two distinct caching layers**:

#### **Tier 1: Nginx HTTP Cache**

**Location**: `/var/cache/nginx/ipfs`
**Configuration**: `config/nginx.conf.template` (line 68)

```nginx
proxy_cache_path /var/cache/nginx/ipfs
    levels=1:2
    keys_zone=ipfs_cache:100m
    max_size=10g
    inactive=7d
    use_temp_path=off;
```

**Cache Rules**:

| Endpoint | Cache TTL | Cache Key | Purpose |
|----------|-----------|-----------|---------|
| `/ipfs/` | 7 days | `$uri` | Immutable content (CID-addressed) |
| `/ipns/` | 30 seconds | `$uri` | Mutable IPNS resolution (short TTL) |

**Features**:
- Background updates (`proxy_cache_background_update on;`)
- Stale cache serving on upstream errors
- Cache bypass via `X-No-Cache` header for `/ipns/`
- **Critical**: Gzip disabled for CID verification integrity

#### **Tier 2: Sidecar SQLite Database**

**Location**: `/data/ipfs/propagation.db`
**Service**: `nostr-pinner.py` (Python service on port 9081)

**Database Schema**:

```sql
-- Pinned CIDs with announcement tracking
CREATE TABLE pinned_cids (
    cid TEXT PRIMARY KEY,
    source TEXT DEFAULT 'nostr',
    pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_announced TIMESTAMP,
    announce_count INTEGER DEFAULT 0
);

-- IPNS records with sequence validation
CREATE TABLE ipns_records (
    ipns_name TEXT PRIMARY KEY,
    marshalled_record BLOB NOT NULL,  -- Raw protobuf record
    cid TEXT,                          -- Resolved CID (/ipfs/bafyXXX)
    sequence INTEGER DEFAULT 0,        -- IPNS sequence number
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_announced TIMESTAMP,
    announce_count INTEGER DEFAULT 0
);

-- Service metrics
CREATE TABLE metrics (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Features**:
- **Sequence validation**: Only stores IPNS records with `seq >= existing_seq`
- **Dual-source queries**: Checks both SQLite DB AND Kubo, returns highest sequence
- **Automatic republishing**: Re-announces IPNS records to DHT periodically
- **Fast lookups**: 5-20ms vs 1-5 seconds for DHT resolution

---

## 3. IPNS Resolution Flow (Fast Path)

### 3.1 Request Flow with Sidecar Optimization

```
Browser Request: /api/v0/routing/get?arg=/ipns/{name}
         │
         ▼
  ┌─────────────────┐
  │     nginx       │  Location /api/v0/routing/get (line 248)
  │  :443 (HTTPS)   │
  └─────────────────┘
         │
         ├─ TRY FAST PATH (1-2s timeout)
         │
         ▼
  ┌─────────────────┐
  │  Sidecar:9081   │  /routing-get endpoint
  │  SQLite Query   │  SELECT marshalled_record WHERE ipns_name=?
  └─────────────────┘
         │
         ├─── Cache HIT (5-20ms) ────────┐
         │                                 │
         └─── Cache MISS (404) ───┐       │
                                   │       │
                                   ▼       │
                          ┌──────────────┐ │
                          │  Kubo DHT    │ │
                          │  Lookup      │ │
                          │  (1-5 sec)   │ │
                          └──────────────┘ │
                                   │       │
                                   ▼       ▼
                          ┌──────────────────┐
                          │  Return record   │
                          │  + update cache  │
                          └──────────────────┘
```

### 3.2 Nginx Configuration (Fast Path Implementation)

**File**: `config/nginx.conf.template` (lines 248-287)

```nginx
location /api/v0/routing/get {
    # FAST PATH: Try sidecar database first (5-20ms)
    proxy_pass http://sidecar/routing-get$is_args$args;
    proxy_connect_timeout 1s;
    proxy_read_timeout 2s;

    # On 404 (not in cache) or error, fall back to kubo
    proxy_intercept_errors on;
    error_page 404 500 502 504 = @routing_get_fallback;

    # Add CORS headers
    add_header Access-Control-Allow-Origin * always;
}

# Fallback to kubo DHT resolution when sidecar returns 404
location @routing_get_fallback {
    proxy_pass http://127.0.0.1:5001/api/v0/routing/get$is_args$args;
    proxy_read_timeout 30s;
    # Kubo handles CORS natively
}
```

**Key Points**:
- **1s connection timeout** - fail fast if sidecar unavailable
- **2s read timeout** - quick database lookup
- **Automatic fallback** - seamless DHT resolution if cache miss
- **Dual CORS headers** - sidecar doesn't add them, nginx does

### 3.3 Sidecar Implementation

**File**: `nostr-pinner/nostr_pinner.py` (lines 859-963)

```python
async def _handle_routing_get(self, request: web.Request) -> web.Response:
    """
    IPNS record serving with sequence validation.
    Queries both sidecar database AND Kubo, returns record with highest sequence.
    """
    # Extract IPNS name from query param: ?arg=/ipns/{name}
    arg = request.query.get('arg', '')
    match = re.match(r'^/ipns/(.+)$', arg)

    # Query sidecar database
    cursor.execute('SELECT marshalled_record, sequence FROM ipns_records WHERE ipns_name = ?', (ipns_name,))
    db_record, db_sequence = ...

    # Also query Kubo for authoritative record
    kubo_record, kubo_sequence = await self._query_kubo_routing_get(ipns_name)

    # Return the record with higher sequence
    if kubo_sequence > db_sequence:
        # Update sidecar DB with Kubo's newer record
        self.ipns_store.store_record(ipns_name, kubo_record)
        return kubo_record  # X-IPNS-Source: kubo
    elif db_record:
        return db_record    # X-IPNS-Source: sidecar-cache
    else:
        return 404          # Not found anywhere
```

**Critical Features**:
1. **Dual-source validation**: Always checks both sidecar AND Kubo
2. **Sequence-based selection**: Returns record with highest sequence number
3. **Automatic cache update**: If Kubo has newer record, updates sidecar DB
4. **Custom headers**: `X-IPNS-Source` and `X-IPNS-Sequence` for debugging

---

## 4. IPNS Record Interception & Storage

### 4.1 Publishing Flow

When a browser publishes an IPNS record via `/api/v0/routing/put`:

```
Browser: POST /api/v0/routing/put?arg=/ipns/{name}
         Content: multipart/form-data with 'value-file' (protobuf record)
         │
         ▼
  ┌─────────────────┐
  │     nginx       │  Location /api/v0/routing/put (line 229)
  └─────────────────┘
         │
         ├─── mirror request to sidecar ──┐
         │                                 │
         └─── forward to Kubo ────────────┤
                                           │
  ┌─────────────────┐              ┌──────────────┐
  │  Sidecar:9081   │              │  Kubo:5001   │
  │  Store record   │              │  Publish DHT │
  │  in SQLite      │              │              │
  └─────────────────┘              └──────────────┘
         │                                 │
         ▼                                 ▼
  SQLite DB updated               DHT propagation
  (for future fast reads)         (to IPFS network)
```

### 4.2 Nginx Mirror Configuration

**File**: `config/nginx.conf.template` (lines 229-244)

```nginx
location /api/v0/routing/put {
    # Mirror request to sidecar for IPNS record capture
    mirror /internal/ipns-intercept;
    mirror_request_body on;

    # Forward to kubo
    proxy_pass http://127.0.0.1:5001;
}

location /internal/ipns-intercept {
    internal;
    proxy_pass http://127.0.0.1:9081/ipns-intercept;
}
```

**How it works**:
1. Browser sends IPNS publish request
2. nginx **mirrors** (duplicates) request to sidecar at `/ipns-intercept`
3. nginx **forwards** original request to Kubo for DHT publishing
4. Sidecar extracts IPNS record and stores in SQLite for future fast reads
5. Both operations happen concurrently

### 4.3 Sidecar Record Storage

**File**: `nostr-pinner/nostr_pinner.py` (lines 715-766)

```python
async def _handle_ipns_intercept(self, request: web.Request) -> web.Response:
    """Handle mirrored IPNS publish requests."""
    # Extract IPNS name from query: ?arg=/ipns/{name}
    ipns_name = parse_ipns_name_from_query(request.query_string)

    # Extract IPNS record from multipart form data
    record_bytes = await parse_multipart_record(request)

    # Validate and store (with sequence check)
    self.ipns_store.store_record(ipns_name, record_bytes)

    return web.Response(status=200, text="OK")
```

**Store Logic** (lines 416-459):

```python
def store_record(self, ipns_name: str, record_bytes: bytes) -> bool:
    """
    Store an IPNS record for later republishing.
    Only stores if the new record has a sequence >= existing sequence.
    """
    # Parse sequence from protobuf record
    new_sequence, parsed_cid = parse_ipns_record(record_bytes)

    # Check existing sequence
    existing_sequence = db.query_existing_sequence(ipns_name)

    # Reject if sequence is lower (prevents replay attacks)
    if new_sequence < existing_sequence:
        logger.warning(f"Rejecting IPNS record: seq={new_sequence} < existing={existing_sequence}")
        return False

    # Store in SQLite
    db.execute(
        "INSERT OR REPLACE INTO ipns_records (ipns_name, marshalled_record, cid, sequence) VALUES (?, ?, ?, ?)",
        (ipns_name, record_bytes, parsed_cid, new_sequence)
    )
    return True
```

**Sequence Validation** ensures:
- Only newer IPNS records overwrite older ones
- Prevents replay attacks
- Maintains consistency with IPNS protocol

---

## 5. Content Caching (IPFS Gateway)

### 5.1 Nginx Configuration

**File**: `config/nginx.conf.template` (lines 99-122)

```nginx
location /ipfs/ {
    # CRITICAL: Disable gzip compression for content-addressed data
    # Gzipping JSON and then re-serializing breaks CID verification
    gzip off;

    proxy_pass http://ipfs_gateway;
    proxy_cache ipfs_cache;
    proxy_cache_valid 200 7d;            # 7 days for immutable content
    proxy_cache_key $uri;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_background_update on;
    proxy_cache_lock on;

    add_header X-Cache-Status $upstream_cache_status;

    # Prevent cache poisoning (keep for defense in depth)
    proxy_set_header Accept-Encoding "";
}
```

**Why gzip is disabled**:
1. IPFS CIDs are SHA-256 hashes of **exact byte content**
2. If nginx gzips response, browser decompresses it
3. Client re-serializes JSON with `JSON.stringify()` for CID verification
4. Key reordering during re-serialization → different bytes → different hash → **CID mismatch**
5. Solution: `gzip off;` ensures raw bytes match hash

**Cache Behavior**:
- **Immutable content**: 7-day TTL (CIDs never change)
- **Stale serving**: If upstream fails, serve cached copy
- **Background updates**: Refresh cache without blocking client
- **Cache locking**: Prevents thundering herd on cache miss

### 5.2 IPNS Gateway Caching

**File**: `config/nginx.conf.template` (lines 125-150)

```nginx
location /ipns/ {
    # CRITICAL: Disable gzip compression for IPNS resolution content
    gzip off;

    proxy_pass http://ipfs_gateway;
    proxy_cache ipfs_cache;
    proxy_cache_valid 200 30s;           # 30 seconds for mutable IPNS
    proxy_cache_key $uri;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_background_update on;
    proxy_cache_lock on;

    # Allow cache bypass for critical reads
    proxy_cache_bypass $http_x_no_cache;

    add_header X-Cache-Status $upstream_cache_status;
}
```

**Why 30 seconds TTL**:
- IPNS records can be updated (mutable)
- 30s provides balance between:
  - **Performance**: Avoids repeated DHT lookups
  - **Freshness**: Picks up updates within 30 seconds
- Browser can bypass cache with `X-No-Cache: 1` header

---

## 6. Nostr Integration & Propagation

### 6.1 Pin Announcement Protocol

The sidecar service listens to **Nostr relays** for CID pin announcements using NIP-78 (app-specific data):

**Event Format** (kind 30078):

```json
{
  "kind": 30078,
  "tags": [
    ["d", "ipfs-pin"],
    ["cid", "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"],
    ["ipns", "k51qzi5uqu5djzk..."]  // Optional
  ],
  "content": "{\"source\":\"node-name\",\"timestamp\":1737749000}"
}
```

**Service Flow**:

```python
# Subscribe to Nostr relays for pin announcements
async def subscribe_to_relay(relay_url, pin_queue):
    filters = [{"kinds": [30078], "#d": ["ipfs-pin"]}]

    async with websockets.connect(relay_url) as ws:
        await ws.send(json.dumps(["REQ", "ipfs-pin-sub"] + filters))

        while True:
            message = await ws.recv()
            event = parse_nostr_event(message)

            if event.kind == 30078 and has_cid_tag(event):
                pin_request = PinRequest(cid=event.tags['cid'])
                pin_queue.enqueue(pin_request)
```

### 6.2 Rate-Limited Pin Queue

**File**: `nostr-pinner/nostr_pinner.py` (lines 280-403)

```python
class RateLimitedPinQueue:
    """Queue that processes pins at a controlled rate (MAX_PINS_PER_SECOND)."""

    def enqueue(self, pin_req: PinRequest) -> tuple[bool, str]:
        if not is_valid_cid(cid):
            return False, "invalid_format"
        if cid in self.pinned:
            return False, "already_pinned"
        if cid in self.in_queue:
            return False, "already_queued"

        self.queue.append(pin_req)
        return True, "queued"

    async def process_loop(self, shutdown_event):
        """Process queue at max MAX_PINS_PER_SECOND pins/second."""
        while not shutdown_event.is_set():
            pins_this_second = 0
            start = time.time()

            while self.queue and pins_this_second < MAX_PINS_PER_SECOND:
                pin_req = self.queue.popleft()
                success = await self._pin_cid(pin_req.cid)  # IPFS API call

                if success:
                    self.pinned.add(pin_req.cid)
                    self._store_pin(pin_req)  # SQLite insert
                    pins_this_second += 1

            # Sleep remainder of second
            await asyncio.sleep(max(0, 1.0 - (time.time() - start)))
```

**Features**:
- **Rate limiting**: Max 100 pins/second (configurable via `MAX_PINS_PER_SECOND`)
- **Deduplication**: Prevents duplicate pins in queue
- **Persistence**: Stores pinned CIDs in SQLite
- **Auto-retry**: Re-queues failed pins at end

### 6.3 IPNS Re-announcement Scheduler

**File**: `nostr-pinner/nostr_pinner.py` (lines 626-686)

```python
class ReannounceScheduler:
    """Random scheduler for periodic re-announcements."""

    async def run(self, shutdown_event):
        """Run scheduler loop with random probability trigger."""
        while not shutdown_event.is_set():
            await asyncio.sleep(1.0)

            # Random trigger check (default: ~1/hour probability)
            if random.random() < ANNOUNCE_PROBABILITY:
                await self._do_reannouncement()

    async def _do_reannouncement(self):
        """Perform re-announcement of all pins and IPNS records."""
        # Get all pinned CIDs from database
        cids = db.query("SELECT cid FROM pinned_cids LIMIT 100")

        # Get all IPNS records
        ipns_records = db.query("SELECT ipns_name, marshalled_record FROM ipns_records")

        # Republish IPNS records to Kubo DHT
        for ipns_name, record_bytes in ipns_records:
            await self.ipns_store.republish_record(ipns_name, record_bytes)

        # Publish Nostr announcement
        await self.publisher.publish_reannouncement(cids, ipns_names)
```

**Purpose**:
- **IPNS record freshness**: Re-publishes IPNS records to DHT to prevent expiry
- **Network propagation**: Broadcasts pins to Nostr relays for discovery
- **Probabilistic scheduling**: Avoids thundering herd (default: 1 announcement per hour avg)
- **Manual trigger**: HTTP endpoint `/reannounce` for on-demand re-publishing

---

## 7. API Endpoints

### 7.1 Sidecar HTTP Server

**Port**: 9081 (internal)
**Service**: `nostr-pinner.py` (lines 692-1032)

| Endpoint | Method | Purpose | Response Time |
|----------|--------|---------|---------------|
| `/routing-get` | GET/POST | Fast IPNS record lookup | 5-20ms (cache hit) |
| `/ipns-intercept` | POST | IPNS record capture (mirrored) | 10ms |
| `/pin-status` | GET | Check if CID is pinned | 5ms |
| `/health` | GET | Health check | <1ms |
| `/metrics` | GET | Service statistics | 10ms |
| `/reannounce` | POST | Manual re-announcement trigger | Async |

### 7.2 Example Usage

**Fast IPNS Lookup**:

```bash
curl 'http://localhost:9081/routing-get?arg=/ipns/k51qzi5uqu5...'
```

Response:
```json
{
  "Extra": "CKgBEkgvawAE...",  // Base64-encoded IPNS record
  "Type": 5
}
```

Headers:
```
X-IPNS-Source: sidecar-cache
X-IPNS-Sequence: 42
```

**Pin Status Check**:

```bash
curl 'http://localhost:9081/pin-status?cid=bafybeig...'
```

Response:
```json
{
  "pinned": true,
  "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "pinned_at": "2026-01-24 18:30:00",
  "source": "nostr"
}
```

**Service Metrics**:

```bash
curl http://localhost:9081/metrics
```

Response:
```json
{
  "status": "ok",
  "uptime_seconds": 86400,
  "node_name": "unicity-ipfs1.dyndns.org",
  "database": {
    "total_pinned_cids": 1523,
    "total_ipns_records": 42,
    "cid_announcements": 15,
    "ipns_announcements": 8
  },
  "session": {
    "cids_queued": 1523,
    "cids_pinned": 1500,
    "cids_rejected": 20,
    "cids_failed": 3,
    "ipns_records_stored": 42,
    "nostr_events_received": 1543,
    "reannouncements": 3
  }
}
```

---

## 8. Performance Characteristics

### 8.1 Latency Breakdown

| Operation | Cold (DHT) | Warm (Cache) | Speedup |
|-----------|------------|--------------|---------|
| IPNS resolution | 1-5 seconds | 5-20ms | **250x faster** |
| IPFS content fetch | 500ms-2s | 10-50ms | **50x faster** |
| Pin status check | 100-200ms | 5ms | **40x faster** |

### 8.2 Cache Hit Rates (Expected)

Based on typical wallet usage patterns:

| Content Type | Expected Hit Rate | Reasoning |
|--------------|------------------|-----------|
| IPNS records | 80-95% | User repeatedly syncs same nametag |
| Token CIDs | 60-80% | Tokens are immutable, fetched multiple times |
| Genesis proofs | 90-95% | Rarely change after initial sync |

### 8.3 Bandwidth Savings

**Without caching**:
- Every IPNS lookup: 1-5 second DHT query
- Token sync (10 tokens): 10-50 seconds

**With caching**:
- First lookup: 1-5 seconds (DHT query + cache store)
- Subsequent lookups: 5-20ms (SQLite query)
- Token sync (10 tokens, cached): 50-200ms

**Improvement**: **100-250x faster** for repeated operations

---

## 9. Cache Invalidation Strategy

### 9.1 IPNS Cache Invalidation

**Challenge**: IPNS records are mutable, cache may become stale

**Solution**: Multi-layered approach

1. **Short TTL** (30 seconds): Nginx HTTP cache expires quickly
2. **Sequence validation**: Sidecar always compares DB sequence vs Kubo sequence
3. **Cache bypass header**: Client can send `X-No-Cache: 1` to force fresh lookup
4. **Re-announcement**: Periodic re-publishing keeps DHT fresh

**Implementation** (from `_handle_routing_get`):

```python
# Query both sidecar AND Kubo
db_sequence = query_sidecar_db(ipns_name)
kubo_sequence = query_kubo_dht(ipns_name)

# Return record with highest sequence
if kubo_sequence > db_sequence:
    # Kubo has newer record - update cache and return it
    update_sidecar_cache(ipns_name, kubo_record)
    return kubo_record
else:
    # Cache is fresh or equal
    return db_record
```

**Key Insight**: The sidecar **doesn't blindly serve cached data**. It always checks Kubo for authoritative sequence number.

### 9.2 IPFS Content Cache

**No invalidation needed**:
- CIDs are **immutable** (content-addressed)
- Same CID = same content forever
- 7-day cache TTL is purely for disk space management
- Can safely cache indefinitely

---

## 10. Deployment Configuration

### 10.1 Environment Variables

**Kubo (IPFS) Configuration**:

```bash
IPFS_PROFILE=server                # Server-optimized profile
IPFS_LOGGING=info                  # Log level
DOMAIN=unicity-ipfs1.dyndns.org   # Domain for WSS announcements
```

**Sidecar Configuration**:

```bash
# Nostr relays for pin announcements
NOSTR_RELAYS=wss://nostr-relay.testnet.unicity.network,ws://...

# Rate limiting
MAX_PINS_PER_SECOND=100

# Database
DB_PATH=/data/ipfs/propagation.db

# Re-announcement scheduler
ANNOUNCE_INTERVAL=0                # 0 = use probability
ANNOUNCE_PROBABILITY=0.000277778   # ~1/hour (1/3600)

# Identity
NODE_NAME=unicity-ipfs1.dyndns.org
NOSTR_PRIVATE_KEY=<hex>            # For signing announcements
```

### 10.2 Production Deployment

**Docker Compose**:

```bash
cd /home/vrogojin/ipfs-storage

# Build image
make build

# Deploy with SSL certificates
make compose-up \
  SSL_CERT=/etc/letsencrypt/live/domain.com/fullchain.pem \
  SSL_KEY=/etc/letsencrypt/live/domain.com/privkey.pem \
  DOMAIN=unicity-ipfs1.dyndns.org
```

**HAProxy Mode** (behind reverse proxy):

```bash
# Join haproxy-net network (no public port 443)
make haproxy-up \
  SSL_CERT=/etc/letsencrypt/live/domain.com/fullchain.pem \
  SSL_KEY=/etc/letsencrypt/live/domain.com/privkey.pem \
  DOMAIN=unicity-ipfs1.dyndns.org
```

### 10.3 Performance Tuning

**Kubo Optimizations** (from `scripts/configure-ipfs.sh`):

```bash
# Accelerated DHT Client (CRITICAL for fast IPNS lookups)
ipfs config --json Routing.AcceleratedDHTClient true

# Increase IPNS cache size (in-memory cache in Kubo)
ipfs config --json Ipns.ResolveCacheSize 4096

# Enable gateway routing API exposure
ipfs config --json Gateway.ExposeRoutingAPI true

# Optimize datastore bloom filter for faster reads
ipfs config --json Datastore.BloomFilterSize 1048576
```

**Nginx Tuning**:

```nginx
# Cache size: 100MB metadata, 10GB content
proxy_cache_path /var/cache/nginx/ipfs keys_zone=ipfs_cache:100m max_size=10g;

# Worker connections
worker_connections 1024;
use epoll;
multi_accept on;
```

---

## 11. Monitoring & Observability

### 11.1 Key Metrics to Track

**Sidecar Metrics** (via `/metrics` endpoint):

```json
{
  "database": {
    "total_pinned_cids": 1523,      // Monitor: growth rate
    "total_ipns_records": 42,       // Monitor: should match active users
    "ipns_announcements": 8         // Monitor: successful re-publishes
  },
  "session": {
    "cids_pinned": 1500,            // Monitor: pin success rate
    "cids_failed": 3,               // Alert: high failure rate
    "ipns_records_stored": 42       // Monitor: storage growth
  }
}
```

**Nginx Cache Metrics** (via response headers):

```
X-Cache-Status: HIT           # Cache hit (fast)
X-Cache-Status: MISS          # Cache miss (slow, first time)
X-Cache-Status: STALE         # Serving stale cache (upstream error)
X-Cache-Status: UPDATING      # Background refresh
```

**IPNS Resolution Metrics** (via custom headers):

```
X-IPNS-Source: sidecar-cache  # Served from SQLite (5-20ms)
X-IPNS-Source: kubo           # Served from DHT (1-5s)
X-IPNS-Sequence: 42           # Current sequence number
```

### 11.2 Monitoring Commands

**Check cache hit rate**:

```bash
# View cache status distribution
make logs | grep "X-Cache-Status" | awk '{print $NF}' | sort | uniq -c
```

**Monitor IPNS fast-path usage**:

```bash
# Count sidecar hits vs Kubo fallbacks
make logs | grep "X-IPNS-Source" | awk '{print $NF}' | sort | uniq -c
```

**Database size**:

```bash
docker exec ipfs-kubo ls -lh /data/ipfs/propagation.db
```

**Pin queue depth**:

```bash
curl -s http://localhost:9081/metrics | jq '.session.cids_queued - .session.cids_pinned'
```

---

## 12. How to Leverage for Sub-Second IPNS Resolution

### 12.1 Current State

The infrastructure **already provides** sub-second IPNS resolution:

1. **First lookup** (cold): 1-5 seconds (DHT query)
2. **Subsequent lookups** (warm): 5-20ms (SQLite query)

**Speedup**: **250x faster** for cached records

### 12.2 Integration with Sphere App

**Recommended Changes**:

1. **Use routing API directly** instead of IPNS HTTP gateway:

```typescript
// BEFORE (slow, no sidecar benefit):
const url = `https://unicity-ipfs1.dyndns.org/ipns/${nametag}`;
const response = await fetch(url);

// AFTER (fast, uses sidecar):
const url = `https://unicity-ipfs1.dyndns.org/api/v0/routing/get?arg=/ipns/${nametag}`;
const response = await fetch(url);
const data = await response.json();
const record = base64Decode(data.Extra); // Raw IPNS record

// Check if served from cache
const source = response.headers.get('X-IPNS-Source');
const sequence = response.headers.get('X-IPNS-Sequence');
console.log(`IPNS resolution: ${source} (seq=${sequence})`);
```

2. **Cache bypass for critical operations**:

```typescript
// Force fresh lookup for nametag registration
const headers = {'X-No-Cache': '1'};
const response = await fetch(url, {headers});
```

3. **Monitor cache effectiveness**:

```typescript
// Track cache hit rate
const source = response.headers.get('X-IPNS-Source');
if (source === 'sidecar-cache') {
  metrics.ipnsCacheHits++;
} else if (source === 'kubo') {
  metrics.ipnsCacheMisses++;
}
```

### 12.3 Expected Performance

**Token sync flow**:

| Step | Current (no cache) | With sidecar cache | Improvement |
|------|-------------------|-------------------|-------------|
| 1. Resolve nametag IPNS | 1-5s | 5-20ms (warm) | **250x** |
| 2. Fetch IPNS CID content | 500ms-2s | 10-50ms (warm) | **50x** |
| 3. Fetch token CIDs (×10) | 5-20s | 100-500ms (warm) | **40x** |
| **Total** | **10-30s** | **200-600ms** | **50x** |

**Key Insight**: The first sync for a new user will still be slow (cold cache), but all subsequent syncs will be **nearly instant**.

---

## 13. Recommendations

### 13.1 Immediate Actions

1. **Update Sphere app to use routing API**:
   - Replace `/ipns/` HTTP gateway calls with `/api/v0/routing/get`
   - This enables sidecar fast-path for IPNS resolution

2. **Monitor sidecar metrics**:
   - Add dashboard for `X-IPNS-Source` header distribution
   - Alert on high Kubo fallback rate (indicates cache misses)

3. **Tune re-announcement interval**:
   - Current: ~1/hour probabilistic
   - Consider: Set `ANNOUNCE_INTERVAL=600` (10 minutes) for more frequent updates

### 13.2 Future Enhancements

1. **Preload popular nametags**:
   - Run background job to pre-populate sidecar cache with known nametags
   - Reduces cold-start latency for new users

2. **Distributed cache synchronization**:
   - Share SQLite database across multiple IPFS nodes
   - Improves cache hit rate in multi-node deployment

3. **Cache warming on publish**:
   - When user publishes IPNS record, immediately replicate to all nodes
   - Ensures instant resolution for other users

4. **IPNS sequence monitoring**:
   - Alert on sequence number anomalies (large jumps, rollbacks)
   - Detect potential replay attacks or data corruption

### 13.3 Operational Improvements

1. **Cache statistics dashboard**:
   - Visualize cache hit rates over time
   - Identify bottlenecks and optimization opportunities

2. **Automated cache preloading**:
   - Scrape Nostr relay for recent IPNS announcements
   - Pre-fetch and cache popular records

3. **Multi-region deployment**:
   - Deploy IPFS nodes with sidecar in multiple regions
   - Route users to nearest node for lowest latency

---

## 14. Security Considerations

### 14.1 IPNS Sequence Validation

**Threat**: Replay attacks or stale record injection

**Mitigation**:
- Sidecar only stores records with `sequence >= existing_sequence`
- Always queries Kubo for authoritative sequence
- Returns record with highest sequence number

**Code** (from `store_record`):

```python
if new_sequence < existing_sequence:
    logger.warning(f"Rejecting IPNS record: seq={new_sequence} < existing={existing_sequence}")
    return False  # Reject stale record
```

### 14.2 CID Verification Integrity

**Threat**: Content tampering or gzip-induced verification failure

**Mitigation**:
- Nginx `gzip off;` for `/ipfs/` and `/ipns/` endpoints
- Ensures byte-exact content delivery
- Client can verify SHA-256 hash matches CID

**Documentation**: See `/home/vrogojin/ipfs-storage/CID_VERIFICATION_FIX.md`

### 14.3 Nostr Relay Trust

**Threat**: Malicious pin announcements flooding the system

**Mitigation**:
- Rate-limited pin queue (100 pins/sec max)
- CID format validation before queuing
- Duplicate detection (already pinned)
- Failed pin retry with exponential backoff

**Code** (from `RateLimitedPinQueue`):

```python
if not is_valid_cid(cid):
    return False, "invalid_format"  # Reject malformed CIDs
if cid in self.pinned:
    return False, "already_pinned"  # Skip duplicates
```

---

## 15. Conclusion

### 15.1 Summary

The `/home/vrogojin/ipfs-storage` infrastructure provides a **production-grade, high-performance IPFS caching layer** with:

✅ **Two-tier caching**: Nginx HTTP cache + SQLite database
✅ **Sub-second IPNS resolution**: 5-20ms (250x faster than DHT)
✅ **Sequence validation**: Prevents stale record serving
✅ **Automatic republishing**: Keeps IPNS records fresh in DHT
✅ **Nostr integration**: Decentralized pin announcement
✅ **CID integrity**: Gzip disabled for verification
✅ **Fast-path routing**: Automatic fallback to DHT on cache miss

### 15.2 Key Metrics

| Metric | Value | Impact |
|--------|-------|--------|
| IPNS cache hit latency | 5-20ms | 250x faster than DHT |
| IPFS content cache hit | 10-50ms | 50x faster than bitswap |
| Cache hit rate (expected) | 80-95% | Reduces DHT load |
| Pin queue throughput | 100 pins/sec | Handles high announcement volume |

### 15.3 Next Steps

1. **Integrate routing API** in Sphere app (`IpfsHttpResolver.ts`)
2. **Monitor cache effectiveness** via `X-IPNS-Source` headers
3. **Tune re-announcement interval** based on actual usage patterns
4. **Deploy to production** and measure performance improvements

**Expected Result**: Token sync time reduced from **10-30 seconds** to **200-600ms** for warm cache.

---

## Appendix: File References

### Key Files

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `/home/vrogojin/ipfs-storage/config/nginx.conf.template` | Nginx caching configuration | 68 (cache_path), 99-122 (IPFS), 125-150 (IPNS), 248-287 (routing fast-path) |
| `/home/vrogojin/ipfs-storage/nostr-pinner/nostr_pinner.py` | Sidecar service implementation | 129-179 (DB schema), 416-459 (IPNS storage), 859-963 (routing-get), 715-766 (ipns-intercept) |
| `/home/vrogojin/ipfs-storage/scripts/configure-ipfs.sh` | Kubo performance tuning | 64-75 (DHT acceleration, IPNS cache) |
| `/home/vrogojin/ipfs-storage/docker-compose.yml` | Deployment configuration | 1-58 (all services) |
| `/home/vrogojin/ipfs-storage/Dockerfile` | Container build | 1-104 (supervisord, nginx, Python) |

### Documentation

| File | Purpose |
|------|---------|
| `/home/vrogojin/ipfs-storage/README.md` | Deployment guide |
| `/home/vrogojin/ipfs-storage/CID_VERIFICATION_FIX.md` | Gzip compression analysis |
| `/home/vrogojin/ipfs-storage/IMPLEMENTATION_SUMMARY.md` | CID fix deployment summary |
| `/home/vrogojin/ipfs-storage/DEPLOYMENT_QUICK_REFERENCE.md` | Quick deployment steps |

---

**Analysis Date**: 2026-01-24
**Analyst**: Claude Opus 4.5
**Status**: ✅ Complete - No code changes made (research only)
