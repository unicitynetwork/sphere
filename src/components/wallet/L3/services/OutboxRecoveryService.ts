/**
 * OutboxRecoveryService
 *
 * Handles recovery of incomplete token transfers on startup and periodically.
 * Reads outbox entries from localStorage and resumes operations
 * based on where they left off.
 *
 * Recovery by status:
 * - PENDING_IPFS_SYNC: Re-sync to IPFS, then continue
 * - READY_TO_SUBMIT: Submit to aggregator (idempotent)
 * - SUBMITTED: Poll for inclusion proof
 * - PROOF_RECEIVED: Retry Nostr delivery
 * - NOSTR_SENT: Just mark as completed
 * - COMPLETED: Remove from outbox
 * - FAILED: Skip (requires manual intervention)
 *
 * Periodic retry:
 * - Runs every 60 seconds while app is open
 * - Uses exponential backoff (30s base, 1h max)
 * - No age limit - entries remain recoverable indefinitely
 * - Only 10 consecutive failures mark entry as FAILED
 */

import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { OutboxRepository } from "../../../../repositories/OutboxRepository";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { ServiceProvider } from "./ServiceProvider";
import type { NostrService } from "./NostrService";
import type { IdentityManager } from "./IdentityManager";
import type {
  OutboxEntry,
  RecoveryResult,
  RecoveryDetail,
} from "./types/OutboxTypes";
import { IpfsStorageService } from "./IpfsStorageService";
import { TokenRecoveryService } from "./TokenRecoveryService";

// ==========================================
// Configuration Constants
// ==========================================

/** Check outbox every 60 seconds */
const PERIODIC_RETRY_INTERVAL_MS = 60000;

/** Base delay between retries (30 seconds) */
const ENTRY_BACKOFF_BASE_MS = 30000;

/** Maximum delay between retries (1 hour) */
const ENTRY_MAX_BACKOFF_MS = 3600000;

/** Maximum consecutive failures before marking as FAILED */
const MAX_RETRIES_PER_ENTRY = 10;

/** Cleanup COMPLETED entries after 24 hours */
const COMPLETED_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

export class OutboxRecoveryService {
  private static instance: OutboxRecoveryService;

  private identityManager: IdentityManager | null = null;
  private isRecovering = false;

  // Periodic retry state
  private periodicRetryInterval: ReturnType<typeof setInterval> | null = null;
  private walletAddress: string | null = null;
  private nostrServiceRef: NostrService | null = null;

  private constructor() {}

  static getInstance(): OutboxRecoveryService {
    if (!OutboxRecoveryService.instance) {
      OutboxRecoveryService.instance = new OutboxRecoveryService();
    }
    return OutboxRecoveryService.instance;
  }

  /**
   * Set the identity manager (needed for IPFS sync)
   */
  setIdentityManager(manager: IdentityManager): void {
    this.identityManager = manager;
  }

  /**
   * Check if there are any pending entries that need recovery
   */
  hasPendingRecovery(walletAddress: string): boolean {
    const outboxRepo = OutboxRepository.getInstance();
    outboxRepo.setCurrentAddress(walletAddress);
    return outboxRepo.getPendingCount() > 0;
  }

  /**
   * Get count of pending entries
   */
  getPendingCount(walletAddress: string): number {
    const outboxRepo = OutboxRepository.getInstance();
    outboxRepo.setCurrentAddress(walletAddress);
    return outboxRepo.getPendingCount();
  }

  // ==========================================
  // Periodic Retry Methods
  // ==========================================

  /**
   * Start periodic retry checking
   * Call after initial startup recovery completes
   */
  startPeriodicRetry(walletAddress: string, nostrService: NostrService): void {
    this.stopPeriodicRetry(); // Clear any existing interval

    this.walletAddress = walletAddress;
    this.nostrServiceRef = nostrService;

    console.log(`📤 OutboxRecovery: Starting periodic retry (every ${PERIODIC_RETRY_INTERVAL_MS / 1000}s)`);

    this.periodicRetryInterval = setInterval(() => {
      this.runPeriodicRecovery();
    }, PERIODIC_RETRY_INTERVAL_MS);
  }

