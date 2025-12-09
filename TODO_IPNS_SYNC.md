# IPNS Sync Architecture - Comprehensive TODO

This document describes the current IPNS synchronization implementation, known issues, completed fixes, and potential improvements for real-time sync.

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [Completed Fixes](#completed-fixes)
3. [Remaining Issues](#remaining-issues)
4. [Real-Time Sync Options](#real-time-sync-options)
5. [Implementation Recommendations](#implementation-recommendations)

---

## Current Architecture

### How IPNS Sync Works Today

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Browser A     │         │  IPFS Backend   │         │   Browser B     │
│   (Helia)       │         │  (Kubo nodes)   │         │   (Helia)       │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ 1. PUT /ipns (HTTP)       │                           │
         │ ─────────────────────────>│                           │
         │                           │                           │
         │ 2. Also publish via DHT   │                           │
         │ ─────────────────────────>│                           │
         │                           │                           │
         │                           │    3. Poll GET /ipns      │
         │                           │<──────────────────────────│
         │                           │                           │
         │                           │    4. Return IPNS record  │
         │                           │──────────────────────────>│
         │                           │                           │
         │                           │    5. Fetch CID content   │
         │                           │<──────────────────────────│
         │                           │                           │
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `IpfsStorageService` | `src/components/wallet/L3/services/IpfsStorageService.ts` | Main sync orchestrator |
| `ConflictResolutionService` | `src/components/wallet/L3/services/ConflictResolutionService.ts` | Merges conflicting token versions |
| `TokenValidationService` | `src/components/wallet/L3/services/TokenValidationService.ts` | Validates tokens against Unicity |
| `TokenBackupService` | `src/components/wallet/L3/services/TokenBackupService.ts` | Encrypted local backup |
| `SyncCoordinator` | `src/components/wallet/L3/services/SyncCoordinator.ts` | Cross-tab coordination |
| `TxfSerializer` | `src/components/wallet/L3/services/TxfSerializer.ts` | Token ↔ TXF format conversion |

### Polling Configuration

```typescript
const IPNS_RESOLUTION_CONFIG = {
  pollingIntervalMinMs: 30000,   // 30 seconds minimum
  pollingIntervalMaxMs: 60000,   // 60 seconds maximum (with jitter)
  initialTimeoutMs: 5000,        // Wait 5s for gateway responses
};
```

### IPNS Publishing Flow

1. **Dual Publishing**: Publishes to both HTTP backend API and browser DHT
2. **Sequence Number**: Uses `max(local, remote) + 1` to prevent conflicts
3. **Version Counter**: Stored in localStorage, incremented on each sync
4. **Tombstones**: Track deleted token states to prevent resurrection

### IPNS Resolution Flow

1. **Progressive Resolution**: Queries all backend gateways in parallel
2. **Best Result Selection**: Chooses highest sequence number
3. **Late Response Handling**: Continues listening for higher sequences after initial timeout
4. **CID Comparison**: Also syncs when CID differs at same sequence (race condition fix)

---

## Completed Fixes

### CRITICAL-1: Fork Resolution Prioritizes Committed Over Pending ✅

**Problem**: Token with 3 pending transactions beat token with 1 committed transaction.

**Fix**: `compareTokenVersions()` now counts COMMITTED transactions only.

```typescript
// Committed transactions ALWAYS beat pending
const localCommitted = countCommitted(localTxf);
const remoteCommitted = countCommitted(remoteTxf);
if (localCommitted > 0 && remoteCommitted === 0) return "local";
```

### CRITICAL-2: Pending Transactions Invalidation ✅

**Problem**: Pending transactions retry forever even if source state is spent.

**Fix**: `isPendingTransactionSubmittable()` checks if source state is still spendable.

### CRITICAL-3: Split Token Validation ✅

**Problem**: Split tokens appear valid even if parent burn was rejected.

**Fix**: `validateSplitTokens()` verifies burn transaction was committed.

### CRITICAL-4: Token Backup Service ✅

**Problem**: No recovery path for lost tokens (Unicity stores only hashes).

**Fix**: Added `TokenBackupService` with AES-256-GCM encrypted backups.

### Sync Scheduling Bug ✅

**Problem**: Tokens added during sync were lost (scheduleSync returned early).

**Fix**: Added `pendingSync` flag to retry sync after completion.

### IPNS CID Mismatch Detection ✅

**Problem**: Polling only checked sequence numbers, missed CID differences.

**Fix**: Also trigger sync when `remoteCID !== localCID` at same sequence.

---

## Remaining Issues

### HIGH-1: Version Counter Race Conditions

**Problem**: Two devices can get same version number simultaneously using localStorage increment.

**Potential Fix**: Use Unicity block numbers from inclusion proof certificates as version numbers. These are globally ordered and deterministic.

```typescript
// From inclusionProof.unicityCertificate
const blockNumber = txf.genesis.inclusionProof.unicityCertificate.inputRecord.roundNumber;
```

**Status**: Not yet implemented.

### MEDIUM-1: Polling Latency

**Problem**: 30-60 second polling interval means up to 1 minute delay for sync.

**Impact**: Poor UX for multi-device scenarios where user expects instant sync.

**Solution**: See [Real-Time Sync Options](#real-time-sync-options) below.

### MEDIUM-2: No Offline Queue

**Problem**: If sync fails (network down), changes may be lost.

**Potential Fix**: Queue failed syncs in IndexedDB and retry on reconnection.

### LOW-1: Gateway Failure Handling

**Problem**: If all backend gateways are down, no fallback to public IPFS.

**Current Mitigation**: Browser DHT publishing provides some redundancy.

---

## Real-Time Sync Options

### Option 1: IPNS over PubSub (Native IPFS)

IPFS supports publishing IPNS records via gossipsub for instant propagation.

**Architecture**:
```
┌─────────────────┐    pubsub     ┌─────────────────┐    pubsub     ┌─────────────────┐
│   Browser A     │──────────────>│  IPFS Backend   │──────────────>│   Browser B     │
│   (gossipsub)   │<──────────────│  (gossipsub)    │<──────────────│   (gossipsub)   │
└─────────────────┘               └─────────────────┘               └─────────────────┘
```

**Helia Configuration**:
```typescript
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { ipns } from "@helia/ipns";
import { pubsub } from "@helia/ipns/routing";

this.helia = await createHelia({
  libp2p: {
    services: {
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: false,
      }),
    },
    // ... existing config
  },
});

// Create IPNS with pubsub routing
const ipnsService = ipns(this.helia, {
  routers: [
    pubsub(this.helia),  // Real-time via pubsub
    dht(this.helia),     // Fallback via DHT
  ],
});
```

**Backend Kubo Configuration**:
```bash
# Enable pubsub experiment
ipfs config --json Pubsub.Enabled true
ipfs config --json Ipns.UsePubsub true

# Or via environment
IPFS_PUBSUB=true ipfs daemon
```

**Pros**:
- Native IPFS feature, well-integrated
- Works with existing IPNS infrastructure
- Automatic fallback to DHT

**Cons**:
- Requires pubsub-enabled nodes (not all public nodes support it)
- Browser WebRTC limitations (needs relay nodes for mesh)
- Gossipsub has 1-2 second propagation delay
- Backend Kubo nodes need configuration changes

**Effort**: Medium (2-3 days)

---

### Option 2: Custom PubSub Channel

Create a dedicated gossipsub topic for wallet sync notifications.

**Architecture**:
```
Browser A                    IPFS Network                    Browser B
    │                             │                              │
    │ publish("wallet-sync-XXX")  │                              │
    │────────────────────────────>│                              │
    │                             │  gossip propagation          │
    │                             │─────────────────────────────>│
    │                             │                              │
    │                             │   subscribe("wallet-sync-XXX")
    │                             │<─────────────────────────────│
```

**Implementation**:
```typescript
// Notification message format
interface SyncNotification {
  ipnsName: string;
  cid: string;
  sequence: bigint;
  version: number;
  timestamp: number;
  publisherPeerId: string;
}

// Publisher
async notifyPeers(cid: string, seq: bigint): Promise<void> {
  const topic = `unicity-wallet-sync-${this.cachedIpnsName}`;
  const message: SyncNotification = {
    ipnsName: this.cachedIpnsName!,
    cid,
    sequence: seq,
    version: this.getVersionCounter(),
    timestamp: Date.now(),
    publisherPeerId: this.helia!.libp2p.peerId.toString(),
  };

  await this.helia!.libp2p.services.pubsub.publish(
    topic,
    new TextEncoder().encode(JSON.stringify(message))
  );
}

// Subscriber
subscribeToSyncNotifications(): void {
  const topic = `unicity-wallet-sync-${this.cachedIpnsName}`;

  this.helia!.libp2p.services.pubsub.subscribe(topic);

  this.helia!.libp2p.services.pubsub.addEventListener("message", (event) => {
    if (event.detail.topic !== topic) return;

    const notification = JSON.parse(
      new TextDecoder().decode(event.detail.data)
    ) as SyncNotification;

    // Ignore our own messages
    if (notification.publisherPeerId === this.helia!.libp2p.peerId.toString()) {
      return;
    }

    // Trigger sync if newer
    if (notification.sequence > this.ipnsSequenceNumber ||
        notification.cid !== this.getLastCid()) {
      this.handleHigherSequenceDiscovered({
        cid: notification.cid,
        sequence: notification.sequence,
        gateway: "pubsub",
        recordData: new Uint8Array(),
      });
    }
  });
}
```

**Pros**:
- More flexible than IPNS pubsub
- Can include custom metadata (version, timestamp)
- Doesn't require IPNS pubsub support on nodes

**Cons**:
- Same WebRTC/relay limitations as Option 1
- Need to maintain subscription across reconnections
- Topic discovery requires knowing IPNS name

**Effort**: Medium (2-3 days)

---

### Option 3: WebSocket from Backend

Backend IPFS nodes watch IPNS and push notifications via WebSocket.

**Architecture**:
```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Browser A     │         │  IPFS Backend   │         │   Browser B     │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ 1. Publish IPNS           │                           │
         │ ─────────────────────────>│                           │
         │                           │                           │
         │                           │ 2. Detect IPNS change     │
         │                           │ (internal watcher)        │
         │                           │                           │
         │                           │ 3. Push via WebSocket     │
         │                           │──────────────────────────>│
         │                           │                           │
         │                           │ 4. Browser triggers sync  │
         │                           │                           │
```

**Backend Service** (Node.js example):
```typescript
// Backend: ipns-watcher.ts
import WebSocket from "ws";
import { create } from "kubo-rpc-client";

const ipfs = create({ url: "http://localhost:5001" });
const wss = new WebSocket.Server({ port: 8080 });

// Track subscriptions: ipnsName -> Set<WebSocket>
const subscriptions = new Map<string, Set<WebSocket>>();

// Watch IPNS names for changes
async function watchIpns(ipnsName: string): Promise<void> {
  let lastCid: string | null = null;

  setInterval(async () => {
    try {
      const result = await ipfs.name.resolve(ipnsName, { timeout: 5000 });
      const cid = result.toString();

      if (cid !== lastCid) {
        lastCid = cid;
        notifySubscribers(ipnsName, cid);
      }
    } catch (err) {
      console.error(`Failed to resolve ${ipnsName}:`, err);
    }
  }, 5000); // Check every 5 seconds
}

function notifySubscribers(ipnsName: string, cid: string): void {
  const subs = subscriptions.get(ipnsName);
  if (!subs) return;

  const message = JSON.stringify({ type: "ipns-update", ipnsName, cid });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

// Handle WebSocket connections
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "subscribe") {
      const ipnsName = msg.ipnsName;
      if (!subscriptions.has(ipnsName)) {
        subscriptions.set(ipnsName, new Set());
        watchIpns(ipnsName);
      }
      subscriptions.get(ipnsName)!.add(ws);
    }
  });

  ws.on("close", () => {
    // Remove from all subscriptions
    for (const subs of subscriptions.values()) {
      subs.delete(ws);
    }
  });
});
```

**Browser Client**:
```typescript
// Browser: IpfsStorageService.ts addition
private ws: WebSocket | null = null;

private connectWebSocket(): void {
  const wsUrl = "wss://unicity-ipfs1.dyndns.org/ws/ipns";
  this.ws = new WebSocket(wsUrl);

  this.ws.onopen = () => {
    console.log("📦 WebSocket connected for IPNS updates");
    this.ws!.send(JSON.stringify({
      type: "subscribe",
      ipnsName: this.cachedIpnsName,
    }));
  };

  this.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ipns-update" && msg.ipnsName === this.cachedIpnsName) {
      console.log(`📦 WebSocket: IPNS update received, cid=${msg.cid.slice(0, 16)}...`);

      if (msg.cid !== this.getLastCid()) {
        this.handleHigherSequenceDiscovered({
          cid: msg.cid,
          sequence: 0n, // Will be resolved during fetch
          gateway: "websocket",
          recordData: new Uint8Array(),
        });
      }
    }
  };

  this.ws.onclose = () => {
    console.log("📦 WebSocket disconnected, reconnecting in 5s...");
    setTimeout(() => this.connectWebSocket(), 5000);
  };

  this.ws.onerror = (err) => {
    console.error("📦 WebSocket error:", err);
  };
}
```

**Pros**:
- Works reliably in all browsers (no WebRTC issues)
- Low latency (sub-second notifications)
- Backend can aggregate watches efficiently
- Fallback to polling if WebSocket fails
- No changes needed to Kubo configuration

**Cons**:
- Requires new backend service
- WebSocket connection management (reconnection, heartbeat)
- Centralized dependency (though can have multiple WS endpoints)

**Effort**: Medium-High (3-5 days including backend)

---

### Option 4: Server-Sent Events (SSE)

Similar to WebSocket but simpler, one-way communication.

**Architecture**:
```
Browser ──────────────────────> Backend
         GET /sse/ipns/:name
         (long-lived connection)

         <──────────────────────
         event: ipns-update
         data: {"cid": "..."}
```

**Backend** (Express example):
```typescript
app.get("/sse/ipns/:name", (req, res) => {
  const ipnsName = req.params.name;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Add to watchers
  const watcher = (cid: string) => {
    res.write(`event: ipns-update\n`);
    res.write(`data: ${JSON.stringify({ cid })}\n\n`);
  };

  ipnsWatchers.get(ipnsName)?.add(watcher);

  req.on("close", () => {
    ipnsWatchers.get(ipnsName)?.delete(watcher);
  });
});
```

**Browser**:
```typescript
private connectSSE(): void {
  const url = `https://unicity-ipfs1.dyndns.org/sse/ipns/${this.cachedIpnsName}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener("ipns-update", (event) => {
    const { cid } = JSON.parse(event.data);
    if (cid !== this.getLastCid()) {
      this.triggerSync();
    }
  });

  eventSource.onerror = () => {
    eventSource.close();
    setTimeout(() => this.connectSSE(), 5000);
  };
}
```

**Pros**:
- Simpler than WebSocket (built-in reconnection)
- Works through most proxies/firewalls
- Native browser support (`EventSource`)

**Cons**:
- One-way only (fine for notifications)
- Some older proxies may buffer responses
- Same backend dependency as WebSocket

**Effort**: Low-Medium (2-3 days)

---

### Option 5: Nostr-Based Sync Notifications

Use existing Nostr infrastructure for sync notifications.

**Architecture**:
```
Browser A                    Nostr Relays                    Browser B
    │                             │                              │
    │ publish sync event          │                              │
    │────────────────────────────>│                              │
    │                             │────────────────────────────>│
    │                             │   subscribe to sync events   │
    │                             │                              │
```

**Implementation**:
```typescript
// Use existing NostrService
async publishSyncNotification(cid: string, seq: bigint): Promise<void> {
  const event = {
    kind: 30078, // Application-specific data
    content: JSON.stringify({
      type: "ipns-sync",
      ipnsName: this.cachedIpnsName,
      cid,
      sequence: seq.toString(),
      timestamp: Date.now(),
    }),
    tags: [
      ["d", `ipns-sync-${this.cachedIpnsName}`],
      ["t", "unicity-wallet-sync"],
    ],
  };

  await nostrService.publishEvent(event);
}

// Subscribe to sync notifications
subscribeToSyncEvents(): void {
  nostrService.subscribe({
    kinds: [30078],
    "#d": [`ipns-sync-${this.cachedIpnsName}`],
  }, (event) => {
    const { cid, sequence } = JSON.parse(event.content);
    if (cid !== this.getLastCid()) {
      this.triggerSync();
    }
  });
}
```

**Pros**:
- Uses existing Nostr infrastructure (already in app)
- Decentralized (multiple relays)
- Works well in browsers
- No new backend service needed

**Cons**:
- Nostr relay latency (typically 100-500ms)
- Relies on relay availability
- Additional Nostr traffic

**Effort**: Low (1-2 days, uses existing NostrService)

---

### Option 6: Hybrid Approach (Recommended)

Combine multiple methods for maximum reliability:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Sync Notification Layer                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐               │
│   │   Nostr     │   │  WebSocket  │   │   Polling   │               │
│   │  (primary)  │   │ (secondary) │   │ (fallback)  │               │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘               │
│          │                 │                 │                       │
│          └────────────────┴────────────────┘                       │
│                            │                                         │
│                     ┌──────▼──────┐                                 │
│                     │ Deduplicator │                                 │
│                     │ (by CID)     │                                 │
│                     └──────┬──────┘                                 │
│                            │                                         │
│                     ┌──────▼──────┐                                 │
│                     │ Sync Engine │                                 │
│                     └─────────────┘                                 │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Implementation**:
```typescript
class SyncNotificationManager {
  private lastProcessedCid: string | null = null;
  private notificationSources = new Map<string, boolean>();

  async initialize(): Promise<void> {
    // 1. Primary: Nostr (already available)
    this.setupNostrNotifications();
    this.notificationSources.set("nostr", true);

    // 2. Secondary: WebSocket (if backend supports)
    try {
      await this.setupWebSocketNotifications();
      this.notificationSources.set("websocket", true);
    } catch {
      console.log("📦 WebSocket not available, using Nostr + polling");
    }

    // 3. Fallback: Polling (always enabled, but less frequent if others work)
    this.setupPolling();
  }

  private handleNotification(source: string, cid: string): void {
    // Deduplicate by CID
    if (cid === this.lastProcessedCid) {
      console.log(`📦 Ignoring duplicate notification from ${source}`);
      return;
    }

    this.lastProcessedCid = cid;
    console.log(`📦 Sync notification from ${source}: ${cid.slice(0, 16)}...`);

    // Trigger sync
    this.storageService.triggerSync();
  }

  private getPollingInterval(): number {
    // Longer interval if real-time sources are working
    const hasRealtime =
      this.notificationSources.get("nostr") ||
      this.notificationSources.get("websocket");

    return hasRealtime ? 120000 : 30000; // 2 min vs 30 sec
  }
}
```

**Pros**:
- Multiple redundant notification paths
- Graceful degradation
- Best of all worlds

**Cons**:
- More complex implementation
- Need to handle deduplication

**Effort**: Medium (3-4 days)

---

## Implementation Recommendations

### Phase 1: Quick Wins (1-2 days)

1. **Add Nostr sync notifications** (Option 5)
   - Uses existing infrastructure
   - Minimal code changes
   - Reduces polling frequency

2. **Reduce polling interval when Nostr is working**
   - Dynamic interval based on notification source health

### Phase 2: Backend Enhancement (3-5 days)

1. **Add SSE or WebSocket endpoint to backend**
   - Watch IPNS changes server-side
   - Push to connected browsers
   - More reliable than browser-to-browser pubsub

2. **Implement hybrid approach** (Option 6)
   - Nostr + WebSocket + polling
   - Automatic fallback

### Phase 3: Full P2P (Optional, 5-7 days)

1. **Enable IPFS pubsub** (Option 1)
   - Configure Kubo nodes
   - Add gossipsub to Helia
   - Full decentralization

---

## Metrics to Track

| Metric | Target | Current |
|--------|--------|---------|
| Sync latency (same device) | < 1s | ~100ms |
| Sync latency (cross-device) | < 5s | 30-60s (polling) |
| Sync success rate | > 99% | ~95% |
| Token loss rate | 0% | ~0% (after fixes) |
| Conflict resolution accuracy | 100% | 100% |

---

## Testing Checklist

- [ ] Two browsers, same wallet, alternating token operations
- [ ] Offline device rejoins after other device made changes
- [ ] Simultaneous token operations on both devices
- [ ] Token split on one device, transfer on another
- [ ] Network interruption during sync
- [ ] All notification sources fail, polling recovers
- [ ] Nostr relay down, WebSocket takes over
- [ ] CID mismatch at same sequence number

---

## Related Files

| File | Purpose |
|------|---------|
| `src/components/wallet/L3/services/IpfsStorageService.ts` | Main sync service |
| `src/components/wallet/L3/services/ConflictResolutionService.ts` | Token merging |
| `src/components/wallet/L3/services/TokenValidationService.ts` | Unicity validation |
| `src/components/wallet/L3/services/TokenBackupService.ts` | Encrypted backup |
| `src/components/wallet/L3/services/NostrService.ts` | Nostr messaging |
| `src/components/wallet/L3/services/SyncCoordinator.ts` | Tab coordination |
| `src/components/wallet/L3/hooks/useIpfsStorage.ts` | React hook |

---

## References

- [Helia IPNS Documentation](https://github.com/ipfs/helia-ipns)
- [libp2p PubSub](https://docs.libp2p.io/concepts/pubsub/overview/)
- [IPFS PubSub Tutorial](https://docs.ipfs.tech/concepts/pubsub/)
- [Kubo IPNS over PubSub](https://github.com/ipfs/kubo/blob/master/docs/experimental-features.md#ipns-pubsub)
- [Nostr Protocol](https://github.com/nostr-protocol/nips)
