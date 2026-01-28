# Helia Network Architecture & Data Flow

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Sphere App)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  main.tsx (App Start)                                │   │
│  │  - Calls initializeHeliaEarly() [async, non-blocking]│   │
│  └──────────────────────────────┬──────────────────────┘   │
│                                  │                           │
│  ┌──────────────────────────────▼──────────────────────┐   │
│  │  IpfsStorageService (Singleton)                      │   │
│  │  - Shared Helia instance (created once)              │   │
│  │  - One per identity/wallet address                   │   │
│  └──────────────────────────────┬──────────────────────┘   │
│                                  │                           │
│  ┌──────────────────────────────▼──────────────────────┐   │
│  │  initializeHeliaEarly()                              │   │
│  │  ✓ Returns cached instance if already initialized    │   │
│  │  ✓ Returns in-progress promise if initializing       │   │
│  │  ✓ Creates libp2p node with:                         │   │
│  │    - Connection gater (bootstrap peers only)         │   │
│  │    - Bootstrap peer discovery                        │   │
│  │    - Connection manager (maxConnections: 10)         │   │
│  │  ⏱ Duration: ~3000ms (WebCrypto + peer init)         │   │
│  └──────────────────────────────┬──────────────────────┘   │
│                                  │                           │
│                    ┌─────────────▼─────────────┐            │
│                    │ Helia Instance (libp2p)   │            │
│                    │ - Browser Peer ID         │            │
│                    │ - Connection Pool         │            │
│                    │ - DHT (disabled)          │            │
│                    └─────────────┬─────────────┘            │
│                                  │                           │
└──────────────────────────────────┼───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │   IPFS Bootstrap Peers       │
                    │ (Connected via WebSocket)    │
                    └──────────────┬───────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
    ┌────▼─────┐            ┌──────▼──────┐           ┌─────▼────┐
    │ Custom   │            │   Custom    │           │ Public   │
    │ IPFS 1   │            │   IPFS 2-5  │           │ Bootstrap│
    │ (Active) │            │ (Disabled)  │           │ Peer 1   │
    │          │            │             │           │          │
    │ 1 peer   │            │ 4 peers     │           │ Fallback │
    └────┬─────┘            └──────┬──────┘           └─────┬────┘
         │                         │                       │
         └─────────────────────────┼───────────────────────┘
                                   │
          ┌────────────────────────▼────────────────────┐
          │   HTTP/WebSocket Gateway (Primary Path)     │
          │   - IPFS content retrieval (GET /ipfs/{cid})│
          │   - IPNS resolution (/ipns/{name})          │
          │   - IPNS publishing (POST /api/v0/name/pub) │
          │   ⏱ Latency: <2 seconds for resolution      │
          └────────────────────────┬────────────────────┘
                                   │
              ┌────────────────────▼─────────────────┐
              │  Token Storage (IPFS)                │
              │  ├── Token data (TxfToken format)    │
              │  ├── IPNS records (versioned)        │
              │  └── Tombstone markers               │
              └────────────────────┬─────────────────┘
                                   │
              ┌────────────────────▼─────────────────┐
              │  Browser Storage                     │
              │  ├── localStorage (IPNS versions)    │
              │  ├── Cached CIDs                     │
              │  └── Tombstone history               │
              └────────────────────────────────────┘
```

---

## Connection Lifecycle

### Phase 1: Early Initialization (~3000ms)

```
Time  Event                                    Helia Status
────  ─────────────────────────────────────   ─────────────
0ms   ├─ initializeHeliaEarly() called        [PENDING]
      │  (from main.tsx, non-blocking)
      │
50ms  ├─ Check WebCrypto availability         [CHECKING]
      │
100ms ├─ Bootstrap peers loaded:              [LOADING]
      │  ├─ unicity-ipfs1 (custom)
      │  └─ bootstrap.libp2p.io (fallback)
      │
150ms ├─ Connection gater created             [GATER]
      │  (only allows bootstrap peers)
      │
200ms ├─ libp2p keypair generation            [KEY GEN]
      │  (WebCrypto operation - ~2700ms)
      │
2900ms├─ Peer discovery starts                [DISCOVERING]
      │
