/**
 * Payment Session Manager
 *
 * Spec Reference: TOKEN_INVENTORY_SPEC.md v3.5 - Section 13.4
 *
 * Singleton that manages payment session lifecycle for instant transfers.
 * Provides:
 * - Session creation and tracking
 * - Phase advancement with event emission
 * - Session timeout handling
 * - Subscriber notifications for UI updates
 */

import type {
  PaymentSession,
  PaymentSessionStatus,
  PaymentSessionDirection,
  PaymentSessionErrorCode,
  TransferProgressEvent,
  TransferProgressStage,
} from '../types/InstantTransferTypes';
import {
  createPaymentSession,
  isPaymentSessionTimedOut,
  isPaymentSessionTerminal,
  createPaymentSessionError,
  emitTransferProgress,
} from '../types/InstantTransferTypes';

/**
 * Session update listener callback
 */
type SessionUpdateCallback = (session: PaymentSession) => void;

/**
 * Parameters for creating a new payment session
 */
export interface CreateSessionParams {
  direction: PaymentSessionDirection;
  sourceTokenId?: string;
  recipientNametag?: string;
  recipientPubkey?: string;
  amount?: string;
  coinId?: string;
  salt?: string;
  deadlineMs?: number;
  sourceEventId?: string;
  senderPubkey?: string;
}

/**
 * PaymentSessionManager - Singleton for managing instant transfer sessions
 */
export class PaymentSessionManager {
  private static instance: PaymentSessionManager | null = null;

  /** Active sessions by ID */
  private sessions: Map<string, PaymentSession> = new Map();

  /** Session update listeners by session ID */
  private listeners: Map<string, Set<SessionUpdateCallback>> = new Map();

  /** Timeout handles for session cleanup */
  private timeoutHandles: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Maximum sessions to keep in memory (LRU eviction) */
  private readonly MAX_SESSIONS = 100;

  /** Session history (completed/failed, for debugging) */
  private sessionHistory: PaymentSession[] = [];

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PaymentSessionManager {
    if (!PaymentSessionManager.instance) {
      PaymentSessionManager.instance = new PaymentSessionManager();
    }
    return PaymentSessionManager.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    if (PaymentSessionManager.instance) {
      PaymentSessionManager.instance.cleanup();
    }
    PaymentSessionManager.instance = null;
  }

  /**
   * Create a new payment session
   *
   * @param params - Session creation parameters
   * @returns Created payment session
   */
  createSession(params: CreateSessionParams): PaymentSession {
    // Enforce max sessions with LRU eviction
    if (this.sessions.size >= this.MAX_SESSIONS) {
      this.evictOldestSession();
    }

    const session = createPaymentSession({
      direction: params.direction,
      sourceTokenId: params.sourceTokenId,
      recipientNametag: params.recipientNametag,
      recipientPubkey: params.recipientPubkey,
      amount: params.amount,
      coinId: params.coinId,
      salt: params.salt,
      deadlineMs: params.deadlineMs,
    });

    // Add receive-specific fields
    if (params.direction === 'RECEIVE') {
      session.sourceEventId = params.sourceEventId;
      session.senderPubkey = params.senderPubkey;
    }

    this.sessions.set(session.id, session);

    // Schedule timeout check
    this.scheduleTimeoutCheck(session);

    // Emit progress event
    this.emitProgress(session.id, 'SESSION_CREATED', 'Payment session created');

    console.log(`📋 [PaymentSession] Created ${params.direction} session ${session.id.slice(0, 8)}...`);

    return session;
  }