  /**
   * Stop periodic retry checking
   * Call on logout or app shutdown
   */
  stopPeriodicRetry(): void {
    if (this.periodicRetryInterval) {
      clearInterval(this.periodicRetryInterval);
      this.periodicRetryInterval = null;
      console.log("📤 OutboxRecovery: Stopped periodic retry");
    }
    this.walletAddress = null;
    this.nostrServiceRef = null;
  }

  /**
   * Run a periodic recovery cycle
   * - Skips if already recovering
   * - Only processes entries ready for retry (respects backoff)
   * - Cleans up old completed entries
   */
  private async runPeriodicRecovery(): Promise<void> {
    if (!this.walletAddress || !this.nostrServiceRef) return;
    if (this.isRecovering) return; // Already running

    const outboxRepo = OutboxRepository.getInstance();
    outboxRepo.setCurrentAddress(this.walletAddress);

    const pendingCount = outboxRepo.getPendingCount();
    if (pendingCount === 0) return; // Nothing to do

    // Get entries that are ready for retry (respect backoff)
    const pendingEntries = outboxRepo.getPendingEntries();
    const readyForRetry = pendingEntries.filter(entry => this.isReadyForRetry(entry));

    if (readyForRetry.length === 0) {
      // All entries in backoff, don't log every 60s
      return;
    }

    console.log(`📤 OutboxRecovery: Periodic check - ${readyForRetry.length}/${pendingCount} entries ready for retry`);

    await this.recoverPendingTransfers(this.walletAddress, this.nostrServiceRef);

    // Cleanup old COMPLETED entries only (not pending ones - those may complete later)
    outboxRepo.cleanupCompleted(COMPLETED_CLEANUP_AGE_MS);
  }

  /**
   * Check if an entry is ready for retry based on exponential backoff
   * NOTE: No age limit - users may close app for days/weeks and return
   */
  private isReadyForRetry(entry: OutboxEntry): boolean {
    if (entry.status === "FAILED") return false;
    if (entry.status === "COMPLETED") return false;

    // Check retry count - entries at or beyond max will be marked FAILED during recovery
    if (entry.retryCount >= MAX_RETRIES_PER_ENTRY) {
      return true; // Let recoverEntry handle marking it as FAILED
    }

    // Calculate backoff delay based on retry count
    const backoffDelay = Math.min(
      ENTRY_BACKOFF_BASE_MS * Math.pow(2, entry.retryCount),
      ENTRY_MAX_BACKOFF_MS
    );

    const timeSinceLastUpdate = Date.now() - entry.updatedAt;
    return timeSinceLastUpdate >= backoffDelay;
  }

  // ==========================================
  // Recovery Methods
  // ==========================================

