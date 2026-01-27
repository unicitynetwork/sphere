/**
 * NostrClientWrapper
 *
 * Platform-agnostic wrapper around @unicitylabs/nostr-js-sdk.
 * Handles connection, reconnection, and basic messaging.
 */

import {
  NostrClient,
  NostrKeyManager,
  EventKinds,
  Filter,
  TokenTransferProtocol,
  PaymentRequestProtocol,
  type Event,
} from '@unicitylabs/nostr-js-sdk';

import type {
  NostrConfig,
  NostrIdentityProvider,
  NostrStorageProvider,
  TokenTransferHandler,
  PaymentRequestHandler,
  ReceivedTokenTransfer,
  ReceivedPaymentRequest,
  TokenTransferOptions,
} from './types';
import { DEFAULT_NOSTR_RELAYS, InMemoryNostrStorage } from './types';

// Storage keys
const STORAGE_KEYS = {
  LAST_SYNC: 'nostr_last_sync',
  PROCESSED_EVENTS: 'nostr_processed_events',
};

const MAX_PROCESSED_EVENTS = 100;

/**
 * NostrClientWrapper - Core Nostr connection and messaging
 */
export class NostrClientWrapper {
  private client: NostrClient | null = null;
  private keyManager: NostrKeyManager | null = null;
  private identityProvider: NostrIdentityProvider;
  private storage: NostrStorageProvider;
  private config: NostrConfig;

  private isConnected = false;
  private isConnecting = false;
  private connectPromise: Promise<void> | null = null;

  private tokenTransferHandler: TokenTransferHandler | null = null;
  private paymentRequestHandler: PaymentRequestHandler | null = null;
  private processedEventIds = new Set<string>();

  constructor(
    identityProvider: NostrIdentityProvider,
    storage?: NostrStorageProvider,
    config: NostrConfig = {}
  ) {
    this.identityProvider = identityProvider;
    this.storage = storage ?? new InMemoryNostrStorage();
    this.config = config;
  }

  // ==========================================
  // Connection Management
  // ==========================================

  /**
   * Connect to Nostr relays
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    if (this.isConnecting && this.connectPromise) {
      return this.connectPromise;
    }

    this.isConnecting = true;
    this.connectPromise = this.doConnect();

    try {
      await this.connectPromise;
    } finally {
      this.isConnecting = false;
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    const identity = await this.identityProvider.getIdentity();
    if (!identity) {
      throw new Error('No identity available for Nostr connection');
    }

    const secretKey = Buffer.from(identity.privateKey, 'hex');
    this.keyManager = NostrKeyManager.fromPrivateKey(secretKey);
    this.client = new NostrClient(this.keyManager);

    const relays = this.config.relays ?? DEFAULT_NOSTR_RELAYS;

    this.log('Connecting to Nostr relays...');
    try {
      await this.client.connect(...relays);
      this.isConnected = true;
      this.log('Connected to Nostr relays');

      // Load processed events
      await this.loadProcessedEvents();

      // Subscribe to events
      this.subscribeToEvents(this.keyManager.getPublicKeyHex());
    } catch (error) {
      this.logError('Failed to connect to Nostr', error);
      throw error;
    }
  }

  /**
   * Disconnect from Nostr relays
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        this.logWarn('Error disconnecting', err);
      }
      this.client = null;
    }

    this.keyManager = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.connectPromise = null;
  }

  /**
   * Reset connection (for wallet changes)
   */
  async reset(): Promise<void> {
    await this.disconnect();
    this.processedEventIds.clear();
    this.log('Connection reset, ready for reconnection');
  }

  /**
   * Check if connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get public key
   */
  getPublicKey(): string | null {
    return this.keyManager?.getPublicKeyHex() ?? null;
  }

  // ==========================================
  // Event Subscription
  // ==========================================

  /**
   * Set handler for incoming token transfers
   */
  onTokenTransfer(handler: TokenTransferHandler): void {
    this.tokenTransferHandler = handler;
  }

