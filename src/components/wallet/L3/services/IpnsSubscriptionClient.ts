/**
 * WebSocket client for IPNS subscription updates.
 * Connects to IPFS sidecar and receives push notifications for IPNS changes.
 *
 * Architecture:
 * - Connects to /ws/ipns endpoint on IPFS gateway
 * - Clients subscribe to specific IPNS names
 * - Server pushes updates when IPNS records change
 * - Auto-reconnects on connection loss with exponential backoff
 */

import { getBackendGatewayUrl } from "../../../../config/ipfs.config";

export interface IpnsUpdate {
  type: "update";
  name: string;
  sequence: number;
  cid: string | null;
  timestamp: string;
}

export type IpnsSubscriptionCallback = (update: IpnsUpdate) => void;

interface WebSocketMessage {
  type: string;
  name?: string;
  names?: string[];
  sequence?: number;
  cid?: string | null;
  timestamp?: string;
  message?: string;
}

export class IpnsSubscriptionClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<IpnsSubscriptionCallback>> = new Map();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly wsUrl: string;
  private reconnectDelayMs = 5000;
  private readonly maxReconnectDelayMs = 60000;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private connectionOpenedAt: number = 0;
  // Minimum stable connection time before resetting backoff (30 seconds)
  private readonly minStableConnectionMs = 30000;

  constructor(gateway?: string) {
    const baseGateway = gateway || getBackendGatewayUrl();
    if (!baseGateway) {
      // Fallback to primary Unicity IPFS node
      this.wsUrl = "wss://unicity-ipfs1.dyndns.org/ws/ipns";
      return;
    }
    // Convert https:// to wss:// and http:// to ws://
    const wsProtocol = baseGateway.startsWith("https://") ? "wss://" : "ws://";
    const host = baseGateway.replace(/^https?:\/\//, "");
    this.wsUrl = `${wsProtocol}${host}/ws/ipns`;
  }

  /**
   * Connect to the WebSocket server.
   * Called automatically when first subscription is added.
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      console.log(`[IPNS-WS] Connecting to ${this.wsUrl}...`);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log("[IPNS-WS] WebSocket connected");
        this.isConnecting = false;
        this.connectionOpenedAt = Date.now();
        // Don't reset backoff yet - wait until connection proves stable

        // Resubscribe to all IPNS names
        const names = Array.from(this.subscriptions.keys());
        if (names.length > 0) {
          this.sendSubscribe(names);
        }

        // Start ping interval to keep connection alive
        this.startPingInterval();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        const connectionDuration = this.connectionOpenedAt > 0 ? Date.now() - this.connectionOpenedAt : 0;
        const wasStable = connectionDuration >= this.minStableConnectionMs;

        // Only log if connection was short-lived (to reduce log spam)
        if (connectionDuration < 5000) {
          console.log(
            `[IPNS-WS] WebSocket closed quickly (code: ${event.code}, duration: ${connectionDuration}ms)`
          );
        } else {
          console.log(
            `[IPNS-WS] WebSocket closed (code: ${event.code}, duration: ${Math.round(connectionDuration / 1000)}s)`
          );
        }

        this.isConnecting = false;
        this.connectionOpenedAt = 0;
        this.stopPingInterval();

        // Only reset backoff if connection was stable (prevents rapid reconnect loops)
        if (wasStable) {
          this.reconnectAttempts = 0;
          this.reconnectDelayMs = 5000;
        }

        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.warn("[IPNS-WS] WebSocket error:", error);
        this.isConnecting = false;
      };
    } catch (e) {
      console.warn("[IPNS-WS] Failed to connect WebSocket:", e);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      switch (message.type) {
        case "update":
          if (message.name && message.sequence !== undefined) {
            this.notifySubscribers({
              type: "update",
              name: message.name,
              sequence: message.sequence,
              cid: message.cid ?? null,
              timestamp: message.timestamp || new Date().toISOString(),
            });
          }
          break;

        case "subscribed":
          console.log(
            `[IPNS-WS] Subscribed to ${message.names?.length || 0} names`
          );
          break;

        case "unsubscribed":
          console.log(
            `[IPNS-WS] Unsubscribed from ${message.names?.length || 0} names`
          );
          break;

        case "pong":
          // Keepalive response received
          break;

        case "error":
          console.warn("[IPNS-WS] Server error:", message.message);
          break;

        default:
          console.debug("[IPNS-WS] Unknown message type:", message.type);
      }
    } catch (e) {
      console.warn("[IPNS-WS] Failed to parse message:", e);
    }
  }

  private notifySubscribers(update: IpnsUpdate): void {
    const callbacks = this.subscriptions.get(update.name);
    if (callbacks) {
      console.log(
        `[IPNS-WS] Update received: ${update.name.slice(0, 16)}... seq=${update.sequence}`
      );
      for (const callback of callbacks) {
        try {
          callback(update);
        } catch (e) {
          console.warn("[IPNS-WS] Subscription callback error:", e);
        }
      }
    }
  }

  /**
   * Check backend health before reconnecting
   * NOTE: Disabled HTTP health check - causes CORS errors from browser.
   * WebSocket reconnection will handle connectivity checks naturally.
   */
  private async checkBackendHealth(): Promise<boolean> {
    // Skip HTTP health check - it causes CORS errors from browser origins.
    // The WebSocket connection itself is the best health indicator.
    return true;
  }

  /**
   * Schedule reconnection with exponential backoff
   * CPU OPTIMIZATION (Phase 5): Increased backoff factor from 1.5 to 2
   * Sequence: 5s, 10s, 20s, 40s, 60s (capped)
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    // Don't reconnect if no subscriptions
    if (this.subscriptions.size === 0) {
      return;
    }

    this.reconnectAttempts++;
    // CPU OPTIMIZATION: Changed from 1.5 to 2 for slower backoff
    const delay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs
    );

    console.log(
      `[IPNS-WS] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;

      // CPU OPTIMIZATION: Health check for first 3 attempts to avoid reconnect storms
      if (this.reconnectAttempts <= 3) {
        const isHealthy = await this.checkBackendHealth();
        if (!isHealthy) {
          console.log(`[IPNS-WS] Backend health check failed, delaying reconnect`);
          this.scheduleReconnect(); // Schedule another attempt with increased delay
          return;
        }
      }

      this.connect();
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "ping" }));
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private sendSubscribe(names: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "subscribe", names }));
    }
  }

  private sendUnsubscribe(names: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "unsubscribe", names }));
    }
  }

  /**
   * Subscribe to IPNS updates for a specific name.
   * Returns an unsubscribe function.
   *
   * @param ipnsName The IPNS name to subscribe to
   * @param callback Function called when updates are received
   * @returns Unsubscribe function
   */
  subscribe(
    ipnsName: string,
    callback: IpnsSubscriptionCallback
  ): () => void {
    if (!ipnsName || typeof ipnsName !== "string") {
      console.warn("[IPNS-WS] Invalid IPNS name for subscription");
      return () => {};
    }

    const isNewSubscription = !this.subscriptions.has(ipnsName);

    if (isNewSubscription) {
      this.subscriptions.set(ipnsName, new Set());
    }

    this.subscriptions.get(ipnsName)!.add(callback);

    // Send subscription to server if this is a new IPNS name
    if (isNewSubscription && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([ipnsName]);
    }

    // Connect if not already connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(ipnsName);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(ipnsName);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.sendUnsubscribe([ipnsName]);
          }

          // Disconnect if no more subscriptions
          if (this.subscriptions.size === 0) {
            this.disconnect();
          }
        }
      }
    };
  }

  /**
   * Check if connected to the WebSocket server
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get count of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }
}

// Singleton instance
let subscriptionClientInstance: IpnsSubscriptionClient | null = null;

/**
 * Get or create the singleton subscription client instance
 */
export function getIpnsSubscriptionClient(): IpnsSubscriptionClient {
  if (!subscriptionClientInstance) {
    subscriptionClientInstance = new IpnsSubscriptionClient();
  }
  return subscriptionClientInstance;
}
