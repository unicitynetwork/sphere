/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  NostrClient,
  NostrKeyManager,
  EventKinds,
  Filter,
  TokenTransferProtocol,
  Event,
  PaymentRequestProtocol,
} from "@unicitylabs/nostr-js-sdk";

// NIP-17 Private Message interface (from SDK)
interface PrivateMessage {
  eventId: string;
  senderPubkey: string;
  recipientPubkey: string;
  content: string;
  timestamp: number;
  kind: number;
  replyToEventId?: string;
}
import { ChatRepository } from "../../../chat/data/ChatRepository";
import {
  ChatMessage,
  MessageStatus,
  MessageType,
} from "../../../chat/data/models";
import { IdentityManager } from "./IdentityManager";
import { Buffer } from "buffer";
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { TransferTransaction } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction";
import { AddressScheme } from "@unicitylabs/state-transition-sdk/lib/address/AddressScheme";
import { NametagService } from "./NametagService";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";
import { ServiceProvider } from "./ServiceProvider";
import { RegistryService } from "./RegistryService";
import {
  PaymentRequestStatus,
  TokenStatus,
  Token as UiToken,
  type IncomingPaymentRequest,
} from "../data/model";
import { v4 as uuidv4 } from "uuid";
import { STORAGE_KEYS } from "../../../../config/storageKeys";
import { NOSTR_CONFIG } from "../../../../config/nostr.config";
import { recordActivity } from "../../../../services/ActivityService";
import { addReceivedTransaction } from "../../../../services/TransactionHistoryService";

export class NostrService {
  private static instance: NostrService;
  private client: NostrClient | null = null;
  private identityManager: IdentityManager;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private paymentRequests: IncomingPaymentRequest[] = [];
  private chatRepository: ChatRepository;
  private dmListeners: ((message: ChatMessage) => void)[] = [];