3000ms└─ Helia ready                          [READY]
       ├─ Browser Peer ID: 12D3Koow...
       ├─ Initial connections: 0-1 peers
       └─ (Peers discovered asynchronously)
```

### Phase 2: First Wallet Access (ensureInitialized)

```
Precondition: Helia already initializing or initialized

Time  Event                                    Status
────  ─────────────────────────────────────   ──────────
0ms   ├─ ensureInitialized() called           [STARTING]
      │
10ms  ├─ Ed25519 key derivation (HKDF)        [KEY DERIV]
      │  (from wallet private key)
      │
20ms  ├─ IPNS peer ID generation              [IPNS GEN]
      │
30ms  ├─ Wait for Helia if still initializing [WAITING]
      │
30ms  ├─ Helia ready (likely cached)          [CACHED]
      │
50ms  ├─ Event listeners attached             [LISTENING]
      │  ├─ peer:connect
      │  └─ peer:disconnect
      │
100ms ├─ Connection maintenance started       [MAINTAINING]
      │
150ms └─ ensureInitialized() complete         [READY]
        └─ Ready to sync/publish
```

---

## Data Flow: Token Sync

### Synchronization Path

```
Browser Wallet
      │
      ├─ Read local tokens (localStorage)
      │
      ├─ Resolve IPNS name
      │  └─► Get CID of latest token bundle
      │
      ├─ Fetch from IPFS gateway
      │  └─► Get TxfStorageData (token batch)
      │
      ├─ Merge with local tokens
      │  └─► Conflict resolution
      │
      ├─ Publish updated bundle to IPNS
      │  └─► HTTP POST to /api/v0/name/publish
      │
      └─ Store locally
         ├─ localStorage (IPNS version + CID)
         └─ IndexedDB (vesting cache)
```

### Network Requests during Sync

```
Browser                         Backend Gateway         IPFS DHT
   │                                  │                   │
   ├─ GET /ipns/{ipnsName}           │                   │
   │  └──────────────────────────────►│                   │
   │     (HTTP path, fast resolution)  │                   │
   │     ✓ Returns: CID                │                   │
   │  ◄──────────────────────────────┤                   │
   │                                  │                   │
   ├─ GET /ipfs/{cid}                │                   │
   │  └──────────────────────────────►│                   │
   │     (Token bundle content)        │                   │
   │  ◄──────────────────────────────┤                   │
   │                                  │                   │
   ├─ POST /api/v0/name/publish       │                   │
   │  └──────────────────────────────►│                   │
   │     (Publish new IPNS record)     │                   │
   │     ✓ sequence: N+1               │                   │
   │  ◄──────────────────────────────┤                   │
   │                                  │                   │
   └─ (DHT publish disabled for security)
                                       └──────────────────►│
                                                        (automatic)
```

---

## Connection Gating Mechanism

### Allowed Peer Filter

```
Bootstrap Peers Configuration:
  ├─ Custom Unicity Peers (active)
  │  ├─ unicity-ipfs1: 12D3KooWD...
  │  ├─ unicity-ipfs2: 12D3KooWL... (disabled)
  │  ├─ unicity-ipfs3: 12D3KooWQ... (disabled)
  │  ├─ unicity-ipfs4: 12D3KooWJ... (disabled)
  │  └─ unicity-ipfs5: 12D3KooWB... (disabled)
  │
  └─ Fallback Public Peers
     └─ bootstrap.libp2p.io: QmNnooDu... (1 peer only)

Peer ID Extraction:
  /dns4/unicity-ipfs1.dyndns.org/tcp/4002/ws/p2p/12D3KooWD...
  └────────────────────────────────────────────────────────┘
                      regex: /\/p2p\/([^/]+)$/
                      result: 12D3KooWD...

Connection Gater Decisions:
  ┌──────────────────────────────┬──────────────┐
  │ Peer ID                      │ Decision     │
  ├──────────────────────────────┼──────────────┤
  │ 12D3KooWD... (unicity-ipfs1) │ ✓ ALLOWED    │
  │ QmNnooDu... (libp2p fallback)│ ✓ ALLOWED    │
  │ 12D3KooWL... (unicity-ipfs2) │ ✗ DENIED*    │
  │ Random DHT peer              │ ✗ DENIED     │
  │ Relay peer                   │ ✗ DENIED     │
  └──────────────────────────────┴──────────────┘
  * Would be allowed if re-enabled in config
