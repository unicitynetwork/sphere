/**
 * SyncCoordinator - Tab coordination for IPFS sync operations
 *
 * Uses BroadcastChannel API to coordinate sync operations across browser tabs.
 * Implements leader election to ensure only one tab syncs at a time, preventing
 * race conditions and duplicate IPNS publishes.
 *
 * Key features:
 * - Leader election among tabs
 * - Sync lock acquisition/release
 * - Heartbeat for leader liveness detection
 * - Graceful handoff on tab close
 */

interface SyncMessage {
  type:
    | "leader-request"
    | "leader-announce"
    | "leader-ack"
    | "sync-start"
    | "sync-complete"
    | "heartbeat"
    | "ping"
    | "pong";
  from: string;
  timestamp: number;
  payload?: unknown;
}

// Singleton instance
let coordinatorInstance: SyncCoordinator | null = null;

export class SyncCoordinator {
  private channel: BroadcastChannel;
  private readonly instanceId: string;

  // Leadership state
  private isLeader = false;
  private leaderId: string | null = null;
  private leaderLastSeen: number = 0;

  // Sync state
  private isSyncing = false;
  private syncQueue: Array<{
    resolve: (acquired: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

  // Timers
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private leaderCheckInterval: ReturnType<typeof setInterval> | null = null;

  // Constants
  private readonly LEADER_TIMEOUT = 10000; // 10s - leader considered dead if no heartbeat
  private readonly HEARTBEAT_INTERVAL = 5000; // 5s heartbeat (was 3s) - reduce CPU overhead
  private readonly LEADER_CHECK_INTERVAL = 7500; // 7.5s leader check (was 5s) - reduce CPU overhead
  private readonly LOCK_TIMEOUT = 30000; // 30s max wait for lock
  private readonly YIELD_COOLDOWN = 15000; // 15s cooldown after yielding to prevent flapping

  // Yield tracking to prevent leadership flapping
  private lastYieldTime: number = 0;

  // Event listener cleanup - store bound handler for proper removal
  private boundPagehideHandler: (() => void) | null = null;

  constructor() {
    this.instanceId = crypto.randomUUID();

    // Initialize BroadcastChannel
    this.channel = new BroadcastChannel("ipfs-sync-coordinator");
    this.channel.onmessage = this.handleMessage.bind(this);

    // Start leader check interval
    this.leaderCheckInterval = setInterval(
      () => this.checkLeaderLiveness(),
      this.LEADER_CHECK_INTERVAL
    );

    // Request leadership on startup
    this.requestLeadership();

    // Handle tab close - use pagehide instead of beforeunload
    // beforeunload fires BEFORE the confirmation dialog, so cleanup would run
    // even if user cancels the reload. pagehide only fires when page actually unloads.
    // Store bound handler for proper cleanup
    this.boundPagehideHandler = () => this.cleanup();
    window.addEventListener("pagehide", this.boundPagehideHandler);

    console.log(`📋 SyncCoordinator initialized: ${this.instanceId.slice(0, 8)}...`);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SyncCoordinator {
    if (!coordinatorInstance) {
      coordinatorInstance = new SyncCoordinator();
    }
    return coordinatorInstance;
  }

  /**
   * Acquire sync lock - waits for leadership or current sync to complete
   * Returns true if lock acquired, false if timeout
   */
  async acquireLock(timeout: number = this.LOCK_TIMEOUT): Promise<boolean> {
    // If we're already the leader and not syncing, we have the lock
    if (this.isLeader && !this.isSyncing) {
      this.isSyncing = true;
      this.broadcast({ type: "sync-start" });
      return true;
    }

    // If another tab is leader and syncing, wait
    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        // Timeout - remove from queue and return false
        this.syncQueue = this.syncQueue.filter((q) => q.resolve !== resolve);
        resolve(false);
      }, timeout);

      this.syncQueue.push({ resolve, timeout: timeoutHandle });

      // Ping leader to check if still alive
      this.broadcast({ type: "ping" });
    });
  }

  /**
   * Release sync lock
   */
  releaseLock(): void {
    if (!this.isSyncing) return;

    this.isSyncing = false;
    this.broadcast({ type: "sync-complete" });

    // Process waiting queue
    this.processQueue();
  }

  /**
   * Check if we currently hold the lock
   */
  hasLock(): boolean {
    return this.isLeader && this.isSyncing;
  }

  /**
   * Check if this tab is the leader
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Request to become leader
   */
  private requestLeadership(): void {
    // If no leader or leader is dead, claim leadership
    if (!this.leaderId || this.isLeaderDead()) {
      this.becomeLeader();
    } else {
      // Request leadership from current leader
      this.broadcast({ type: "leader-request" });
    }
  }

  /**
   * Become the leader
   */
  private becomeLeader(): void {
    this.isLeader = true;
    this.leaderId = this.instanceId;
    this.leaderLastSeen = Date.now();

    // Start heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: "heartbeat" });
    }, this.HEARTBEAT_INTERVAL);

    // Send immediate heartbeat to prevent silent leader period
    // This allows followers to immediately update leaderLastSeen
    this.broadcast({ type: "heartbeat" });

    // Announce leadership
    this.broadcast({ type: "leader-announce" });

    console.log(`📋 Became sync leader: ${this.instanceId.slice(0, 8)}...`);

    // Process any waiting sync requests
    this.processQueue();
  }

  /**
   * Check if current leader is dead (no heartbeat)
   */
  private isLeaderDead(): boolean {
    if (!this.leaderId) return true;
    if (this.leaderId === this.instanceId) return false;
    return Date.now() - this.leaderLastSeen > this.LEADER_TIMEOUT;
  }

  /**
   * Check leader liveness and take over if dead
   */
  private checkLeaderLiveness(): void {
    if (this.isLeader) return;

    // Don't attempt takeover if we recently yielded leadership
    // This prevents rapid leadership cycling (flapping) when messages are delayed
    if (Date.now() - this.lastYieldTime < this.YIELD_COOLDOWN) {
      return;
    }

    if (this.isLeaderDead()) {
      console.log(`📋 Leader ${this.leaderId?.slice(0, 8)}... appears dead, taking over`);
      this.becomeLeader();
    }
  }

  /**
   * Process queued sync requests
   */
  private processQueue(): void {
    if (!this.isLeader || this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    // Grant lock to first in queue
    const next = this.syncQueue.shift();
    if (next) {
      clearTimeout(next.timeout);
      this.isSyncing = true;
      this.broadcast({ type: "sync-start" });
      next.resolve(true);
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(event: MessageEvent<SyncMessage>): void {
    const msg = event.data;

    // Ignore our own messages
    if (msg.from === this.instanceId) return;

    switch (msg.type) {
      case "leader-announce":
        // Another tab claimed leadership
        if (this.isLeader && msg.from !== this.instanceId) {
          // Resolve conflict - higher ID wins
          if (msg.from > this.instanceId) {
            console.log(`📋 Yielding leadership to ${msg.from.slice(0, 8)}...`);
            this.isLeader = false;
            this.leaderId = msg.from;
            // Set yield cooldown to prevent rapid re-election attempts
            this.lastYieldTime = Date.now();
            // Give the new leader grace period to send heartbeats
            // Without this, we'd immediately consider them dead after cooldown expires
            this.leaderLastSeen = Date.now();
            if (this.heartbeatInterval) {
              clearInterval(this.heartbeatInterval);
              this.heartbeatInterval = null;
            }
          } else {
            // We have higher ID, re-announce
            this.broadcast({ type: "leader-announce" });
          }
        } else {
          this.leaderId = msg.from;
          // Give the new leader grace period to send heartbeats
          // We update leaderLastSeen here so the leader has LEADER_TIMEOUT to prove liveness
          this.leaderLastSeen = Date.now();
          console.log(`📋 Acknowledged leader: ${msg.from.slice(0, 8)}...`);
        }
        break;

      case "heartbeat":
        if (msg.from === this.leaderId) {
          this.leaderLastSeen = Date.now();
        }
        break;

      case "leader-request":
        // Someone wants leadership - if we're leader, send heartbeat
        if (this.isLeader) {
          this.broadcast({ type: "heartbeat" });
        }
        break;

      case "sync-start":
        // Leader started syncing
        this.leaderLastSeen = Date.now();
        break;

      case "sync-complete":
        // Leader finished syncing - might be our turn
        this.leaderLastSeen = Date.now();
        // If we have queued requests and we're the leader, process them
        if (this.isLeader) {
          this.processQueue();
        }
        break;

      case "ping":
        // Liveness check - respond if we're leader
        if (this.isLeader) {
          this.broadcast({ type: "pong" });
        }
        break;

      case "pong":
        // Leader is alive
        if (msg.from === this.leaderId) {
          this.leaderLastSeen = Date.now();
        }
        break;
    }
  }

  /**
   * Broadcast a message to all tabs
   */
  private broadcast(msg: Omit<SyncMessage, "from" | "timestamp">): void {
    this.channel.postMessage({
      ...msg,
      from: this.instanceId,
      timestamp: Date.now(),
    } as SyncMessage);
  }

  /**
   * Cleanup on tab close
   */
  private cleanup(): void {
    // Remove pagehide listener (prevent memory leak / double cleanup)
    if (this.boundPagehideHandler) {
      window.removeEventListener("pagehide", this.boundPagehideHandler);
      this.boundPagehideHandler = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
      this.leaderCheckInterval = null;
    }

    // If we're leader and syncing, let others know
    if (this.isLeader) {
      this.broadcast({ type: "sync-complete" });
    }

    this.channel.close();
  }

  /**
   * Shutdown the coordinator
   */
  shutdown(): void {
    this.cleanup();
    coordinatorInstance = null;
    console.log(`📋 SyncCoordinator shutdown: ${this.instanceId.slice(0, 8)}...`);
  }
}

/**
 * Get the singleton SyncCoordinator instance
 */
export function getSyncCoordinator(): SyncCoordinator {
  return SyncCoordinator.getInstance();
}
