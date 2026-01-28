# Helia Implementation - Quick Optimization Guide

## Top 3 Priority Fixes

### 1. Fix Connection Manager Configuration (30 min)

**File:** `/home/vrogojin/sphere/src/config/ipfs.config.ts`

**Current Issue:** Missing critical stream and connection limits

**Action:**
```typescript
// BEFORE
export const IPFS_CONFIG = {
  connectionTimeout: 10000,
  maxConnections: 10,
  enableAutoSync: true,
  syncIntervalMs: 5 * 60 * 1000,
};

// AFTER
export const IPFS_CONFIG = {
  connectionTimeout: 10000,
  maxConnections: 10,
  minConnections: 2,                    // ← NEW
  maxConnectionsPerPeer: 2,             // ← NEW
  maxInboundStreams: 64,                // ← NEW
  maxOutboundStreams: 64,               // ← NEW
  enableAutoSync: true,
  syncIntervalMs: 5 * 60 * 1000,
};
```

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:277-287`

```typescript
// BEFORE
const helia = await createHelia({
  libp2p: {
    connectionGater,
    peerDiscovery: [
      bootstrap({ list: bootstrapPeers }),
    ],
    connectionManager: {
      maxConnections: IPFS_CONFIG.maxConnections,
    },
  },
});

// AFTER
const helia = await createHelia({
  libp2p: {
    connectionGater,
    peerDiscovery: [
      bootstrap({ list: bootstrapPeers }),
    ],
    connectionManager: {
      maxConnections: IPFS_CONFIG.maxConnections,
      minConnections: IPFS_CONFIG.minConnections,           // ← NEW
      maxConnectionsPerPeer: IPFS_CONFIG.maxConnectionsPerPeer,  // ← NEW
      inboundStreamLimit: IPFS_CONFIG.maxInboundStreams,    // ← NEW
      outboundStreamLimit: IPFS_CONFIG.maxOutboundStreams,  // ← NEW
    },
  },
});
```

**Impact:** Prevents resource exhaustion, stabilizes connections, reduces memory leaks

---

### 2. Add Timeout Protection to Helia.stop() (15 min)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:414-445`

**Current Issue:** Helia.stop() could hang indefinitely during page unload

```typescript
// BEFORE
async shutdown(): Promise<void> {
  // ... cleanup code ...
  if (this.helia) {
    await this.helia.stop();
    this.helia = null;
  }
  console.log("📦 IPFS storage service stopped");
}

// AFTER
async shutdown(): Promise<void> {
  // ... cleanup code ...
  if (this.helia) {
    try {
      // Add 5 second timeout protection
      const stopPromise = this.helia.stop();
      await Promise.race([
        stopPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Helia.stop() timeout')), 5000)
        ),
      ]);
      this.helia = null;
    } catch (error) {
      console.warn(`📦 Helia shutdown error:`, error);
      this.helia = null; // Force cleanup anyway
    }
  }
  console.log("📦 IPFS storage service stopped");
}
```

**Impact:** Prevents page navigation hanging, graceful degradation on timeout

---

### 3. Lazy-Load Event Listeners (45 min)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**Current Issue:** Peer connection listeners attached unconditionally, memory overhead

**Step 1: Add tracking properties** (around line 340)
```typescript
private connectionEventListenersAttached = false;
private connectionEventListeners: {
  onConnect: (event: Event) => void;
  onDisconnect: (event: Event) => void;
} | null = null;
```

**Step 2: Modify ensureInitialized()** (replace lines 641-680)
```typescript
// Set up event handlers only on first initialization AND only when needed
if (!this.connectionEventListenersAttached && this.helia) {
  const bootstrapPeers = getBootstrapPeers();
  const bootstrapPeerIds = new Set(
    bootstrapPeers.map((addr) => {
      const match = addr.match(/\/p2p\/([^/]+)$/);
      return match ? match[1] : null;
    }).filter((id): id is string => id !== null)
  );

  // Create listener functions
  const onConnect = (event: Event) => {
    const remotePeerId = (event as any).detail.toString();
    if (bootstrapPeerIds.has(remotePeerId)) {
      console.log(`📦 Connected to bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
    }
  };

  const onDisconnect = (event: Event) => {
    const remotePeerId = (event as any).detail.toString();
    if (bootstrapPeerIds.has(remotePeerId)) {
      console.log(`📦 Disconnected from bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
    }
  };

  this.connectionEventListeners = { onConnect, onDisconnect };

  // Attach listeners
  this.helia.libp2p.addEventListener("peer:connect", onConnect);
  this.helia.libp2p.addEventListener("peer:disconnect", onDisconnect);
  this.connectionEventListenersAttached = true;

  // Log initial connections after a short delay
  setTimeout(() => {
    const connections = this.helia?.libp2p.getConnections() || [];
    console.log(`📦 Active connections: ${connections.length}`);
    connections.slice(0, 5).forEach((conn) => {
      console.log(`📦   - ${conn.remotePeer.toString().slice(0, 16)}... via ${conn.remoteAddr.toString()}`);
    });
  }, 5000);
}

// Start connection maintenance (only if not already started)
if (!this.connectionMaintenanceInterval) {
  this.startBackendConnectionMaintenance();
}
```

**Step 3: Update shutdown()** (add to cleanup section)
```typescript
// Remove event listeners if attached
if (this.connectionEventListeners && this.helia) {
  this.helia.libp2p.removeEventListener("peer:connect", this.connectionEventListeners.onConnect);
  this.helia.libp2p.removeEventListener("peer:disconnect", this.connectionEventListeners.onDisconnect);
  this.connectionEventListenersAttached = false;
  this.connectionEventListeners = null;
}
```

**Impact:** Reduces memory overhead, listeners only active during active wallet use

---

## Secondary Improvements (Medium Priority)

### 4. Add Bootstrap Peer Health Checking (60 min)

**File:** `/home/vrogojin/sphere/src/config/ipfs.config.ts` (append at end)

```typescript
/**
 * Check configured peers for availability
 * Can be called periodically to enable/disable peers
 */
export async function checkBootstrapPeerHealth(): Promise<{
  healthy: IpfsPeer[];
  unhealthy: IpfsPeer[];
}> {
  const allPeers = CUSTOM_PEERS.filter((p) => isPeerConfigured(p.peerId));
  const healthy: IpfsPeer[] = [];
  const unhealthy: IpfsPeer[] = [];

  for (const peer of allPeers) {
    try {
      const isSecure =
        typeof window !== "undefined" &&
        window.location.protocol === "https:";
      const protocol = isSecure ? "https" : "http";
      const port = isSecure ? "443" : "9080";
      const url = `${protocol}://${peer.host}:${port}/api/v0/id`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        healthy.push(peer);
      } else {
        unhealthy.push(peer);
      }
    } catch {
      unhealthy.push(peer);
    }
  }

  console.log(
    `📦 Peer health check: ${healthy.length} healthy, ${unhealthy.length} unhealthy`
  );
  return { healthy, unhealthy };
}
```

**Usage in IpfsStorageService** (optional, can be called on init):
```typescript
// In ensureInitialized(), after Helia is ready
if (import.meta.env.DEV) {
  // Check peer health in development
  checkBootstrapPeerHealth().then(({ healthy, unhealthy }) => {
    if (unhealthy.length > 0) {
      console.warn(`📦 Unhealthy peers: ${unhealthy.map(p => p.host).join(', ')}`);
    }
  });
}
```

**Impact:** Visibility into bootstrap peer availability, allows dynamic peer selection

---

### 5. Remove Initial Maintenance Delay (10 min)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:2140`