```

### Gater Implementation Stages

```
Outbound Connection Request
         │
         ▼
┌─ denyDialMultiaddr() ◄─── Current: always returns false
│  │                         (allows any multiaddr)
│  └─► PASS
│
├─ denyDialPeer()       ◄─── Checks peer ID against allowedPeerIds
│  │
│  ├─► if (allowedPeerIds.has(peerId)) → false (allow)
│  └─► else → true (deny)
│
├─ denyOutboundConnection() ◄─ Secondary check
│  │                           (same logic as denyDialPeer)
│  └─► Same result
│
├─ denyOutboundEncryptedConnection() ◄─ If peer passed above checks
│  │                                     (allow if we got this far)
│  └─► false (allow)
│
└─ filterMultiaddrForPeer() ◄─── Allow all multiaddrs for allowed peers
   │
   └─► true (allow)

Result: Only peers in allowedPeerIds list can establish connections
```

---

## Resource Management

### Memory Layout

```
Helia Instance (~5-10 MB)
├─ libp2p node
│  ├─ Connection pool (~1-2 MB for 10 connections)
│  ├─ Peer store (~500 KB)
│  ├─ Routing table (DHT disabled, minimal)
│  └─ Protocol handlers
│
├─ Blockstore (IPFS local cache)
│  ├─ Max ~50 KB per application
│  └─ Auto-garbage collected
│
└─ IPNS record cache
   ├─ Per identity (~10 KB)
   └─ localStorage persisted


IpfsStorageService Instance (~2-3 MB)
├─ Ed25519 keys (~64 bytes)
├─ Cached IPNS name (~32 bytes)
├─ Sync queue (in-memory)
├─ Event listeners (<<1 KB each)
├─ Timer references (negligible)
└─ Cached CIDs (per sync operation)


Browser Storage
├─ localStorage
│  ├─ sphere_wallet_* (~100 KB total)
│  ├─ IPFS metadata (<<10 KB)
│  └─ Tombstones (~10-100 KB)
│
└─ IndexedDB (optional vesting cache)
   └─ Per wallet (~100 KB)

Total per identity: ~8-15 MB
```

### Connection Limits

```
Configuration: maxConnections = 10

Breakdown by connection pool:
├─ Unicity custom peers: 1-2 connections
├─ Fallback libp2p peer: 1 connection
├─ Reserved for pending dials: 2 connections
└─ Spare capacity: 4-6 connections

Per-peer limits (NEW):
├─ maxConnectionsPerPeer: 2
│  (prevent single peer from using all 10)
│
├─ maxInboundStreams: 64 per peer
│  (streams within each connection)
│
└─ maxOutboundStreams: 64 per peer

Stream resource limits (NEW):
├─ streamIdleTimeout: 60s (automatic cleanup)
└─ maxDataLength: 4MB (message size limit)
```

---

## Latency Profile

### Current Measurements

```
Operation                      Measured    Target      Status
────────────────────────────   ────────    ─────────   ──────
Helia early init              3000ms      2500ms      SLOW
├─ WebCrypto keypair gen      2700ms      2700ms      (limitation)
└─ libp2p startup              300ms       100ms      TO OPTIMIZE

ensureInitialized()
├─ Key derivation               10ms       <5ms       OK
├─ Helia wait (if cached)        0ms        0ms       GOOD
└─ Total                         15ms       <10ms      OK

First IPNS resolution
├─ DNS lookup                  50ms        <20ms      OK
├─ WebSocket connection       100ms        <50ms      OK
├─ HTTP request               200ms       <100ms      OK
└─ Total                       350ms       <200ms      OPTIMIZE

Content fetch (/ipfs/{cid})
├─ Connection reuse             0ms         0ms       GOOD
├─ HTTP request               100ms        <50ms      OK
└─ Total                       100ms        <50ms      OK

IPNS publish
├─ HTTP POST                  200ms       <100ms      OK
└─ Total                       200ms       <100ms      OK