  /**
   * Main recovery entry point - called on app startup
   * Recovers all pending transfers for the given wallet address
   */
  async recoverPendingTransfers(
    walletAddress: string,
    nostrService: NostrService
  ): Promise<RecoveryResult> {
    if (this.isRecovering) {
      console.log("📤 OutboxRecovery: Recovery already in progress, skipping");
      return { recovered: 0, failed: 0, skipped: 0, details: [] };
    }

    this.isRecovering = true;
    const result: RecoveryResult = {
      recovered: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    try {
      const outboxRepo = OutboxRepository.getInstance();
      outboxRepo.setCurrentAddress(walletAddress);

      const pendingEntries = outboxRepo.getPendingEntries();

      if (pendingEntries.length === 0) {
        console.log("📤 OutboxRecovery: No pending entries to recover");
        return result;
      }

      console.log(`📤 OutboxRecovery: Found ${pendingEntries.length} pending entries`);

      for (const entry of pendingEntries) {
        const detail = await this.recoverEntry(entry, outboxRepo, nostrService);
        result.details.push(detail);

        switch (detail.status) {
          case "recovered":
            result.recovered++;
            break;
          case "failed":
            result.failed++;
            break;
          case "skipped":
            result.skipped++;
            break;
        }
      }

      // Final IPFS sync after recovery
      if (this.identityManager && (result.recovered > 0 || result.failed > 0)) {
        try {
          const ipfsService = IpfsStorageService.getInstance(this.identityManager);
          await ipfsService.syncNow();
          console.log("📤 OutboxRecovery: Final IPFS sync completed");
        } catch (syncError) {
          console.warn("📤 OutboxRecovery: Final IPFS sync failed:", syncError);
        }
      }

      console.log(`📤 OutboxRecovery: Complete - ${result.recovered} recovered, ${result.failed} failed, ${result.skipped} skipped`);
      return result;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Recover a single outbox entry
   */
  private async recoverEntry(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository,
    nostrService: NostrService
  ): Promise<RecoveryDetail> {
    const detail: RecoveryDetail = {
      entryId: entry.id,
      status: "skipped",
      previousStatus: entry.status,
    };

    console.log(`📤 OutboxRecovery: Processing entry ${entry.id.slice(0, 8)}... (status=${entry.status}, type=${entry.type})`);

    try {
      switch (entry.status) {
        case "PENDING_IPFS_SYNC":
          await this.resumeFromPendingIpfs(entry, outboxRepo, nostrService);
          detail.status = "recovered";
          detail.newStatus = "COMPLETED";
          break;

        case "READY_TO_SUBMIT":
          await this.resumeFromReadyToSubmit(entry, outboxRepo, nostrService);
          detail.status = "recovered";
          detail.newStatus = "COMPLETED";
          break;

        case "SUBMITTED":
          await this.resumeFromSubmitted(entry, outboxRepo, nostrService);
          detail.status = "recovered";
          detail.newStatus = "COMPLETED";
          break;

        case "PROOF_RECEIVED":
          // SPLIT_MINT entries with proof are already complete - token is minted and saved
          if (entry.type === "SPLIT_MINT") {
            await this.finalizeSplitMint(entry, outboxRepo);
          } else {
            await this.resumeFromProofReceived(entry, outboxRepo, nostrService);
          }
          detail.status = "recovered";
          detail.newStatus = "COMPLETED";
          break;

        case "NOSTR_SENT":
          // Just mark as completed - Nostr already sent
          outboxRepo.updateStatus(entry.id, "COMPLETED");
          detail.status = "recovered";
          detail.newStatus = "COMPLETED";
          break;

        case "COMPLETED":
          // Already done, just clean up
          detail.status = "skipped";
          break;

        case "FAILED":
          // Check if this FAILED entry can be recovered by verifying token state
          // Only attempt if we haven't exceeded max retries
          if (entry.retryCount < MAX_RETRIES_PER_ENTRY) {
            const publicKey = await this.getOwnerPublicKey();
            if (publicKey) {
              const walletRepo = WalletRepository.getInstance();
              const sourceToken = walletRepo.getTokens().find(t => t.id === entry.sourceTokenId);
              if (sourceToken) {
                try {
                  const recoveryService = TokenRecoveryService.getInstance();
                  const spentCheck = await recoveryService.checkTokenSpent(sourceToken, publicKey);

                  if (!spentCheck.isSpent) {
                    // Token not spent - revert to committed state and allow retry
                    console.log(`📤 OutboxRecovery: Token ${entry.sourceTokenId.slice(0, 8)}... not spent, attempting recovery`);
                    const recovery = await recoveryService.handleTransferFailure(
                      sourceToken,
                      entry.lastError || "RECOVERY_ATTEMPT",
                      publicKey
                    );

                    if (recovery.tokenRestored) {
                      // Reset entry for retry
                      outboxRepo.updateEntry(entry.id, {
                        status: "READY_TO_SUBMIT",
                        retryCount: entry.retryCount + 1,
                        lastError: undefined,
                      });
                      window.dispatchEvent(new Event("wallet-updated"));
                      detail.status = "recovered";
                      detail.newStatus = "READY_TO_SUBMIT";
                      break;
                    }
                  } else {
                    // Token is spent - it's permanently failed
                    console.log(`📤 OutboxRecovery: Token ${entry.sourceTokenId.slice(0, 8)}... is spent, marking permanently failed`);
                    await recoveryService.handleTransferFailure(sourceToken, "ALREADY_SPENT", publicKey);
                    window.dispatchEvent(new Event("wallet-updated"));
                  }
                } catch (recoveryErr) {
                  console.warn(`📤 OutboxRecovery: Failed entry recovery failed:`, recoveryErr);
                }
              }
            }
          }
          // If we get here, entry remains FAILED
          console.warn(`📤 OutboxRecovery: Entry ${entry.id.slice(0, 8)}... is FAILED, skipping`);
          detail.status = "skipped";
          break;
      }
    } catch (error) {
      console.error(`📤 OutboxRecovery: Failed to recover entry ${entry.id.slice(0, 8)}...`, error);
      const newRetryCount = entry.retryCount + 1;
      outboxRepo.updateEntry(entry.id, {
        lastError: error instanceof Error ? error.message : String(error),
        retryCount: newRetryCount,
      });

      // Mark as FAILED after MAX_RETRIES_PER_ENTRY consecutive failures
      if (newRetryCount >= MAX_RETRIES_PER_ENTRY) {
        outboxRepo.updateStatus(entry.id, "FAILED", `Max retries exceeded (${MAX_RETRIES_PER_ENTRY})`);
      }

      detail.status = "failed";
      detail.error = error instanceof Error ? error.message : String(error);
    }

    return detail;
  }

  /**
   * Resume from PENDING_IPFS_SYNC: Sync to IPFS, then continue full flow
   */
  private async resumeFromPendingIpfs(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository,
    nostrService: NostrService
  ): Promise<void> {
    console.log(`📤 OutboxRecovery: Resuming from PENDING_IPFS_SYNC...`);

    // First sync to IPFS
    if (this.identityManager) {
      const ipfsService = IpfsStorageService.getInstance(this.identityManager);
      const syncResult = await ipfsService.syncNow();
      if (!syncResult.success) {
        throw new Error("IPFS sync failed during recovery");
      }
    }

    // Update status and continue
    outboxRepo.updateStatus(entry.id, "READY_TO_SUBMIT");
    entry.status = "READY_TO_SUBMIT";

    await this.resumeFromReadyToSubmit(entry, outboxRepo, nostrService);
  }

  /**
   * Resume from READY_TO_SUBMIT: Submit to aggregator, wait for proof, send via Nostr
   */
  private async resumeFromReadyToSubmit(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository,
    nostrService: NostrService
  ): Promise<void> {
    console.log(`📤 OutboxRecovery: Resuming from READY_TO_SUBMIT...`);

    // Before retrying submission, verify token state is still valid
    // This prevents wasting aggregator calls on tokens that were spent elsewhere
    const publicKey = await this.getOwnerPublicKey();
    if (publicKey && entry.sourceTokenJson) {
      try {
        const walletRepo = WalletRepository.getInstance();
        const sourceToken = walletRepo.getTokens().find(t => t.id === entry.sourceTokenId);
        if (sourceToken) {
          const recoveryService = TokenRecoveryService.getInstance();
          const spentCheck = await recoveryService.checkTokenSpent(sourceToken, publicKey);
          if (spentCheck.isSpent) {
            // Token was spent elsewhere - cannot recover this transfer
            console.log(`📤 OutboxRecovery: Token ${entry.sourceTokenId.slice(0, 8)}... already spent, removing`);
            await recoveryService.handleTransferFailure(sourceToken, "ALREADY_SPENT", publicKey);
            outboxRepo.updateEntry(entry.id, {
              status: "FAILED",
              lastError: "Token state already spent by another transaction"
            });
            window.dispatchEvent(new Event("wallet-updated"));
            return; // Don't retry
          }
        }
      } catch (spentCheckError) {
        console.warn(`📤 OutboxRecovery: Failed to check token spent status:`, spentCheckError);
        // Continue with submission - let aggregator determine if spent
      }
    }

    // Reconstruct commitment from stored JSON
    const commitment = await this.reconstructCommitment(entry);

    // Submit to aggregator (idempotent - REQUEST_ID_EXISTS is ok)
    const client = ServiceProvider.stateTransitionClient;
    const response = await client.submitTransferCommitment(commitment);

    if (response.status !== "SUCCESS" && response.status !== "REQUEST_ID_EXISTS") {
      // Handle failure with recovery
      if (publicKey && entry.sourceTokenJson) {
        const walletRepo = WalletRepository.getInstance();
        const sourceToken = walletRepo.getTokens().find(t => t.id === entry.sourceTokenId);
        if (sourceToken) {
          try {
            const recoveryService = TokenRecoveryService.getInstance();
            const recovery = await recoveryService.handleTransferFailure(
              sourceToken,
              response.status,
              publicKey
            );
            console.log(`📤 OutboxRecovery: Submission failed (${response.status}), recovery: ${recovery.action}`);
            if (recovery.tokenRestored || recovery.tokenRemoved) {
              window.dispatchEvent(new Event("wallet-updated"));
            }
          } catch (recoveryErr) {
            console.error(`📤 OutboxRecovery: Token recovery failed:`, recoveryErr);
          }
        }
      }
      throw new Error(`Aggregator submission failed: ${response.status}`);
    }

    outboxRepo.updateStatus(entry.id, "SUBMITTED");
    entry.status = "SUBMITTED";

    await this.resumeFromSubmitted(entry, outboxRepo, nostrService);
  }

  /**
   * Get the owner's public key from identity manager
   */
  private async getOwnerPublicKey(): Promise<string | null> {
    if (!this.identityManager) return null;
    try {
      const identity = await this.identityManager.getCurrentIdentity();
      return identity?.publicKey || null;
    } catch {
      return null;
    }
  }

  /**
   * Resume from SUBMITTED: Wait for inclusion proof, then send via Nostr
   */
  private async resumeFromSubmitted(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository,
    nostrService: NostrService
  ): Promise<void> {
    console.log(`📤 OutboxRecovery: Resuming from SUBMITTED...`);

    // Reconstruct commitment from stored JSON
    const commitment = await this.reconstructCommitment(entry);

    // Wait for inclusion proof
    const trustBase = ServiceProvider.getRootTrustBase();
    const client = ServiceProvider.stateTransitionClient;

    const inclusionProof = await waitInclusionProof(
      trustBase,
      client,
      commitment
    );

    // Create transfer transaction
    const transferTx = commitment.toTransaction(inclusionProof);

    // Update entry with proof data
    outboxRepo.updateEntry(entry.id, {
      status: "PROOF_RECEIVED",
      inclusionProofJson: JSON.stringify(inclusionProof.toJSON()),
      transferTxJson: JSON.stringify(transferTx.toJSON()),
    });
    entry.status = "PROOF_RECEIVED";
    entry.inclusionProofJson = JSON.stringify(inclusionProof.toJSON());
    entry.transferTxJson = JSON.stringify(transferTx.toJSON());

    await this.resumeFromProofReceived(entry, outboxRepo, nostrService);
  }

  /**
   * Finalize a SPLIT_MINT entry that has received its proof.
   * SPLIT_MINT entries don't need Nostr delivery - the token is already
   * minted and saved to the wallet via the onTokenMinted callback.
   * We just mark it as completed.
   */
  private async finalizeSplitMint(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository
  ): Promise<void> {
    console.log(`📤 OutboxRecovery: Finalizing SPLIT_MINT ${entry.id.slice(0, 8)}... (token already minted)`);

    // Token should already be in wallet from onTokenMinted callback
    // Just mark the outbox entry as completed
    outboxRepo.updateStatus(entry.id, "COMPLETED");

    console.log(`📤 SPLIT_MINT ${entry.id.slice(0, 8)}... finalized`);
  }

  /**
   * Resume from PROOF_RECEIVED: Send via Nostr
   */
  private async resumeFromProofReceived(
    entry: OutboxEntry,
    outboxRepo: OutboxRepository,
    nostrService: NostrService
  ): Promise<void> {
    console.log(`📤 OutboxRecovery: Resuming from PROOF_RECEIVED...`);

    if (!entry.transferTxJson) {
      throw new Error("Missing transferTxJson for Nostr delivery");
    }

    // Build Nostr payload
    const payload = JSON.stringify({
      sourceToken: entry.sourceTokenJson,
      transferTx: entry.transferTxJson,
    });

    // Send via Nostr
    await nostrService.sendTokenTransfer(entry.recipientPubkey, payload);

    // Update status
    outboxRepo.updateStatus(entry.id, "NOSTR_SENT");
    outboxRepo.updateStatus(entry.id, "COMPLETED");

    console.log(`📤 OutboxRecovery: Entry ${entry.id.slice(0, 8)}... recovered and completed`);
  }

  /**
   * Reconstruct a TransferCommitment from stored JSON
   * Note: For direct transfers, this recreates from stored data.
   * For splits, the commitment is deterministic so can be recreated.
   */
  private async reconstructCommitment(entry: OutboxEntry): Promise<TransferCommitment> {
    try {
      const commitmentData = JSON.parse(entry.commitmentJson);
      return await TransferCommitment.fromJSON(commitmentData);
    } catch (error) {
      throw new Error(`Failed to reconstruct commitment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Export singleton getter for convenience
export function getOutboxRecoveryService(): OutboxRecoveryService {
  return OutboxRecoveryService.getInstance();
}