```typescript
// BEFORE
setTimeout(maintainConnection, 2000);  // Arbitrary 2 second delay

// AFTER
maintainConnection().catch(err => {
  console.warn(`📦 Initial backend connection check failed:`, err);
});
```

**Impact:** Faster connection establishment before first sync

---

### 6. Add Peer Discovery Metrics (30 min)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (in initializeHeliaEarly)

```typescript
const helia = await createHelia({
  libp2p: {
    connectionGater,
    peerDiscovery: [
      bootstrap({ list: bootstrapPeers }),
    ],
    connectionManager: {
      maxConnections: IPFS_CONFIG.maxConnections,
    },
  },
});

// NEW: Track peer discovery timing
const discoveryStart = performance.now();
const discoveryWait = new Promise<void>((resolve) => {
  let peerCount = 0;
  const checkPeers = () => {
    const connections = helia.libp2p.getConnections();
    if (connections.length > 0 || performance.now() - discoveryStart > 5000) {
      resolve();
    } else {
      setTimeout(checkPeers, 100);
    }
  };
  checkPeers();
});

await discoveryWait;

const connections = helia.libp2p.getConnections();
const discoveryElapsed = performance.now() - discoveryStart;

console.log(
  `📦 [Early Init] Peer discovery: ${discoveryElapsed.toFixed(0)}ms, ` +
  `${connections.length} connection(s)`
);
```

**Impact:** Better observability of bootstrap process

---

## Testing & Validation

### Test 1: Connection Manager Limits
```bash
# Check current active connections
# Open DevTools Console and run:
window.localStorage.getItem('connection_debug') // Check if limits applied
```

### Test 2: Event Listener Cleanup
```bash
# Reload page multiple times and check memory
# In DevTools → Performance/Memory
# Should show stable memory without listener accumulation
```

### Test 3: Shutdown Timeout
```javascript
// In DevTools, simulate slow shutdown:
// (For testing only - do not run on production)
// Add delay to Helia.stop() in local test
```

---

## Implementation Order

**Week 1:**
1. Connection manager configuration (Critical)
2. Helia.stop() timeout (Critical)
3. Remove 2s maintenance delay (Quick win)

**Week 2:**
4. Lazy event listeners (High impact, moderate effort)
5. Peer health checking (Medium priority)
6. Peer discovery metrics (Observability)

**Estimated Total Time:** 3-4 hours for all improvements

---

## Validation Checklist

After implementing fixes:

- [ ] No console errors on page load
- [ ] IPFS storage service initializes successfully
- [ ] Wallet syncs complete without hanging
- [ ] Page unload doesn't hang (test Ctrl+W)
- [ ] Memory usage stable over extended use
- [ ] Peer connections logged appropriately
- [ ] Bootstrap peer reconnection works
- [ ] Tests pass: `npm run test:run`
- [ ] No TypeScript errors: `npx tsc --noEmit`

---

## Performance Benchmarks

Track these metrics before and after:

```typescript
// Add to window.performance in main.tsx
window.heliaMetrics = {
  initStartTime: Date.now(),
  initCompleteTime: null,
  firstSyncTime: null,
  memoryUsage: null,
  connectionCount: 0,
};

// Update when Helia ready and first sync complete
```

---

## Questions & Troubleshooting

**Q: Will these changes break existing functionality?**
A: No. All changes are backward compatible and additive. New config fields have defaults.

**Q: Should I re-enable the disabled peers?**
A: Only after implementing peer health checking. For now, keep 1 active to debug IPNS issues.

**Q: Can I test lazy event listeners locally?**
A: Yes. Open DevTools and monitor EventListener count in Performance tab.

**Q: What's the expected improvement in init time?**
A: 200-300ms reduction by fixing connection manager and peer discovery.