  /**
   * Set handler for incoming payment requests
   */
  onPaymentRequest(handler: PaymentRequestHandler): void {
    this.paymentRequestHandler = handler;
  }

  private subscribeToEvents(publicKey: string): void {
    if (!this.client) return;

    const lastSync = this.getLastSyncSync();

    // Subscribe to wallet events (token transfers, payment requests)
    const walletFilter = new Filter();
    walletFilter.kinds = [EventKinds.TOKEN_TRANSFER, EventKinds.PAYMENT_REQUEST];
    walletFilter['#p'] = [publicKey];
    walletFilter.since = lastSync;

    this.client.subscribe(walletFilter, {
      onEvent: (event) => this.handleEvent(event, true),
      onEndOfStoredEvents: () => {
        this.log('End of stored wallet events');
      },
    });
  }

  private async handleEvent(event: Event, isWalletEvent: boolean): Promise<void> {
    // Check if already processed
    if (this.processedEventIds.has(event.id)) {
      return;
    }

    // Skip old events
    if (isWalletEvent) {
      const lastSync = this.getLastSyncSync();
      if (event.created_at < lastSync) {
        return;
      }
    }

    this.log(`Processing event kind=${event.kind}`);

    let success = false;

    if (event.kind === EventKinds.TOKEN_TRANSFER) {
      success = await this.handleTokenTransfer(event);
    } else if (event.kind === EventKinds.PAYMENT_REQUEST) {
      success = await this.handlePaymentRequest(event);
    }

    if (success) {
      await this.markEventProcessed(event.id);
      if (isWalletEvent) {
        await this.updateLastSync(event.created_at);
      }
    }
  }

  private async handleTokenTransfer(event: Event): Promise<boolean> {
    if (!this.tokenTransferHandler || !this.keyManager) {
      return false;
    }

    try {
      const tokenJson = await TokenTransferProtocol.parseTokenTransfer(event, this.keyManager);

      // Parse JSON payload
      let payload: { sourceToken?: unknown; transferTx?: unknown };
      try {
        payload = JSON.parse(tokenJson);
      } catch {
        this.logWarn('Failed to parse token transfer JSON');
        return false;
      }

      if (!payload.sourceToken || !payload.transferTx) {
        this.logWarn('Invalid token transfer payload');
        return false;
      }

      const transfer: ReceivedTokenTransfer = {
        eventId: event.id,
        senderPubkey: event.pubkey,
        sourceToken: payload.sourceToken,
        transferTx: payload.transferTx,
        timestamp: event.created_at * 1000,
      };

      return await this.tokenTransferHandler(transfer);
    } catch (error) {
      this.logError('Failed to handle token transfer', error);
      return false;
    }
  }

  private async handlePaymentRequest(event: Event): Promise<boolean> {
    if (!this.paymentRequestHandler || !this.keyManager) {
      return true; // Don't retry payment requests
    }

    try {
      const request = await PaymentRequestProtocol.parsePaymentRequest(event, this.keyManager);

      const received: ReceivedPaymentRequest = {
        eventId: event.id,
        senderPubkey: event.pubkey,
        request: {
          requestId: request.requestId,
          amount: String(request.amount),
          coinId: request.coinId,
          message: request.message,
          recipientNametag: request.recipientNametag,
        },
        timestamp: event.created_at * 1000,
      };

      this.paymentRequestHandler(received);
      return true;
    } catch (error) {
      this.logError('Failed to handle payment request', error);
      return true; // Don't retry
    }
  }

  // ==========================================
  // Sending
  // ==========================================

  /**
   * Send token transfer
   */
  async sendTokenTransfer(
    recipientPubkey: string,
    payloadJson: string,
    options?: TokenTransferOptions
  ): Promise<boolean> {
    await this.ensureConnected();

    try {
      await this.client?.sendTokenTransfer(recipientPubkey, payloadJson, {
        amount: options?.amount,
        symbol: options?.symbol,
        replyToEventId: options?.replyToEventId,
      });
      return true;
    } catch (error) {
      this.logError('Failed to send token transfer', error);
      return false;
    }
  }

