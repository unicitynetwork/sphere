/**
 * Sender Recovery Service
 *
 * Spec Reference: TOKEN_INVENTORY_SPEC.md v3.5 - Section 14
 *
 * Recovers sent tokens from Nostr relay history for users who:
 * - Restored wallet from seed phrase
 * - Lost local storage but have Nostr history
 * - Need to rebuild their "Sent" folder
 *
 * Key insight: NIP-04 encrypted messages are symmetric - the sender
 * can decrypt messages they sent to recipients.
 */

import type {
  SenderRecoveryResult,
  SenderRecoveryOptions,
} from '../types/InstantTransferTypes';
import type { IdentityManager } from './IdentityManager';
import type { NostrService } from './NostrService';
import { getSentTokensForAddress, addSentToken } from './InventorySyncService';
import { OutboxRepository } from '../../../../repositories/OutboxRepository';

/**
 * Token transfer event kind (from Nostr spec)
 */
const TOKEN_TRANSFER_KIND = 4;  // NIP-04 encrypted direct message

/**
 * Recovered token from Nostr
 */
interface RecoveredToken {
  nostrEventId: string;
  recipientPubkey: string;
  tokenId: string;
  amount: string;
  coinId: string;
  stateHash: string;
  sourceTokenJson: string;
  timestamp: number;
}

/**
 * Nostr event structure (NIP-01)
 */
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Nostr client interface for querying and decrypting events
 */
interface NostrClient {
  queryEvents?: (filter: NostrEventFilter) => Promise<NostrEvent[]>;
  decryptMessage?: (content: string, pubkey: string) => Promise<string>;
  nip04?: {
    decrypt: (pubkey: string, content: string) => Promise<string>;
  };
}

/**
 * Nostr event filter
 */
interface NostrEventFilter {
  authors: string[];
  kinds: number[];
  since: number;
  limit: number;
}

/**
 * Token transfer payload structure
 */
interface TokenTransferPayload {
  sourceToken?: string | object;
  tokenId?: string;
  stateHash?: string;
}

/**
 * SenderRecoveryService - Recovers sent tokens from Nostr relay history
 */
export class SenderRecoveryService {
  private static instance: SenderRecoveryService | null = null;
  private identityManager: IdentityManager;
  private nostrService: NostrService | null = null;
  private isRecovering = false;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  /**
   * Get singleton instance
   */
  static getInstance(identityManager?: IdentityManager): SenderRecoveryService {
    if (!SenderRecoveryService.instance) {
      if (!identityManager) {
        throw new Error('IdentityManager required for first getInstance() call');
      }
      SenderRecoveryService.instance = new SenderRecoveryService(identityManager);
    }
    return SenderRecoveryService.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    SenderRecoveryService.instance = null;
  }

  /**
   * Set NostrService reference (lazy initialization)
   */
  setNostrService(nostrService: NostrService): void {
    this.nostrService = nostrService;
  }