  private processedEventIds: Set<string> = new Set(); // Persistent storage for all processed events

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
    this.chatRepository = ChatRepository.getInstance();
    this.loadProcessedEvents();
  }

  static getInstance(identityManager?: IdentityManager): NostrService {
    if (!NostrService.instance) {
      const manager = identityManager || IdentityManager.getInstance();
      NostrService.instance = new NostrService(manager);
    }
    return NostrService.instance;
  }

  async start() {
    // Already connected
    if (this.isConnected) return;

    // Connection in progress - wait for it
    if (this.isConnecting && this.connectPromise) {
      return this.connectPromise;
    }

    // Start connection
    this.isConnecting = true;
    this.connectPromise = this.doConnect();

    try {
      await this.connectPromise;
    } finally {
      this.isConnecting = false;
      this.connectPromise = null;
    }
  }

  /**
   * Reset the NostrService connection to reinitialize with current identity.
   * Call this when wallet changes (new wallet created or restored) to ensure
   * the correct keypair is used for encryption/decryption.
   */
  async reset(): Promise<void> {
    console.log("🔄 Resetting NostrService connection...");

    // Disconnect existing client
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        console.warn("Error disconnecting Nostr client:", err);
      }
      this.client = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.connectPromise = null;

    console.log("✅ NostrService reset complete, ready for reconnection");
  }

  private async doConnect(): Promise<void> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) throw new Error("No identity found for Nostr");

    const secretKey = Buffer.from(identity.privateKey, "hex");
    const keyManager = NostrKeyManager.fromPrivateKey(secretKey);

    this.client = new NostrClient(keyManager);

    console.log("📡 Connecting to Nostr relays...");
    try {
      await this.client.connect(...NOSTR_CONFIG.RELAYS);
      this.isConnected = true;
      console.log("✅ Connected to Nostr relays");

      this.subscribeToPrivateEvents(keyManager.getPublicKeyHex());
    } catch (error) {
      console.error("❌ Failed to connect to Nostr", error);
    }
  }

  private subscribeToPrivateEvents(publicKey: string) {
    if (!this.client) return;

    // Subscribe to wallet events (token transfers, payment requests) with since filter
    const lastSync = this.getOrInitLastSync();
    const walletFilter = new Filter();
    walletFilter.kinds = [
      EventKinds.TOKEN_TRANSFER,
      EventKinds.PAYMENT_REQUEST,
    ];
    walletFilter["#p"] = [publicKey];
    walletFilter.since = lastSync;

    this.client.subscribe(walletFilter, {
      onEvent: (event) => this.handleSubscriptionEvent(event, true),
      onEndOfStoredEvents: () => {
        console.log("End of stored wallet events");
      },
    });

    // Subscribe to chat events (NIP-17 gift wrap) without since filter
    // Chat messages are deduplicated via ChatRepository (localStorage)
    const chatFilter = new Filter();
    chatFilter.kinds = [EventKinds.GIFT_WRAP];
    chatFilter["#p"] = [publicKey];

    this.client.subscribe(chatFilter, {
      onEvent: (event) => this.handleSubscriptionEvent(event, false),
      onEndOfStoredEvents: () => {
        console.log("End of stored chat events");
      },
    });
  }

  private async handleSubscriptionEvent(event: Event, isWalletEvent: boolean) {
    // Deduplicate by event ID (persistent storage - works across page reloads)
    if (this.isEventProcessed(event.id)) {
      console.log(`⏭️ Event ${event.id.slice(0, 8)} already processed (persistent check), skipping`);
      return;
    }

    // For wallet events, skip old events based on lastSync
    if (isWalletEvent) {
      const currentLastSync = this.getOrInitLastSync();
      if (event.created_at < currentLastSync) {
        console.log(
          `⏭️ Skipping old event (Time: ${event.created_at} <= Sync: ${currentLastSync})`
        );
        return;
      }
    }

    console.log(`📥 Processing ${isWalletEvent ? 'wallet' : 'chat'} event kind=${event.kind}`);

    // Process the event - now returns token for TOKEN_TRANSFER
    const result = await this.handleIncomingEvent(event);

    if (result.success) {
      // For token transfers, use background loop for batched sync
      if (event.kind === EventKinds.TOKEN_TRANSFER && result.token) {
        try {
          const { InventoryBackgroundLoopsManager } = await import("./InventoryBackgroundLoops");
          const loopsManager = InventoryBackgroundLoopsManager.getInstance(this.identityManager);

          // Ensure loops are initialized
          if (!loopsManager.isReady()) {
            await loopsManager.initialize();
          }

          const receiveLoop = loopsManager.getReceiveLoop();

          // Set callback to mark events as processed (only need to do once)
          receiveLoop.setEventProcessedCallback((eventId) => {
            this.markEventAsProcessed(eventId);
          });

          // Queue token for batched sync
          await receiveLoop.queueIncomingToken(result.token, event.id, event.pubkey);

          console.log(`📥 Token ${event.id.slice(0, 8)} queued for batch sync`);
        } catch (err) {
          console.error(`Failed to queue token for batch sync:`, err);
          // Fallback: mark as processed anyway since token is saved locally
          this.markEventAsProcessed(event.id);
        }
      } else {
        // For non-token events (chat, payment requests), mark as processed immediately
        this.markEventAsProcessed(event.id);
        console.log(`✅ Event ${event.id.slice(0, 8)} processed`);
      }
    } else {
      console.warn(`⚠️ Event ${event.id.slice(0, 8)} processing failed, will retry on next connect`);
    }

    // Update lastSync for wallet events
    if (isWalletEvent && result.success) {
      this.updateLastSync(event.created_at);
    }
  }

  private getOrInitLastSync(): number {
    const saved = localStorage.getItem(STORAGE_KEYS.NOSTR_LAST_SYNC);
    if (saved) {
      return parseInt(saved);
    } else {
      // For new wallets, set lastSync to 5 minutes ago to catch any tokens
      // that were sent during wallet creation (e.g., from faucet)
      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
      localStorage.setItem(STORAGE_KEYS.NOSTR_LAST_SYNC, fiveMinutesAgo.toString());
      return fiveMinutesAgo;
    }
  }

  private updateLastSync(timestamp: number) {
    const current = this.getOrInitLastSync();
    if (timestamp > current) {
      localStorage.setItem(STORAGE_KEYS.NOSTR_LAST_SYNC, timestamp.toString());
    }
  }

  // Note: waitForSyncCompletion() removed - SyncQueue handles queuing automatically

  private loadProcessedEvents() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.NOSTR_PROCESSED_EVENTS);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        this.processedEventIds = new Set(ids);
        console.log(`📋 Loaded ${ids.length} processed event IDs from persistent storage`);
      }
    } catch (error) {
      console.error("Failed to load processed events", error);
      this.processedEventIds = new Set();
    }
  }

  private saveProcessedEvents() {
    try {
      let ids = Array.from(this.processedEventIds);

      // Keep only the last NOSTR_CONFIG.MAX_PROCESSED_EVENTS entries (FIFO)
      if (ids.length > NOSTR_CONFIG.MAX_PROCESSED_EVENTS) {
        ids = ids.slice(-NOSTR_CONFIG.MAX_PROCESSED_EVENTS);
        this.processedEventIds = new Set(ids);
      }

      localStorage.setItem(STORAGE_KEYS.NOSTR_PROCESSED_EVENTS, JSON.stringify(ids));
    } catch (error) {
      console.error("Failed to save processed events", error);
    }
  }

  private markEventAsProcessed(eventId: string) {
    this.processedEventIds.add(eventId);

    // If exceeding limit, remove oldest entry
    if (this.processedEventIds.size > NOSTR_CONFIG.MAX_PROCESSED_EVENTS) {
      const firstId = this.processedEventIds.values().next().value;
      if (firstId) {
        this.processedEventIds.delete(firstId);
      }
    }

    this.saveProcessedEvents();
  }

  private isEventProcessed(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  private async handleIncomingEvent(event: Event): Promise<{ success: boolean; token?: UiToken }> {
    console.log(
      `Received event kind=${event.kind} from=${event.pubkey.slice(0, 16)}`
    );
    if (event.kind === EventKinds.TOKEN_TRANSFER) {
      const token = await this.handleTokenTransfer(event);
      return { success: token !== null, token: token || undefined };
    } else if (event.kind === EventKinds.GIFT_WRAP) {
      console.log("Received NIP-17 gift-wrapped message");
      this.handleGiftWrappedMessage(event);
      return { success: true }; // Chat messages always succeed (stored in local chat repo)
    } else if (event.kind === EventKinds.PAYMENT_REQUEST) {
      this.handlePaymentRequest(event);
      return { success: true }; // Payment requests are in-memory only
    } else {
      console.log(`Unhandled event kind - ${event.kind}`);
      return { success: true }; // Unknown events - don't retry
    }
  }

  private async handlePaymentRequest(event: Event) {
    try {
      const keyManager = await this.getKeyManager();
      if (!keyManager) return;

      const request = await PaymentRequestProtocol.parsePaymentRequest(
        event,
        keyManager
      );

      const registry = RegistryService.getInstance();
      const def = registry.getCoinDefinition(request.coinId);
      const symbol = def?.symbol || "UNKNOWN";

      const incomingRequest: IncomingPaymentRequest = {
        id: event.id,
        senderPubkey: event.pubkey,
        amount: request.amount,
        coinId: request.coinId,
        symbol: symbol,
        message: request.message,
        recipientNametag: request.recipientNametag,
        requestId: request.requestId,
        timestamp: event.created_at * 1000,
        status: PaymentRequestStatus.PENDING,
      };

      if (!this.paymentRequests.find((r) => r.id === incomingRequest.id)) {
        this.paymentRequests.unshift(incomingRequest);
        this.notifyRequestsUpdated();

        console.log("📬 Payment Request received:", request);
      }
    } catch (error) {
      console.error("Failed to handle payment request", error);
    }
  }

  private notifyRequestsUpdated() {
    window.dispatchEvent(new CustomEvent("payment-requests-updated"));
  }

  acceptPaymentRequest(request: IncomingPaymentRequest) {
    this.updateRequestStatus(request.id, PaymentRequestStatus.ACCEPTED);
  }

  rejectPaymentRequest(request: IncomingPaymentRequest) {
    this.updateRequestStatus(request.id, PaymentRequestStatus.REJECTED);
  }

  paidPaymentRequest(request: IncomingPaymentRequest) {
    this.updateRequestStatus(request.id, PaymentRequestStatus.PAID);
  }

  clearPaymentRequest(requestId: string) {
    const currentList = this.paymentRequests.filter((p) => p.id !== requestId);
    this.paymentRequests = currentList;
  }

  clearProcessedPaymentRequests() {
    const currentList = this.paymentRequests.filter(
      (p) => p.status === PaymentRequestStatus.PENDING
    );
    this.paymentRequests = currentList;
  }

  updateRequestStatus(id: string, status: PaymentRequestStatus) {
    const req = this.paymentRequests.find((r) => r.id === id);
    if (req) {
      req.status = status;
      this.notifyRequestsUpdated();
    }
  }

  getPaymentRequests(): IncomingPaymentRequest[] {
    return this.paymentRequests;
  }

  private async handleTokenTransfer(event: Event): Promise<UiToken | null> {
    try {
      const keyManager = await this.getKeyManager();
      if (!keyManager) {
        console.error("KeyManager is undefined");
        return null;
      }

      const tokenJson = await TokenTransferProtocol.parseTokenTransfer(
        event,
        keyManager
      );

      console.log("Token transfer decrypted successfully!");

      if (
        tokenJson.startsWith("{") &&
        tokenJson.includes("sourceToken") &&
        tokenJson.includes("transferTx")
      ) {
        console.log("Processing proper token transfer with finalization ...");

        let payloadObj: Record<string, any>;
        try {
          payloadObj = JSON.parse(tokenJson);
        } catch (error) {
          console.warn("Failed to parse JSON:", error);
          return null;
        }
        return await this.handleProperTokenTransfer(payloadObj, event.pubkey);
      }
      return null; // Unknown transfer format
    } catch (error) {
      console.error("Failed to handle token transfer", error);
      return null;
    }
  }

  private async handleProperTokenTransfer(payloadObj: Record<string, any>, senderPubkey: string): Promise<UiToken | null> {
    try {
      let sourceTokenInput = payloadObj["sourceToken"];
      let transferTxInput = payloadObj["transferTx"];

      if (typeof sourceTokenInput === "string") {
        try {
          sourceTokenInput = JSON.parse(sourceTokenInput);
        } catch (e) {
          console.error("Failed to parse sourceToken string", e);
        }
      }

      if (typeof transferTxInput === "string") {
        try {
          transferTxInput = JSON.parse(transferTxInput);
        } catch (e) {
          console.error("Failed to parse transferTx string", e);
        }
      }

      if (!sourceTokenInput || !transferTxInput) {
        console.error("Missing sourceToken or transferTx in payload");
        return null;
      }

      const sourceToken = await Token.fromJSON(sourceTokenInput);
      const transferTx = await TransferTransaction.fromJSON(transferTxInput);

      return await this.finalizeTransfer(sourceToken, transferTx, senderPubkey);
    } catch (error) {
      console.error("Error handling proper token transfer", error);
      return null;
    }
  }

  private async finalizeTransfer(
    sourceToken: Token<any>,
    transferTx: TransferTransaction,
    senderPubkey: string
  ): Promise<UiToken | null> {
    try {
      const recipientAddress = transferTx.data.recipient;
      console.log(`Recipient address: ${recipientAddress}`);

      const addressScheme = recipientAddress.scheme;
      console.log(`Address scheme: ${addressScheme}`);

      if (addressScheme === AddressScheme.PROXY) {
        console.log("Transfer is to PROXY address - finalization required");

        const nametagService = NametagService.getInstance(this.identityManager);
        const allNametags = await nametagService.getAllNametagTokens();

        if (allNametags.length === 0) {
          console.error("No nametags configured for this wallet");
          return null;
        }

        let myNametagToken: Token<any> | null = null;

        for (const nametag of allNametags) {
          const proxy = await ProxyAddress.fromTokenId(nametag.id);
          if (proxy.address === recipientAddress.address) {
            myNametagToken = nametag;
          }
        }

        if (myNametagToken === null) {
          console.error("Transfer is not for any of my nametags!");
          console.error(`Got: ${recipientAddress.address}`);
          console.error(`My nametags: ${allNametags.toString()}`);
          return null;
        }

        console.log("Transfer is for my nametag!");

        const identity = await this.identityManager.getCurrentIdentity();

        if (identity === null) {
          console.error(
            "No wallet identity found, can't finalize the transfer!"
          );
          return null;
        }

        const secret = Buffer.from(identity.privateKey, "hex");
        const signingService = await SigningService.createFromSecret(secret);

        const transferSalt = transferTx.data.salt;

        const recipientPredicate = await UnmaskedPredicate.create(
          sourceToken.id,
          sourceToken.type,
          signingService,
          HashAlgorithm.SHA256,
          transferSalt
        );

        const recipientState = new TokenState(recipientPredicate, null);

        const client = ServiceProvider.stateTransitionClient;
        const rootTrustBase = ServiceProvider.getRootTrustBase();

        let finalizedToken: Token<any>;

        // DEV MODE: Skip nametag token verification if trust base verification is disabled
        if (ServiceProvider.isTrustBaseVerificationSkipped()) {
          console.warn("⚠️ Finalizing transfer WITHOUT nametag verification (dev mode)");
          // Create token directly without SDK verification
          // Get the source token's JSON and modify it for the finalized state
          const sourceTxf = sourceToken.toJSON();
          const existingTransactions = sourceTxf.transactions || [];

          // Calculate the previous state hash (sender's current state before transfer)
          const previousStateHash = await sourceToken.state.calculateHash();
          const previousStateHashStr = previousStateHash.toJSON();

          // Calculate the new state hash (required for token chain validity)
          const newStateHash = await recipientState.calculateHash();
          const newStateHashStr = newStateHash.toJSON();

          // Create the new transaction with proper state hash chain
          const newTxJson = {
            ...transferTx.toJSON(),
            previousStateHash: previousStateHashStr,
            newStateHash: newStateHashStr,
          };

          const finalizedTxf = {
            ...sourceTxf,
            state: recipientState.toJSON(),
            transactions: [...existingTransactions, newTxJson],
            nametags: [myNametagToken.toJSON()],
          };
          finalizedToken = await Token.fromJSON(finalizedTxf);
        } else {
          // Try finalization with existing nametag token first
          // If it fails with "Nametag tokens verification failed", refresh proof and retry
          try {
            finalizedToken = await client.finalizeTransaction(
              rootTrustBase,
              sourceToken,
              recipientState,
              transferTx,
              [myNametagToken]
            );
          } catch (finalizeError: unknown) {
            const errorMessage = finalizeError instanceof Error ? finalizeError.message : String(finalizeError);

            // Check if this is a nametag verification failure (stale proof)
            if (errorMessage.includes("Nametag tokens verification failed")) {
              console.log("📦 Nametag proof appears stale, refreshing and retrying...");

              try {
                const refreshedNametag = await nametagService.refreshNametagProof();
                if (!refreshedNametag) {
                  console.error("Failed to refresh nametag proof");
                  throw finalizeError;
                }

                // Retry with refreshed nametag
                myNametagToken = refreshedNametag;
                finalizedToken = await client.finalizeTransaction(
                  rootTrustBase,
                  sourceToken,
                  recipientState,
                  transferTx,
                  [myNametagToken]
                );
                console.log("✅ Finalization succeeded after proof refresh");
              } catch (refreshError: unknown) {
                const refreshErrorMsg = refreshError instanceof Error ? refreshError.message : String(refreshError);

                // Check if this is a recovery failure or exclusion proof error
                // With automatic recovery (TOKEN_INVENTORY_SPEC.md Section 13.26), we now
                // attempt to re-submit the commitment before giving up
                if (refreshErrorMsg.includes("recovery failed") || refreshErrorMsg.includes("exclusion proof")) {
                  console.error("❌ Nametag recovery failed after all attempts.");

                  // Dispatch custom event for UI notification
                  window.dispatchEvent(new CustomEvent("nametag-recovery-failed", {
                    detail: {
                      message: "Your nametag proof could not be recovered automatically. Please re-register your nametag.",
                      error: refreshErrorMsg
                    }
                  }));

                  // Re-throw with user-friendly message
                  throw new Error(
                    "Cannot receive token: Automatic nametag proof recovery failed. " +
                    "Please go to Settings and re-register your nametag."
                  );
                }

                // Other refresh errors - re-throw original
                throw finalizeError;
              }
            } else {
              // Different error, re-throw
              throw finalizeError;
            }
          }
        }

        console.log("Token finalized successfully!");
        return await this.saveReceivedToken(finalizedToken, senderPubkey);
      } else {
        console.log(
          "Transfer is to DIRECT address - finalizing with direct predicate"
        );

        // For DIRECT addresses, we still need to finalize the transfer to update the token state
        const identity = await this.identityManager.getCurrentIdentity();

        if (identity === null) {
          console.error(
            "No wallet identity found, can't finalize the direct transfer!"
          );
          return null;
        }

        const secret = Buffer.from(identity.privateKey, "hex");
        const signingService = await SigningService.createFromSecret(secret);

        const transferSalt = transferTx.data.salt;

        // Create the recipient predicate using UnmaskedPredicate (same as PROXY but no proxy token reveal)
        const recipientPredicate = await UnmaskedPredicate.create(
          sourceToken.id,
          sourceToken.type,
          signingService,
          HashAlgorithm.SHA256,
          transferSalt
        );

        const recipientState = new TokenState(recipientPredicate, null);

        const client = ServiceProvider.stateTransitionClient;
        const rootTrustBase = ServiceProvider.getRootTrustBase();

        let finalizedToken: Token<any>;

        // DEV MODE: Skip verification if trust base verification is disabled
        if (ServiceProvider.isTrustBaseVerificationSkipped()) {
          console.warn("⚠️ Finalizing DIRECT transfer WITHOUT verification (dev mode)");
          // Create token directly without SDK verification
          // Get the source token's JSON and modify it for the finalized state
          const sourceTxf = sourceToken.toJSON();
          const existingTransactions = sourceTxf.transactions || [];

          // Calculate the previous state hash (sender's current state before transfer)
          const previousStateHash = await sourceToken.state.calculateHash();
          const previousStateHashStr = previousStateHash.toJSON();

          // Calculate the new state hash (required for token chain validity)
          const newStateHash = await recipientState.calculateHash();
          const newStateHashStr = newStateHash.toJSON();

          // Create the new transaction with proper state hash chain
          const newTxJson = {
            ...transferTx.toJSON(),
            previousStateHash: previousStateHashStr,
            newStateHash: newStateHashStr,
          };

          const finalizedTxf = {
            ...sourceTxf,
            state: recipientState.toJSON(),
            transactions: [...existingTransactions, newTxJson],
            nametags: [], // No nametag tokens for DIRECT addresses
          };
          finalizedToken = await Token.fromJSON(finalizedTxf);
        } else {
          // Finalize with empty proxy tokens array for DIRECT addresses
          finalizedToken = await client.finalizeTransaction(
            rootTrustBase,
            sourceToken,
            recipientState,
            transferTx,
            [] // No proxy tokens for DIRECT addresses
          );
        }

        console.log("Token finalized successfully (DIRECT address)!");
        return await this.saveReceivedToken(finalizedToken, senderPubkey);
      }
    } catch (error) {
      console.error("Error occured while finalizing transfer:", error);
      return null;
    }
  }

  private async saveReceivedToken(
    token: Token<any>,
    senderPubkey: string
  ): Promise<UiToken | null> {
    let amount = undefined;
    let coinId = undefined;
    let symbol = undefined;
    let iconUrl = undefined;

    const coinsOpt = token.coins;

    const coinData = coinsOpt;

    if (coinData) {
      const rawCoins = coinData.coins;
      console.log("🔍 Raw Coins:", rawCoins);

      let key: any = null;
      let val: any = null;

      if (Array.isArray(rawCoins)) {
        const firstItem = rawCoins[0];
        if (Array.isArray(firstItem) && firstItem.length === 2) {
          key = firstItem[0];
          val = firstItem[1];
        } else {
          console.warn("Unknown array format", firstItem);
        }
      } else if (typeof rawCoins === "object") {
        const keys = Object.keys(rawCoins);
        if (keys.length > 0) {
          key = keys[0];
          val = (rawCoins as any)[key];
        }
      }

      if (val) {
        amount = val.toString();
      }

      if (key) {
        console.log("🔑 Processing Key:", key);
        const bytes = key.data || key;
        coinId = Buffer.from(bytes).toString("hex");
      }
    }

    console.log(`✅ FINAL PARSE: CoinID=${coinId}, Amount=${amount}`);

    if (!coinId || amount === "0" || coinId === "0" || coinId === "undefined") {
      console.error("❌ Invalid token data. Skipping.");
      return null;
    }

    if (coinId) {
      const registryService = RegistryService.getInstance();
      const def = registryService.getCoinDefinition(coinId);
      if (def) {
        symbol = def.symbol || "UNK";
        iconUrl = registryService.getIconUrl(def) || undefined;
      }
    }

    // Use SDK's native token serialization - no custom normalization needed
    const uiToken = new UiToken({
      id: uuidv4(),
      name: symbol ? symbol : "Unicity Token",
      type: token.type.toString(),
      symbol: symbol,
      jsonData: JSON.stringify(token.toJSON()),
      status: TokenStatus.CONFIRMED,
      amount: amount,
      coinId: coinId,
      iconUrl: iconUrl,
      timestamp: Date.now(),
      senderPubkey: senderPubkey,
    });

    // Token will be saved via InventorySync through the background loop mechanism
    // No need to save here - queueIncomingToken() handles the sync
    console.log(`📦 Token prepared for sync: ${uiToken.id}`);

    // Record to transaction history
    if (amount && coinId) {
      addReceivedTransaction(
        amount,
        coinId,
        symbol || "UNK",
        iconUrl,
        senderPubkey,
        Date.now()
      );
    }

    // Record token transfer activity (fire and forget)
    recordActivity("token_transfer", {
      isPublic: false,
      data: { amount, symbol },
    });

    return uiToken;
  }

  async queryPubkeyByNametag(nametag: string): Promise<string | null> {
    if (!this.client) await this.start();

    try {
      const cleanTag = nametag.replace("@unicity", "").replace("@", "");
      console.log(`Querying pubkey for: ${cleanTag}`);

      const pubkey = await this.client?.queryPubkeyByNametag(cleanTag);
      return pubkey || null;
    } catch (error) {
      console.error("Failed to query nametag", error);
      return null;
    }
  }

  async sendTokenTransfer(
    recipientPubkey: string,
    payloadJson: string,
    amount?: bigint,
    symbol?: string,
    replyToEventId?: string
  ): Promise<boolean> {
    if (!this.client) await this.start();

    try {
      console.log(`Sending token transfer to ${recipientPubkey}...`);
      await this.client?.sendTokenTransfer(recipientPubkey, payloadJson, {
        amount,
        symbol,
        replyToEventId,
      });
      return true;
    } catch (error) {
      console.error("Failed to send token transfer", error);
      return false;
    }
  }

  /**
   * Send token payload to recipient via Nostr
   * Used by NostrDeliveryQueue for background delivery
   * @returns Event ID of the sent transfer
   */
  async sendTokenToRecipient(recipientPubkey: string, payloadJson: string): Promise<string> {
    if (!this.client) await this.start();

    // Parse payload to extract amount/symbol for metadata
    let amount: bigint | undefined;
    let symbol: string | undefined;

    try {
      const payload = JSON.parse(payloadJson);
      if (payload.amount) {
        amount = BigInt(payload.amount);
      }
      if (payload.symbol) {
        symbol = payload.symbol;
      }
    } catch {
      // Ignore parsing errors - amount/symbol are optional metadata
    }

    // Send token transfer and get event ID
    // The SDK's sendTokenTransfer returns the event ID
    const eventId = await this.client?.sendTokenTransfer(recipientPubkey, payloadJson, {
      amount,
      symbol,
    });

    if (!eventId) {
      throw new Error('Failed to send token transfer - no event ID returned');
    }

    return eventId;
  }

  async publishNametagBinding(
    nametag: string,
    unicityAddress: string
  ): Promise<boolean> {
    if (!this.client) await this.start();

    try {
      await this.client?.publishNametagBinding(nametag, unicityAddress);
      return true;
    } catch (error) {
      console.error("Failed to publish nametag", error);
      return false;
    }
  }

  private async getKeyManager(): Promise<NostrKeyManager | undefined> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity || !this.client) return;

    const secretKey = Buffer.from(identity.privateKey, "hex");
    return NostrKeyManager.fromPrivateKey(secretKey);
  }

  // ==========================================
  // DM Chat Methods (NIP-17)
  // ==========================================

  /**
   * Wrapper format for messages that includes sender's nametag.
   * Messages are sent as JSON: {"senderNametag": "name", "text": "message"}
   */
  private wrapMessageContent(content: string, senderNametag: string | null): string {
    if (senderNametag) {
      return JSON.stringify({
        senderNametag: senderNametag,
        text: content,
      });
    }
    return content;
  }

  /**
   * Unwrap message content and extract sender's nametag if present.
   */
  private unwrapMessageContent(content: string): { text: string; senderNametag: string | null } {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed.text !== undefined) {
        return {
          text: parsed.text,
          senderNametag: parsed.senderNametag || null,
        };
      }
    } catch {
      // Not JSON, return original content
    }
    return { text: content, senderNametag: null };
  }

  private async handleGiftWrappedMessage(event: Event) {
    try {
      if (!this.client) {
        console.error("No client for unwrapping message");
        return;
      }

      // Unwrap NIP-17 gift-wrapped message
      const privateMessage: PrivateMessage = this.client.unwrapPrivateMessage(event);

      // Check if it's a chat message (kind 14) or read receipt (kind 15)
      if (privateMessage.kind === 14) {
        // Chat message
        this.handleIncomingChatMessage(privateMessage);
      } else if (privateMessage.kind === 15) {
        // Read receipt
        this.handleIncomingReadReceipt(privateMessage);
      } else {
        console.log(`Unknown NIP-17 message kind: ${privateMessage.kind}`);
      }
    } catch (error) {
      console.error("Failed to handle gift-wrapped message", error);
    }
  }

  private handleIncomingChatMessage(privateMessage: PrivateMessage) {
    const senderPubkey = privateMessage.senderPubkey;
    const rawContent = privateMessage.content;

    // Unwrap message content to extract sender's nametag if present
    const { text: content, senderNametag } = this.unwrapMessageContent(rawContent);

    // Check if this message already exists (e.g., after page reload)
    const existingMessage = this.chatRepository.getMessage(privateMessage.eventId);
    if (existingMessage) {
      console.log(`📩 Skipping already saved message ${privateMessage.eventId.slice(0, 8)}`);
      return;
    }

    console.log(`📩 NIP-17 DM from ${senderNametag || senderPubkey.slice(0, 8)}: ${content.slice(0, 50)}...`);

    // Get or create conversation with sender's nametag if available
    const conversation = this.chatRepository.getOrCreateConversation(senderPubkey, senderNametag || undefined);

    // If we received a nametag and the conversation didn't have one, update it
    if (senderNametag && !conversation.participantNametag) {
      conversation.participantNametag = senderNametag;
      this.chatRepository.updateConversationNametag(conversation.id, senderNametag);
    }

    // Create and save message (with unwrapped content and sender nametag)
    const message = new ChatMessage({
      id: privateMessage.eventId,
      conversationId: conversation.id,
      content: content,
      timestamp: privateMessage.timestamp * 1000,
      isFromMe: false,
      status: MessageStatus.DELIVERED,
      type: MessageType.TEXT,
      senderPubkey: senderPubkey,
      senderNametag: senderNametag || undefined,
    });

    this.chatRepository.saveMessage(message);
    this.chatRepository.incrementUnreadCount(conversation.id);

    // Notify listeners
    this.notifyDMListeners(message);

    // Send read receipt
    this.sendReadReceipt(senderPubkey, privateMessage.eventId).catch(console.error);
  }

  private handleIncomingReadReceipt(privateMessage: PrivateMessage) {
    const replyToEventId = privateMessage.replyToEventId;
    if (replyToEventId) {
      console.log(`📬 Read receipt for message: ${replyToEventId.slice(0, 8)}`);
      this.chatRepository.updateMessageStatus(replyToEventId, MessageStatus.READ);
    }
  }

  async sendReadReceipt(recipientPubkey: string, messageEventId: string): Promise<void> {
    if (!this.client) await this.start();
    try {
      await this.client?.sendReadReceipt(recipientPubkey, messageEventId);
      console.log(`✅ Read receipt sent for ${messageEventId.slice(0, 8)}`);
    } catch (error) {
      console.error("Failed to send read receipt", error);
    }
  }

  async sendDirectMessage(
    recipientPubkey: string,
    content: string,
    recipientNametag?: string
  ): Promise<ChatMessage | null> {
    if (!this.client) await this.start();

    try {
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) throw new Error("No identity for sending DM");

      // Get sender's nametag to include in message
      const senderNametag = await this.getMyNametag();

      // Get or create conversation
      const conversation = this.chatRepository.getOrCreateConversation(
        recipientPubkey,
        recipientNametag
      );

      // Create message with pending status
      const message = new ChatMessage({
        conversationId: conversation.id,
        content: content,
        timestamp: Date.now(),
        isFromMe: true,
        status: MessageStatus.PENDING,
        type: MessageType.TEXT,
        senderPubkey: identity.publicKey,
      });

      // Save immediately (optimistic update)
      this.chatRepository.saveMessage(message);

      // Wrap content with sender's nametag for recipient to see who sent it
      const wrappedContent = this.wrapMessageContent(content, senderNametag);

      // Send via Nostr using NIP-17 private messaging
      const eventId = await this.client?.sendPrivateMessage(
        recipientPubkey,
        wrappedContent
      );

      if (eventId) {
        // Update message: replace with new ID (for read receipt tracking) and status
        const originalId = message.id;
        message.id = eventId;
        message.status = MessageStatus.SENT;
        // Delete old message and save updated one
        this.chatRepository.deleteMessage(originalId);
        this.chatRepository.saveMessage(message);
        console.log(`📤 NIP-17 DM sent to ${recipientPubkey.slice(0, 8)} from @${senderNametag || 'unknown'}`);
        return message;
      } else {
        // Update status to failed
        this.chatRepository.updateMessageStatus(message.id, MessageStatus.FAILED);
        return null;
      }
    } catch (error) {
      console.error("Failed to send DM", error);
      return null;
    }
  }

  async sendDirectMessageByNametag(
    nametag: string,
    content: string
  ): Promise<ChatMessage | null> {
    if (!this.client) await this.start();

    try {
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) throw new Error("No identity for sending DM");

      // Get sender's nametag to include in message
      const senderNametag = await this.getMyNametag();

      // Resolve nametag to pubkey first for conversation tracking
      const pubkey = await this.queryPubkeyByNametag(nametag);
      if (!pubkey) {
        console.error(`Could not resolve nametag: ${nametag}`);
        return null;
      }

      // Get or create conversation
      const conversation = this.chatRepository.getOrCreateConversation(pubkey, nametag);

      // Create message with pending status
      const message = new ChatMessage({
        conversationId: conversation.id,
        content: content,
        timestamp: Date.now(),
        isFromMe: true,
        status: MessageStatus.PENDING,
        type: MessageType.TEXT,
        senderPubkey: identity.publicKey,
      });

      // Save immediately (optimistic update)
      this.chatRepository.saveMessage(message);

      // Wrap content with sender's nametag for recipient to see who sent it
      const wrappedContent = this.wrapMessageContent(content, senderNametag);

      // Send via Nostr using NIP-17 with nametag (SDK auto-resolves)
      const eventId = await this.client?.sendPrivateMessageToNametag(
        nametag.replace("@", ""),
        wrappedContent
      );

      if (eventId) {
        // Update message: replace with new ID (for read receipt tracking) and status
        const originalId = message.id;
        message.id = eventId;
        message.status = MessageStatus.SENT;
        // Delete old message and save updated one
        this.chatRepository.deleteMessage(originalId);
        this.chatRepository.saveMessage(message);
        console.log(`📤 NIP-17 DM sent to @${nametag} from @${senderNametag || 'unknown'}`);
        return message;
      } else {
        this.chatRepository.updateMessageStatus(message.id, MessageStatus.FAILED);
        return null;
      }
    } catch (error) {
      console.error("Failed to send DM by nametag", error);
      return null;
    }
  }

  addDMListener(listener: (message: ChatMessage) => void): void {
    this.dmListeners.push(listener);
  }

  removeDMListener(listener: (message: ChatMessage) => void): void {
    this.dmListeners = this.dmListeners.filter((l) => l !== listener);
  }

  private notifyDMListeners(message: ChatMessage): void {
    this.dmListeners.forEach((listener) => listener(message));
    window.dispatchEvent(new CustomEvent("dm-received", { detail: message }));
  }

  getMyPublicKey(): string | null {
    const keyManager = this.client?.getKeyManager();
    return keyManager?.getPublicKeyHex() || null;
  }

  async getMyNametag(): Promise<string | null> {
    const nametagService = NametagService.getInstance(this.identityManager);
    return nametagService.getActiveNametag();
  }

  // ==========================================
  // App-Specific Data Publishing (NIP-78)
  // ==========================================

  /**
   * Publish an app-specific data event to Nostr relays.
   * Used for IPFS CID pin announcements (kind 30078).
   *
   * @param kind - Event kind (e.g., 30078 for app-specific data)
   * @param tags - Event tags array (e.g., [["d", "ipfs-pin"], ["cid", "Qm..."]])
   * @param content - Event content (can be empty string or JSON)
   * @returns Event ID if successful, null otherwise
   */
  async publishAppDataEvent(
    kind: number,
    tags: string[][],
    content: string
  ): Promise<string | null> {
    if (!this.client) {
      await this.start();
    }

    try {
      const keyManager = await this.getKeyManager();
      if (!keyManager || !this.client) {
        console.error("Cannot publish app data event: no key manager or client");
        return null;
      }

      // Create and sign the event
      // The SDK's NostrClient createAndPublishEvent expects an UnsignedEventData object
      const eventId = await this.client.createAndPublishEvent({
        kind,
        tags,
        content,
      });

      if (eventId) {
        console.log(`📤 Published app data event (kind ${kind}): ${eventId.slice(0, 8)}...`);
      }

      return eventId || null;
    } catch (error) {
      console.error("Failed to publish app data event:", error);
      return null;
    }
  }
}