  /**
   * Advance a session to a new phase/status
   *
   * @param sessionId - Session ID to advance
   * @param status - New status
   * @param detail - Optional additional details to merge
   */
  advancePhase(
    sessionId: string,
    status: PaymentSessionStatus,
    detail?: Partial<PaymentSession>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`📋 [PaymentSession] Session ${sessionId.slice(0, 8)} not found for phase advance`);
      return;
    }

    // Check for timeout before advancing
    if (isPaymentSessionTimedOut(session) && !isPaymentSessionTerminal(session)) {
      this.markTimedOut(sessionId);
      return;
    }

    const previousStatus = session.status;
    session.status = status;
    session.updatedAt = Date.now();

    // Merge additional details
    if (detail) {
      Object.assign(session, detail);
    }

    console.log(`📋 [PaymentSession] ${sessionId.slice(0, 8)} ${previousStatus} → ${status}`);

    // Notify listeners
    this.notifyListeners(sessionId, session);

    // Emit progress event
    const stage = this.statusToStage(status);
    this.emitProgress(sessionId, stage, `Session advanced to ${status}`);

    // Handle terminal states
    if (isPaymentSessionTerminal(session)) {
      this.handleTerminalState(sessionId, session);
    }
  }

  /**
   * Mark a session as failed with error details
   *
   * @param sessionId - Session ID to mark failed
   * @param errorCode - Error code
   * @param message - Error message
   * @param recoverable - Whether error is recoverable
   * @param details - Optional error details
   */
  markFailed(
    sessionId: string,
    errorCode: PaymentSessionErrorCode,
    message: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`📋 [PaymentSession] Session ${sessionId.slice(0, 8)} not found for failure marking`);
      return;
    }

    session.status = 'FAILED';
    session.updatedAt = Date.now();
    session.error = createPaymentSessionError(errorCode, message, recoverable, details);

    console.error(`📋 [PaymentSession] ${sessionId.slice(0, 8)} FAILED: ${message}`);

    this.notifyListeners(sessionId, session);
    this.emitProgress(sessionId, 'ERROR', message, { errorCode, recoverable });
    this.handleTerminalState(sessionId, session);
  }

  /**
   * Mark a session as timed out
   *
   * @param sessionId - Session ID to mark timed out
   */
  markTimedOut(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'TIMED_OUT';
    session.updatedAt = Date.now();
    session.error = createPaymentSessionError(
      'SESSION_TIMEOUT',
      `Session timed out after ${session.deadline ? session.deadline - session.createdAt : 'unknown'}ms`,
      false
    );

    console.warn(`📋 [PaymentSession] ${sessionId.slice(0, 8)} TIMED_OUT`);

    this.notifyListeners(sessionId, session);
    this.emitProgress(sessionId, 'ERROR', 'Session timed out');
    this.handleTerminalState(sessionId, session);
  }

  /**
   * Get a session by ID
   *
   * @param sessionId - Session ID
   * @returns Session or undefined if not found
   */
  getSession(sessionId: string): PaymentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active (non-terminal) sessions
   *
   * @returns Array of active sessions
   */
  getActiveSessions(): PaymentSession[] {
    return Array.from(this.sessions.values()).filter(s => !isPaymentSessionTerminal(s));
  }

  /**
   * Get sessions by direction
   *
   * @param direction - Session direction to filter
   * @returns Array of sessions with specified direction
   */
  getSessionsByDirection(direction: PaymentSessionDirection): PaymentSession[] {
    return Array.from(this.sessions.values()).filter(s => s.direction === direction);
  }

  /**
   * Subscribe to session updates
   *
   * @param sessionId - Session ID to subscribe to
   * @param callback - Callback to invoke on updates
   * @returns Unsubscribe function
   */
  onSessionUpdate(sessionId: string, callback: SessionUpdateCallback): () => void {
    let listeners = this.listeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(sessionId, listeners);
    }
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      const currentListeners = this.listeners.get(sessionId);
      if (currentListeners) {
        currentListeners.delete(callback);
        if (currentListeners.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  /**
   * Wait for a session to reach a specific status
   *
   * @param sessionId - Session ID to wait for
   * @param targetStatus - Target status or array of statuses
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise that resolves with session when status is reached
   */
  waitForStatus(
    sessionId: string,
    targetStatus: PaymentSessionStatus | PaymentSessionStatus[],
    timeoutMs: number = 30000
  ): Promise<PaymentSession> {
    const targets = Array.isArray(targetStatus) ? targetStatus : [targetStatus];

    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);

      // Check if already at target status
      if (session && targets.includes(session.status)) {
        resolve(session);
        return;
      }

      // Check if already terminal but not at target
      if (session && isPaymentSessionTerminal(session) && !targets.includes(session.status)) {
        reject(new Error(`Session reached terminal state ${session.status} instead of ${targets.join('|')}`));
        return;
      }

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for session ${sessionId} to reach ${targets.join('|')}`));
      }, timeoutMs);

      // Subscribe to updates
      const unsubscribe = this.onSessionUpdate(sessionId, (updatedSession) => {
        if (targets.includes(updatedSession.status)) {
          clearTimeout(timeoutHandle);
          unsubscribe();
          resolve(updatedSession);
        } else if (isPaymentSessionTerminal(updatedSession) && !targets.includes(updatedSession.status)) {
          clearTimeout(timeoutHandle);
          unsubscribe();
          reject(new Error(`Session reached terminal state ${updatedSession.status} instead of ${targets.join('|')}`));
        }
      });
    });
  }

  /**
   * Update background lane status for a SEND session
   *
   * @param sessionId - Session ID
   * @param aggregatorStatus - Aggregator submission status
   * @param ipfsStatus - IPFS sync status
   */
  updateBackgroundStatus(
    sessionId: string,
    aggregatorStatus?: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED',
    ipfsStatus?: 'PENDING' | 'SYNCED' | 'FAILED'
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.direction !== 'SEND') return;

    if (aggregatorStatus !== undefined) {
      session.aggregatorStatus = aggregatorStatus;
    }
    if (ipfsStatus !== undefined) {
      session.ipfsStatus = ipfsStatus;
    }
    session.updatedAt = Date.now();

    this.notifyListeners(sessionId, session);

    // Emit background progress events
    if (aggregatorStatus) {
      this.emitProgress(sessionId, 'BACKGROUND_AGGREGATOR', `Aggregator: ${aggregatorStatus}`);
    }
    if (ipfsStatus) {
      this.emitProgress(sessionId, 'BACKGROUND_IPFS', `IPFS: ${ipfsStatus}`);
    }
  }

  /**
   * Get session statistics
   */
  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    timedOut: number;
    byDirection: { SEND: number; RECEIVE: number };
  } {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      active: sessions.filter(s => !isPaymentSessionTerminal(s)).length,
      completed: sessions.filter(s => s.status === 'COMPLETED').length,
      failed: sessions.filter(s => s.status === 'FAILED').length,
      timedOut: sessions.filter(s => s.status === 'TIMED_OUT').length,
      byDirection: {
        SEND: sessions.filter(s => s.direction === 'SEND').length,
        RECEIVE: sessions.filter(s => s.direction === 'RECEIVE').length,
      },
    };
  }

  /**
   * Cleanup all sessions and listeners
   */
  cleanup(): void {
    // Clear all timeout handles
    for (const handle of this.timeoutHandles.values()) {
      clearTimeout(handle);
    }
    this.timeoutHandles.clear();

    // Clear listeners
    this.listeners.clear();

    // Move active sessions to history before clearing
    for (const session of this.sessions.values()) {
      if (!isPaymentSessionTerminal(session)) {
        session.status = 'TIMED_OUT';
        session.updatedAt = Date.now();
      }
      this.sessionHistory.push(session);
    }

    this.sessions.clear();
    console.log('📋 [PaymentSessionManager] Cleaned up');
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Notify all listeners for a session
   */
  private notifyListeners(sessionId: string, session: PaymentSession): void {
    const listeners = this.listeners.get(sessionId);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(session);
        } catch (err) {
          console.error('📋 [PaymentSession] Listener error:', err);
        }
      }
    }
  }

  /**
   * Emit a transfer progress event
   */
  private emitProgress(
    sessionId: string,
    stage: TransferProgressStage,
    message: string,
    payload?: Record<string, unknown>
  ): void {
    const event: TransferProgressEvent = {
      paymentSessionId: sessionId,
      stage,
      timestamp: Date.now(),
      message,
      payload,
    };
    emitTransferProgress(event);
  }

  /**
   * Convert status to progress stage
   */
  private statusToStage(status: PaymentSessionStatus): TransferProgressStage {
    switch (status) {
      case 'INITIATED':
        return 'SESSION_CREATED';
      case 'COMMITMENT_CREATED':
        return 'COMMITMENT_READY';
      case 'SUBMITTED':
      case 'PROOF_RECEIVED':
      case 'TOKEN_RECEIVED':
      case 'FINALIZING':
        return 'DELIVERING';
      case 'NOSTR_DELIVERED':
        return 'DELIVERED';
      case 'COMPLETED':
        return 'DONE';
      case 'FAILED':
      case 'TIMED_OUT':
        return 'ERROR';
      default:
        return 'DELIVERING';
    }
  }

  /**
   * Schedule timeout check for a session
   */
  private scheduleTimeoutCheck(session: PaymentSession): void {
    if (!session.deadline) return;

    const timeUntilTimeout = session.deadline - Date.now();
    if (timeUntilTimeout <= 0) {
      this.markTimedOut(session.id);
      return;
    }

    const handle = setTimeout(() => {
      this.timeoutHandles.delete(session.id);
      const currentSession = this.sessions.get(session.id);
      if (currentSession && !isPaymentSessionTerminal(currentSession)) {
        this.markTimedOut(session.id);
      }
    }, timeUntilTimeout);

    this.timeoutHandles.set(session.id, handle);
  }

  /**
   * Handle terminal state (cleanup)
   */
  private handleTerminalState(sessionId: string, session: PaymentSession): void {
    // Cancel timeout if exists
    const timeoutHandle = this.timeoutHandles.get(sessionId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeoutHandles.delete(sessionId);
    }

    // Add to history
    this.sessionHistory.push({ ...session });

    // Trim history to last 50 entries
    if (this.sessionHistory.length > 50) {
      this.sessionHistory = this.sessionHistory.slice(-50);
    }

    // Keep in sessions map for a short time (for queries), then remove
    setTimeout(() => {
      this.sessions.delete(sessionId);
      this.listeners.delete(sessionId);
    }, 60000); // Keep for 1 minute after terminal
  }

  /**
   * Evict oldest session (LRU)
   */
  private evictOldestSession(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, session] of this.sessions) {
      // Prefer evicting terminal sessions first
      if (isPaymentSessionTerminal(session)) {
        this.sessions.delete(id);
        this.listeners.delete(id);
        console.log(`📋 [PaymentSession] Evicted terminal session ${id.slice(0, 8)}`);
        return;
      }

      if (session.updatedAt < oldestTime) {
        oldestTime = session.updatedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      const session = this.sessions.get(oldestId);
      if (session) {
        session.status = 'TIMED_OUT';
        session.updatedAt = Date.now();
        this.sessionHistory.push(session);
      }
      this.sessions.delete(oldestId);
      this.listeners.delete(oldestId);
      console.log(`📋 [PaymentSession] Evicted oldest session ${oldestId.slice(0, 8)}`);
    }
  }
}

/**
 * Get singleton instance (convenience export)
 */
export function getPaymentSessionManager(): PaymentSessionManager {
  return PaymentSessionManager.getInstance();
}