  /**
   * Recover sent tokens from Nostr relay history
   *
   * Per spec Section 14:
   * 1. Query Nostr: { authors: [myPubkey], kinds: [TOKEN_TRANSFER], since }
   * 2. For each event: decrypt payload, extract token data
   * 3. For each recovered token: validate, skip duplicates, add to Sent folder
   * 4. Trigger NORMAL sync to persist to IPFS
   *
   * @param options - Recovery options (since, limit, relays)
   * @returns Recovery result with statistics
   */
  async recoverSentTokensFromNostr(
    options: SenderRecoveryOptions = {}
  ): Promise<SenderRecoveryResult> {
    if (this.isRecovering) {
      console.log('🔄 [SenderRecovery] Recovery already in progress');
      return {
        tokensRecovered: 0,
        tokensSkipped: 0,
        errors: [],
        eventsScanned: 0,
        durationMs: 0,
      };
    }

    this.isRecovering = true;
    const startTime = performance.now();

    const result: SenderRecoveryResult = {
      tokensRecovered: 0,
      tokensSkipped: 0,
      errors: [],
      eventsScanned: 0,
      durationMs: 0,
    };

    try {
      console.log('🔄 [SenderRecovery] Starting recovery from Nostr...');

      // Get current identity
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        throw new Error('No identity available for recovery');
      }

      // Default options
      const since = options.since ?? Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // 30 days ago
      const limit = options.limit ?? 100;

      console.log(`🔄 [SenderRecovery] Querying Nostr events since ${new Date(since * 1000).toISOString()}, limit ${limit}`);

      // Get existing sent tokens to avoid duplicates
      const existingSent = getSentTokensForAddress(identity.address);
      const existingTokenIds = new Set(existingSent.map(t => t.token?.genesis?.data?.tokenId).filter(Boolean));

      // Get outbox entries to exclude active transfers
      const outboxRepo = OutboxRepository.getInstance();
      outboxRepo.setCurrentAddress(identity.address);
      const outboxEntries = outboxRepo.getPendingEntries();
      const outboxTokenIds = new Set(outboxEntries.map(e => e.sourceTokenId));

      // Query Nostr for sent token transfers
      const recoveredTokens = await this.querySentTokensFromNostr(
        identity.publicKey,
        since,
        limit
      );

      result.eventsScanned = recoveredTokens.length;
      console.log(`🔄 [SenderRecovery] Found ${recoveredTokens.length} token transfer events`);

      // Process each recovered token
      for (const recovered of recoveredTokens) {
        try {
          // Skip if already in Sent folder (duplicate detection per spec 13.30)
          if (existingTokenIds.has(recovered.tokenId)) {
            console.log(`🔄 [SenderRecovery] Skipping duplicate: ${recovered.tokenId.slice(0, 8)}...`);
            result.tokensSkipped++;
            continue;
          }

          // Skip if in active outbox (per spec 13.31)
          if (outboxTokenIds.has(recovered.tokenId)) {
            console.log(`🔄 [SenderRecovery] Skipping active outbox entry: ${recovered.tokenId.slice(0, 8)}...`);
            result.tokensSkipped++;
            continue;
          }

          // Validate token structure
          if (!this.isValidRecoveredToken(recovered)) {
            console.warn(`🔄 [SenderRecovery] Invalid token structure: ${recovered.tokenId?.slice(0, 8) || 'unknown'}`);
            result.errors.push({
              nostrEventId: recovered.nostrEventId,
              error: 'Invalid token structure',
              timestamp: Date.now(),
            });
            continue;
          }

          // Parse the source token JSON to get TxfToken
          let txfToken;
          try {
            txfToken = JSON.parse(recovered.sourceTokenJson);
          } catch {
            console.warn(`🔄 [SenderRecovery] Failed to parse sourceTokenJson for ${recovered.tokenId.slice(0, 8)}`);
            result.errors.push({
              nostrEventId: recovered.nostrEventId,
              error: 'Failed to parse token JSON',
              timestamp: Date.now(),
            });
            continue;
          }

          // Add to Sent folder with proper SentTokenEntry structure
          addSentToken(identity.address, {
            token: txfToken,
            timestamp: recovered.timestamp,
            spentAt: recovered.timestamp, // Use sent time as spentAt for recovered tokens
          });

          result.tokensRecovered++;
          existingTokenIds.add(recovered.tokenId); // Prevent duplicates within this batch

          console.log(`✅ [SenderRecovery] Recovered token ${recovered.tokenId.slice(0, 8)}... (${recovered.amount} ${recovered.coinId.slice(0, 8)})`);
        } catch (err) {
          console.error(`🔄 [SenderRecovery] Error processing token:`, err);
          result.errors.push({
            nostrEventId: recovered.nostrEventId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        }
      }

      result.durationMs = performance.now() - startTime;

      console.log(`🔄 [SenderRecovery] Completed: ${result.tokensRecovered} recovered, ${result.tokensSkipped} skipped, ${result.errors.length} errors (${result.durationMs.toFixed(0)}ms)`);

      // Trigger NORMAL sync to persist to IPFS
      if (result.tokensRecovered > 0 && identity.ipnsName) {
        console.log('🔄 [SenderRecovery] Triggering IPFS sync...');
        const { inventorySync } = await import('./InventorySyncService');
        await inventorySync({
          address: identity.address,
          publicKey: identity.publicKey,
          ipnsName: identity.ipnsName,
        }).catch(err => {
          console.warn('🔄 [SenderRecovery] IPFS sync failed:', err);
        });
      }

      return result;
    } catch (err) {
      console.error('🔄 [SenderRecovery] Recovery failed:', err);
      result.errors.push({
        nostrEventId: '',
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      result.durationMs = performance.now() - startTime;
      return result;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Query sent token transfers from Nostr relays
   * Uses NIP-04 decryption to access own sent messages
   */
  private async querySentTokensFromNostr(
    myPubkey: string,
    since: number,
    limit: number
  ): Promise<RecoveredToken[]> {
    if (!this.nostrService) {
      console.warn('🔄 [SenderRecovery] NostrService not available');
      return [];
    }

    const recovered: RecoveredToken[] = [];

    try {
      // Get the underlying Nostr client
      const client = (this.nostrService as unknown as { client?: NostrClient }).client;
      if (!client) {
        console.warn('🔄 [SenderRecovery] Nostr client not initialized');
        return [];
      }

      // Query for token transfer events sent by this user
      // Note: This is a simplified implementation - actual implementation
      // would need to use the specific Nostr SDK methods
      const events = await this.fetchNostrEvents(client, {
        authors: [myPubkey],
        kinds: [TOKEN_TRANSFER_KIND],
        since,
        limit,
      });

      for (const event of events) {
        try {
          // Decrypt the event content (sender can decrypt their own NIP-04 messages)
          const decrypted = await this.decryptNostrEvent(client, event);
          if (!decrypted) continue;

          // Parse the token transfer payload
          const payload = JSON.parse(decrypted);
          const token = this.extractTokenFromPayload(payload);

          if (token) {
            recovered.push({
              nostrEventId: event.id,
              recipientPubkey: this.extractRecipientPubkey(event),
              tokenId: token.tokenId,
              amount: token.amount,
              coinId: token.coinId,
              stateHash: token.stateHash,
              sourceTokenJson: token.sourceTokenJson,
              timestamp: event.created_at * 1000,
            });
          }
        } catch (err) {
          console.warn(`🔄 [SenderRecovery] Failed to process event ${event.id?.slice(0, 8)}:`, err);
        }
      }
    } catch (err) {
      console.error('🔄 [SenderRecovery] Failed to query Nostr:', err);
    }

    return recovered;
  }

  /**
   * Fetch Nostr events with the given filter
   */
  private async fetchNostrEvents(
    client: NostrClient,
    filter: NostrEventFilter
  ): Promise<NostrEvent[]> {
    // This is a placeholder - actual implementation depends on the Nostr SDK
    // The @unicitylabs/nostr-js-sdk would have specific methods for this

    try {
      // Try to use the client's query method if available
      if (typeof client.queryEvents === 'function') {
        return await client.queryEvents(filter);
      }

      // Fallback: Return empty if method not available
      console.warn('🔄 [SenderRecovery] Nostr event query not supported by client');
      return [];
    } catch (err) {
      console.error('🔄 [SenderRecovery] Event fetch error:', err);
      return [];
    }
  }

  /**
   * Decrypt a Nostr event content
   * NIP-04: Sender can decrypt messages they sent
   */
  private async decryptNostrEvent(client: NostrClient, event: NostrEvent): Promise<string | null> {
    try {
      // Use the client's decrypt method if available
      if (typeof client.decryptMessage === 'function') {
        return await client.decryptMessage(event.content, event.pubkey);
      }

      // Fallback: Try direct decryption
      if (typeof client.nip04?.decrypt === 'function') {
        const recipientPubkey = this.extractRecipientPubkey(event);
        return await client.nip04.decrypt(recipientPubkey, event.content);
      }

      console.warn('🔄 [SenderRecovery] Decryption not supported by client');
      return null;
    } catch (err) {
      console.warn('🔄 [SenderRecovery] Decryption error:', err);
      return null;
    }
  }

  /**
   * Extract recipient pubkey from Nostr event
   */
  private extractRecipientPubkey(event: NostrEvent): string {
    // Check p tags for recipient
    const pTags = event.tags?.filter((t: string[]) => t[0] === 'p') || [];
    if (pTags.length > 0) {
      return pTags[0][1];
    }
    return '';
  }

  /**
   * Extract token information from decrypted payload
   */
  private extractTokenFromPayload(payload: TokenTransferPayload): {
    tokenId: string;
    amount: string;
    coinId: string;
    stateHash: string;
    sourceTokenJson: string;
  } | null {
    try {
      // Handle different payload formats
      let sourceTokenJson: string;

      if (typeof payload.sourceToken === 'string') {
        sourceTokenJson = payload.sourceToken;
      } else if (payload.sourceToken) {
        sourceTokenJson = JSON.stringify(payload.sourceToken);
      } else {
        return null;
      }

      const sourceToken = JSON.parse(sourceTokenJson);

      // Extract token ID
      const tokenId = payload.tokenId ||
        sourceToken.genesis?.data?.tokenId ||
        sourceToken.id ||
        '';

      // Extract state hash
      const stateHash = payload.stateHash ||
        sourceToken.state?.stateHash ||
        '';

      // Extract coins information
      let amount = '0';
      let coinId = '';

      if (sourceToken.genesis?.data?.coins) {
        const coins = sourceToken.genesis.data.coins.coins;
        if (Array.isArray(coins) && coins.length > 0) {
          const firstCoin = coins[0];
          if (Array.isArray(firstCoin) && firstCoin.length >= 2) {
            const keyBytes = firstCoin[0]?.data || firstCoin[0];
            coinId = Buffer.from(keyBytes).toString('hex');

            const val = firstCoin[1];
            if (Array.isArray(val)) {
              amount = val[1]?.toString() || '0';
            } else if (val) {
              amount = val.toString();
            }
          }
        }
      }

      return {
        tokenId,
        amount,
        coinId,
        stateHash,
        sourceTokenJson,
      };
    } catch (err) {
      console.warn('🔄 [SenderRecovery] Failed to extract token from payload:', err);
      return null;
    }
  }

  /**
   * Validate recovered token structure
   */
  private isValidRecoveredToken(token: RecoveredToken): boolean {
    return !!(
      token.tokenId &&
      token.tokenId.length > 0 &&
      token.sourceTokenJson &&
      token.sourceTokenJson.length > 0
    );
  }

  /**
   * Check if recovery is in progress
   */
  isRecoveryInProgress(): boolean {
    return this.isRecovering;
  }
}

/**
 * Get singleton instance (convenience export)
 */
export function getSenderRecoveryService(identityManager?: IdentityManager): SenderRecoveryService {
  return SenderRecoveryService.getInstance(identityManager);
}
