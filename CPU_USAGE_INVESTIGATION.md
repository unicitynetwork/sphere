# CPU Usage Investigation Report

**Issue**: High CPU usage (20-40%) in Sphere React app when tab is active, even without wallet operations.

**Investigation Date**: 2026-01-27

---

## Root Causes Identified

### 1. Libp2p Peer Dial Spam (HIGH IMPACT)

**Problem**: Helia/libp2p constantly attempts to dial non-bootstrap peers, logging "Blocked dial to non-bootstrap peer" messages (100+ occurrences observed).

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:207-213`

**Code**:
```typescript
denyDialPeer: async (peerId: PeerId) => {
  const peerIdStr = peerId.toString();
  const denied = !allowedPeerIds.has(peerIdStr);
  if (denied) {
    console.debug(`📦 Blocked dial to non-bootstrap peer: ${peerIdStr.slice(0, 16)}...`);
  }
  return denied;
}
```

**Root Cause**:
- Libp2p's DHT discovery continues finding new peers via Kademlia routing
- Connection gater blocks these peers (correct), but libp2p keeps attempting dials
- Each dial attempt involves:
  - Peer ID validation
  - Connection gater check
  - Console logging (expensive in production)
  - Failed connection cleanup

**CPU Impact**: Each dial cycle uses crypto operations (peer ID parsing, address validation) + logging overhead

**Recommended Fix**:
1. Disable DHT peer discovery completely (we only need bootstrap peers)
2. Remove console.debug logging in hot path (use conditional debug flag)
3. Configure libp2p with more restrictive discovery:

```typescript
const helia = await createHelia({
  libp2p: {
    connectionGater,
    peerDiscovery: [
      bootstrap({ list: bootstrapPeers }),
    ],
    // Add these configurations:
    services: {
      dht: undefined, // Disable DHT completely
    },
    connectionManager: {
      maxConnections: IPFS_CONFIG.maxConnections,
      // Prevent automatic dial attempts
      autoDial: false,
      // More aggressive dial throttling
      dialTimeout: 30000,
    },
  },
});
```

---

### 2. Excessive setInterval Timers (MEDIUM-HIGH IMPACT)

**Problem**: Multiple background timers running continuously, each executing every 2-7.5 seconds.

#### 2a. SyncCoordinator - Leader Election Loop

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/SyncCoordinator.ts:51-76`

**Code**:
```typescript
private readonly HEARTBEAT_INTERVAL = 5000; // 5s heartbeat (was 3s)
private readonly LEADER_CHECK_INTERVAL = 7500; // 7.5s leader check (was 5s)

this.leaderCheckInterval = setInterval(
  () => this.checkLeaderLiveness(),
  this.LEADER_CHECK_INTERVAL
);

this.heartbeatInterval = setInterval(() => {
  this.broadcast({ type: "heartbeat" });
}, this.HEARTBEAT_INTERVAL);
```

**CPU Impact**:
- Runs every 5-7.5 seconds per tab
- BroadcastChannel message serialization + deserialization
- Leadership comparison logic
- Multiple instances if user has multiple tabs

**Recommended Fix**:
1. Increase intervals to 15s heartbeat / 20s leader check (3-4x reduction)
2. Only run leader election when needed (lazy activation on sync request)
3. Consider leader sticky-ness (reduce flapping):

```typescript
private readonly HEARTBEAT_INTERVAL = 15000; // 15s (was 5s)
private readonly LEADER_CHECK_INTERVAL = 20000; // 20s (was 7.5s)
```

#### 2b. NostrDeliveryQueue - Queue Processing Loop

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/InventoryBackgroundLoops.ts:319-323`

**Code**:
```typescript
this.processTimer = setInterval(() => {
  this.processQueue().catch(err => {
    console.error('📤 [DeliveryQueue] Process error:', err);
  });
}, this.config.deliveryCheckIntervalMs); // 2000ms (was 500ms)
```

**CPU Impact**:
- Runs every 2 seconds even when queue is empty
- Map iteration over queue entries
- Time-based backoff calculations

**Recommended Fix**:
1. Use event-driven queue (stop timer when queue empty)
2. Increase interval to 5s (already reduced from 500ms to 2s, but can go further)

```typescript
// Only start timer when queue has entries
private startProcessing(): void {
  if (this.processTimer) return;
  if (this.queue.size === 0) return; // Don't start if empty

  this.processTimer = setInterval(() => {
    this.processQueue().catch(err => {
      console.error('📤 [DeliveryQueue] Process error:', err);
    });
  }, 5000); // Increase to 5s
}

// Stop timer when queue becomes empty
private async processQueue(): Promise<void> {
  // ... existing logic ...

  if (this.queue.size === 0 && this.activeDeliveries.size === 0) {
    this.stopProcessing(); // Stop timer when idle
    this.checkEmptyQueueWindow();
  }
}
```

#### 2c. IpnsSubscriptionClient - WebSocket Ping Loop

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpnsSubscriptionClient.ts:200-208`

