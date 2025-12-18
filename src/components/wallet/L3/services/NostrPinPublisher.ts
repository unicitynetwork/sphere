/**
 * NostrPinPublisher
 *
 * Listens for IPFS storage events and publishes CID announcements
 * to Nostr relays. Pin services subscribed to these relays will
 * automatically pin the announced content.
 *
 * Event flow:
 * 1. IpfsStorageService stores data to IPFS
 * 2. Emits "ipfs-storage-event" with type "storage:completed"
 * 3. NostrPinPublisher catches event and publishes to Nostr
 * 4. Remote pin services receive and pin the CID
 */

import { NOSTR_PIN_CONFIG } from "../../../../config/nostrPin.config";
import { NostrService } from "./NostrService";
import type { StorageEvent } from "./IpfsStorageService";

export class NostrPinPublisher {
  private static instance: NostrPinPublisher | null = null;
  private isStarted = false;
  private boundHandler: ((e: Event) => void) | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): NostrPinPublisher {
    if (!NostrPinPublisher.instance) {
      NostrPinPublisher.instance = new NostrPinPublisher();
    }
    return NostrPinPublisher.instance;
  }

  /**
   * Start listening for IPFS storage events
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    if (!NOSTR_PIN_CONFIG.enabled) {
      if (NOSTR_PIN_CONFIG.debug) {
        console.log("📌 NostrPinPublisher disabled by config");
      }
      return;
    }

    this.boundHandler = (e: Event) => {
      this.handleStorageEvent(e as CustomEvent<StorageEvent>);
    };

    window.addEventListener("ipfs-storage-event", this.boundHandler);
    this.isStarted = true;

    if (NOSTR_PIN_CONFIG.debug) {
      console.log("📌 NostrPinPublisher started - listening for IPFS storage events");
    }
  }

  /**
   * Stop listening for events
   */
  stop(): void {
    if (!this.isStarted || !this.boundHandler) {
      return;
    }

    window.removeEventListener("ipfs-storage-event", this.boundHandler);
    this.boundHandler = null;
    this.isStarted = false;

    if (NOSTR_PIN_CONFIG.debug) {
      console.log("📌 NostrPinPublisher stopped");
    }
  }

  /**
   * Check if publisher is running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Handle IPFS storage event
   */
  private async handleStorageEvent(e: CustomEvent<StorageEvent>): Promise<void> {
    const event = e.detail;

    // Only process successful storage completions
    if (event.type !== "storage:completed") {
      return;
    }

    const cid = event.data?.cid;
    if (!cid) {
      if (NOSTR_PIN_CONFIG.debug) {
        console.log("📌 Storage event without CID, skipping");
      }
      return;
    }

    const ipnsName = event.data?.ipnsName;
    const tokenCount = event.data?.tokenCount;

    if (NOSTR_PIN_CONFIG.debug) {
      console.log(`📌 Publishing pin request for CID: ${cid.slice(0, 16)}...`);
    }

    try {
      await this.publishPinRequest(cid, ipnsName, tokenCount);
    } catch (error) {
      console.error("📌 Failed to publish pin request:", error);
    }
  }

  /**
   * Publish CID pin request to Nostr
   */
  private async publishPinRequest(
    cid: string,
    ipnsName?: string,
    tokenCount?: number
  ): Promise<void> {
    const nostrService = NostrService.getInstance();

    // Build tags for NIP-78 app-specific event
    const tags: string[][] = [
      ["d", NOSTR_PIN_CONFIG.dTag],
      ["cid", cid],
    ];

    // Add optional IPNS name tag
    if (ipnsName) {
      tags.push(["ipns", ipnsName]);
    }

    // Content can include metadata (optional)
    const content = tokenCount !== undefined
      ? JSON.stringify({ tokenCount, timestamp: Date.now() })
      : "";

    const eventId = await nostrService.publishAppDataEvent(
      NOSTR_PIN_CONFIG.eventKind,
      tags,
      content
    );

    if (eventId) {
      if (NOSTR_PIN_CONFIG.debug) {
        console.log(`📌 Pin request published: ${eventId.slice(0, 8)}... for CID ${cid.slice(0, 16)}...`);
      }
    } else {
      console.warn("📌 Failed to publish pin request to Nostr");
    }
  }
}