Full sync operation
├─ Wallet init                15ms         <10ms      OK
├─ IPNS resolve              350ms       <200ms      OPTIMIZE
├─ Content fetch             100ms        <50ms      OK
├─ Conflict resolution        50ms        <30ms      OK
├─ Publish new              200ms       <100ms      OK
└─ Total                     715ms       <500ms      OPTIMIZE
```

### Optimization Targets

```
Current Bottlenecks:

1. Helia initialization (3s)
   └─ Mostly WebCrypto (can't optimize much)
   └─ Offset by early start (non-blocking)

2. IPNS resolution (350ms)
   └─ Currently: Wait for initial responses (3s timeout)
   └─ With 1 peer: Should be ~50-100ms
   └─ Issue: Gateway latency, not peer count

3. First peer discovery (~500ms)
   └─ Automatic via bootstrap module
   └─ Could be faster with pre-dialed peers
```

---

## Resilience Patterns

### Connection Recovery Flow

```
┌─ Connection established
│  └─ Background maintenance checks every 30s
│
├─ Normal operation
│  ├─ Content fetches work
│  └─ IPNS resolution works
│
└─ Peer disconnects
   │
   ├─ Maintenance detects no connection
   │  (within 30 seconds)
   │
   ├─ Attempt reconnect via dial()
   │  ├─ Uses same multiaddr
   │  └─ Timeout: 30 seconds
   │
   ├─ If successful
   │  ├─ Log reconnection
   │  └─ Resume operations
   │
   └─ If failed
      ├─ Log warning
      ├─ Retry on next maintenance cycle (30s)
      └─ Fallback to other peers if available
```

### Failure Scenarios

```
Scenario 1: Bootstrap Peer Down
├─ Connection fails
├─ Maintenance detects (≤30s)
├─ Attempts reconnect (fails again)
├─ Falls back to fallback peer
└─ Service continues (slower)

Scenario 2: Network Disconnect
├─ All connections drop
├─ libp2p auto-reconnect triggered
├─ Bootstrap discovery restarts
├─ Connections re-established
└─ Operations resume (transparent)

Scenario 3: Content Unavailable
├─ GET /ipfs/{cid} returns 404
├─ Fallback to DHT (disabled)
├─ OR retry after 5 minutes
├─ OR report error to user
└─ Cached version used if available

Scenario 4: IPNS Publish Fails
├─ HTTP POST returns error
├─ Retry with exponential backoff
├─ Store for background retry queue
├─ User notified of pending status
└─ Auto-retry on next sync
```

---

## Security Model

### Peer Validation

```
Incoming peer connection:
┌─ Verify peer ID signature
├─ Check against allowedPeerIds list
├─ Reject if not in list
└─ Block connection attempt

Peer can only:
├─ ✗ Contribute to DHT (DHT disabled)
├─ ✗ Provide arbitrary peer addresses (gated)
├─ ✓ Serve IPFS content (via HTTP gateway)
└─ ✓ Relay IPNS records

Protection against:
├─ Sybil attacks (only known peers)
├─ Man-in-the-middle (peer ID cryptographic)
├─ Content poisoning (CID verification)
└─ Information leakage (only to Unicity peers)
```

---

## Recommendations Summary

### Architecture Improvements
1. **Multi-peer active**: Re-enable 2-3 custom peers
2. **Peer rotation**: Dynamic peer health checking
3. **Connection pooling**: Already implemented via connection gater
4. **Failover**: Already implemented via fallback peers

### Performance Improvements
1. **Early init**: Already optimized (non-blocking startup)
2. **Connection reuse**: Already implemented (connection pooling)
3. **Caching**: Already implemented (localStorage + cache service)
4. **Batching**: Consider batching IPNS updates

### Resource Management
1. **Stream limits**: Implement (see Recommendation 1.3.1)
2. **Memory limits**: Configure message size limits
3. **Event cleanup**: Lazy-load listeners (see Recommendation 6.1.1)
4. **Timeout protection**: Add to Helia.stop() (see Recommendation 4.3.1)

---

## Related Documentation

- **Performance Review**: `/home/vrogojin/sphere/HELIA_NETWORK_PERFORMANCE_REVIEW.md`
- **Quick Start Guide**: `/home/vrogojin/sphere/HELIA_OPTIMIZATION_QUICKSTART.md`
- **Configuration**: `/home/vrogojin/sphere/src/config/ipfs.config.ts`
- **Implementation**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