**Code**:
```typescript
this.pingInterval = setInterval(() => {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.send(JSON.stringify({ action: "ping" }));
  }
}, 30000); // 30 seconds
```

**CPU Impact**: Low individual impact, but adds to cumulative overhead

**Recommended Fix**: Acceptable interval (30s), but could be increased to 60s for further reduction

#### 2d. IpfsStorageService - Backend Connection Maintenance

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:2361`

**Code**:
```typescript
this.connectionMaintenanceInterval = setInterval(maintainConnection, 60000);
console.log(`📦 Backend connection alive: ${backendConn.remoteAddr.toString()}`);
```

**CPU Impact**: Runs every 60s, logs connection status

**Recommended Fix**:
1. Increase to 120s (2 minutes)
2. Remove verbose logging (only log on reconnect, not on status check)

```typescript
// Only log when connection state changes
if (!isConnected) {
  console.log(`📦 Backend peer disconnected, reconnecting...`);
} else {
  // Remove verbose "connection alive" log
}
```

#### 2e. useGlobalSyncStatus - Polling Loop

**Location**: `/home/vrogojin/sphere/src/hooks/useGlobalSyncStatus.ts:83-86`

**Code**:
```typescript
// Poll for token sync status as backup (events may be missed during initialization)
const pollInterval = setInterval(() => {
  const currentSyncing = tokenService.isCurrentlySyncing();
  setTokenSyncing(currentSyncing);
}, 500); // Every 500ms!
```

**CPU Impact**: HIGH - Runs twice per second!

**Recommended Fix**:
1. Increase to 2-5 seconds (polling is just a fallback)
2. Or remove entirely if event system is reliable

```typescript
const pollInterval = setInterval(() => {
  const currentSyncing = tokenService.isCurrentlySyncing();
  setTokenSyncing(currentSyncing);
}, 5000); // Increase to 5s (10x reduction)
```

#### 2f. OutboxRecoveryService - Periodic Retry

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/OutboxRecoveryService.ts:145-147`

**Code**:
```typescript
this.periodicRetryInterval = setInterval(() => {
  this.runPeriodicRecovery();
}, PERIODIC_RETRY_INTERVAL_MS); // 30000ms (30 seconds)
```

**CPU Impact**: Moderate - runs every 30s, checks outbox repository

**Recommended Fix**: Acceptable interval, but could be increased to 60s when no pending entries

---

### 3. Multiple useWallet Hook Instances (MEDIUM IMPACT)

**Problem**: `useWallet()` hook is used in 8 different components, each creating its own background validation loop.

**Affected Components**:
- `/home/vrogojin/sphere/src/components/wallet/L3/views/L3WalletView.tsx`
- `/home/vrogojin/sphere/src/components/wallet/onboarding/CreateWalletFlow.tsx`
- `/home/vrogojin/sphere/src/components/wallet/WalletPanel.tsx`
- `/home/vrogojin/sphere/src/components/auth/WalletGate.tsx`
- `/home/vrogojin/sphere/src/components/wallet/L3/modals/SendModal.tsx`
- `/home/vrogojin/sphere/src/components/agents/shared/AgentChat.tsx`
- `/home/vrogojin/sphere/src/components/wallet/L3/modals/SwapModal.tsx`
- `/home/vrogojin/sphere/src/components/wallet/L3/modals/PaymentRequestModal.tsx`

**Root Cause**: Each `useWallet()` instance has its own:
- `useEffect` for wallet-updated events (lines 124-186)
- `useEffect` for IPNS remote updates (lines 345-379)
- `useEffect` for background validation (lines 439-514)

While the code has protections against duplicate work (module-level flags, debouncing), having 8 instances creates:
- 8x event listener registrations
- 8x React Query subscriptions
- Potential race conditions in debounce logic

**Evidence from Code**:
```typescript
// Line 461: This log appears 11 times according to user's console
console.log(`🔄 [backgroundValidation] Running spent check for ${tokens.length} token(s) in background...`);
```

**Recommended Fix**:
1. Move background validation to a singleton service (not in hook)
2. Reduce number of components using useWallet (centralize in WalletProvider)
3. Make useWallet a lightweight hook that reads from shared state

**Proposed Architecture**:
```typescript
// New: WalletStateManager (singleton service)
class WalletStateManager {
  private static instance: WalletStateManager;

  // Single background validation loop
  startBackgroundValidation() {
    // Runs once for entire app
  }

  // Single event listener
  setupEventListeners() {
    window.addEventListener("wallet-updated", this.handleUpdate);
  }
}

// Modified: useWallet (lightweight reader)
export const useWallet = () => {
  // Just read from React Query, no background loops
  const identityQuery = useQuery(KEYS.IDENTITY, ...);
  const tokensQuery = useQuery(KEYS.TOKENS, ...);
  return { identity: identityQuery.data, tokens: tokensQuery.data };
}
```

---

### 4. WebSocket Reconnection Loop (LOW-MEDIUM IMPACT)

**Problem**: IPNS WebSocket closes with code 1006 (abnormal closure) and reconnects every ~30-60 seconds.