  /**
   * Query pubkey by nametag
   */
  async queryPubkeyByNametag(nametag: string): Promise<string | null> {
    await this.ensureConnected();

    try {
      const cleanTag = nametag.replace('@unicity', '').replace('@', '');
      const pubkey = await this.client?.queryPubkeyByNametag(cleanTag);
      return pubkey ?? null;
    } catch (error) {
      this.logError('Failed to query nametag', error);
      return null;
    }
  }

  /**
   * Publish nametag binding
   */
  async publishNametagBinding(nametag: string, unicityAddress: string): Promise<boolean> {
    await this.ensureConnected();

    try {
      await this.client?.publishNametagBinding(nametag, unicityAddress);
      return true;
    } catch (error) {
      this.logError('Failed to publish nametag binding', error);
      return false;
    }
  }

  /**
   * Publish app-specific data event (NIP-78)
   */
  async publishAppDataEvent(
    kind: number,
    tags: string[][],
    content: string
  ): Promise<string | null> {
    await this.ensureConnected();

    try {
      const eventId = await this.client?.createAndPublishEvent({
        kind,
        tags,
        content,
      });
      return eventId ?? null;
    } catch (error) {
      this.logError('Failed to publish app data event', error);
      return null;
    }
  }

  // ==========================================
  // Storage / Sync State
  // ==========================================

  private async loadProcessedEvents(): Promise<void> {
    try {
      const saved = await this.storage.get(STORAGE_KEYS.PROCESSED_EVENTS);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        this.processedEventIds = new Set(ids);
        this.log(`Loaded ${ids.length} processed event IDs`);
      }
    } catch (error) {
      this.logError('Failed to load processed events', error);
      this.processedEventIds = new Set();
    }
  }

  private async saveProcessedEvents(): Promise<void> {
    try {
      let ids = Array.from(this.processedEventIds);
      if (ids.length > MAX_PROCESSED_EVENTS) {
        ids = ids.slice(-MAX_PROCESSED_EVENTS);
        this.processedEventIds = new Set(ids);
      }
      await this.storage.set(STORAGE_KEYS.PROCESSED_EVENTS, JSON.stringify(ids));
    } catch (error) {
      this.logError('Failed to save processed events', error);
    }
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    this.processedEventIds.add(eventId);
    if (this.processedEventIds.size > MAX_PROCESSED_EVENTS) {
      const first = this.processedEventIds.values().next().value;
      if (first) this.processedEventIds.delete(first);
    }
    await this.saveProcessedEvents();
  }

  private getLastSyncSync(): number {
    // Synchronous fallback for subscription setup
    // Actual value loaded async on connect
    return Math.floor(Date.now() / 1000) - 300; // 5 minutes ago default
  }

  private async getLastSync(): Promise<number> {
    try {
      const saved = await this.storage.get(STORAGE_KEYS.LAST_SYNC);
      if (saved) {
        return parseInt(saved, 10);
      }
    } catch {
      // Ignore
    }
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    await this.storage.set(STORAGE_KEYS.LAST_SYNC, fiveMinutesAgo.toString());
    return fiveMinutesAgo;
  }

  private async updateLastSync(timestamp: number): Promise<void> {
    const current = await this.getLastSync();
    if (timestamp > current) {
      await this.storage.set(STORAGE_KEYS.LAST_SYNC, timestamp.toString());
    }
  }

  // ==========================================
  // Helpers
  // ==========================================

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[NostrSDK] ${message}`);
    }
  }

  private logWarn(message: string, error?: unknown): void {
    if (this.config.debug) {
      console.warn(`[NostrSDK] ${message}`, error ?? '');
    }
  }

  private logError(message: string, error?: unknown): void {
    console.error(`[NostrSDK] ${message}`, error ?? '');
  }
}