**Location**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpnsSubscriptionClient.ts:93-99`

**Code**:
```typescript
this.ws.onclose = (event) => {
  console.log(
    `[IPNS-WS] WebSocket closed (code: ${event.code}, reason: ${event.reason || "none"})`
  );
  this.isConnecting = false;
  this.stopPingInterval();
  this.scheduleReconnect();
};
```

**Root Cause**: Code 1006 indicates abnormal closure (no close frame sent). Possible causes:
- Server-side timeout (server closes idle connections)
- Network interruption
- Browser throttling of background tabs

**CPU Impact**:
- Reconnection attempts use CPU for WebSocket handshake
- Exponential backoff reduces impact over time
- Ping interval (30s) may not be sufficient to keep connection alive

**Recommended Fix**:
1. Investigate server-side timeout settings
2. Reduce ping interval to 15s (more keepalive messages)
3. Add connection quality metrics (track reconnect frequency)

---

### 5. Excessive Console Logging (LOW-MEDIUM IMPACT)

**Problem**: 864 console.log/console.debug calls across L3 wallet code alone.

**Locations**: Throughout `/home/vrogojin/sphere/src/components/wallet/L3/`

**CPU Impact**:
- Each log requires string concatenation, formatting, and DevTools rendering
- Logs with slice() operations (`.slice(0, 16)`) add overhead
- 100+ "Blocked dial" messages spam console

**Recommended Fix**:
1. Implement debug levels (only log in development)
2. Use conditional logging:

```typescript
const DEBUG = import.meta.env.DEV;

// Replace all console.debug with conditional
if (DEBUG) {
  console.debug(`📦 Blocked dial to non-bootstrap peer: ${peerIdStr.slice(0, 16)}...`);
}
```

3. Remove hot-path logging (connection gater, query invocations)

---

## Summary of Recommended Fixes

### High Priority (Biggest CPU Impact)

1. **Disable libp2p DHT peer discovery** - Prevents 100+ dial attempts
   - File: `IpfsStorageService.ts:283-293`
   - Change: Add `services: { dht: undefined }` and `autoDial: false`

2. **Reduce useGlobalSyncStatus polling** - 500ms → 5000ms (10x reduction)
   - File: `useGlobalSyncStatus.ts:83`
   - Change: `setInterval(..., 5000)` instead of 500

3. **Centralize background validation** - Eliminate 11x duplicate runs
   - File: `useWallet.ts:439-514`
   - Change: Move to singleton WalletStateManager service

### Medium Priority

4. **Increase SyncCoordinator intervals** - 5s/7.5s → 15s/20s
   - File: `SyncCoordinator.ts:55-56`
   - Change: Update HEARTBEAT_INTERVAL and LEADER_CHECK_INTERVAL

5. **Event-driven NostrDeliveryQueue** - Stop timer when idle
   - File: `InventoryBackgroundLoops.ts:316-323`
   - Change: Add auto-stop when queue empty

6. **Remove verbose connection logging**
   - File: `IpfsStorageService.ts:2349`
   - Change: Only log on state changes, not periodic checks

### Low Priority

7. **Conditional debug logging** - Remove production logging overhead
   - Files: All L3 services
   - Change: Wrap console.debug in `if (DEBUG)` checks

8. **Investigate IPNS-WS reconnection** - Reduce code 1006 closures
   - File: `IpnsSubscriptionClient.ts:93-99`
   - Change: Review server timeout settings, consider shorter ping interval

---

## Expected CPU Reduction

**Current State**: 20-40% CPU usage when idle

**After Fixes**:
- Fix #1 (DHT): -5-10% (eliminate peer dial spam)
- Fix #2 (polling): -3-5% (reduce 500ms polling)
- Fix #3 (validation): -5-8% (eliminate 11x duplicate loops)
- Fix #4 (coordinator): -2-3% (reduce heartbeat frequency)
- Fix #5 (delivery queue): -1-2% (stop when idle)
- Fix #6-8 (logging/misc): -2-5% (reduce overhead)

**Expected Result**: 2-10% CPU usage when idle (75-90% reduction)

---

## Implementation Priority

1. **Quick Wins** (can implement immediately):
   - useGlobalSyncStatus polling reduction
   - Remove verbose logging
   - Increase SyncCoordinator intervals

2. **Medium Effort** (requires testing):
   - Disable libp2p DHT discovery
   - Event-driven NostrDeliveryQueue

3. **Architectural** (requires refactoring):
   - Centralize background validation in singleton service
   - Investigate IPNS-WS reconnection issues

---

## Additional Notes

- Most intervals were already increased from more aggressive values (e.g., 500ms → 2000ms for delivery queue)
- The codebase has good architecture patterns (singletons, debouncing, rate limiting)
- Main issue is accumulation of multiple background loops + libp2p peer discovery overhead
- React Query is configured correctly (staleTime: Infinity, manual invalidation)

**Investigation completed**: 2026-01-27
**Report generated by**: Claude Sonnet 4.5
