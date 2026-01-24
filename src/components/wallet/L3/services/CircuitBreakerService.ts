/**
 * Circuit Breaker Service
 *
 * Manages failure counters and LOCAL mode activation per TOKEN_INVENTORY_SPEC v3.2
 * Sections 10.6 and 10.7.
 *
 * Thresholds:
 * - consecutiveIpfsFailures >= 10 -> activate LOCAL mode
 * - consecutiveConflicts >= 5 -> activate LOCAL mode
 *
 * Recovery:
 * - After 1 hour in LOCAL mode, attempt recovery to NORMAL mode
 * - Successful full sync in NORMAL mode clears all counters
 */

import type { CircuitBreakerState } from '../types/SyncTypes';
import { createDefaultCircuitBreakerState } from '../types/SyncTypes';

// Constants per spec
const MAX_IPFS_FAILURES = 10;
const MAX_CONSECUTIVE_CONFLICTS = 5;
const RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Storage key for persistence
const CIRCUIT_BREAKER_STORAGE_KEY = 'sphere_circuit_breaker_state';

/**
 * Singleton Circuit Breaker Service
 */
class CircuitBreakerServiceImpl {
  private state: CircuitBreakerState;

  constructor() {
    this.state = this.loadState();
  }

  /**
   * Load circuit breaker state from localStorage
   */
  private loadState(): CircuitBreakerState {
    try {
      const stored = localStorage.getItem(CIRCUIT_BREAKER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CircuitBreakerState;
        // Validate structure
        if (typeof parsed.localModeActive === 'boolean' &&
            typeof parsed.consecutiveConflicts === 'number' &&
            typeof parsed.consecutiveIpfsFailures === 'number') {
          return parsed;
        }
      }
    } catch {
      // Ignore parse errors
    }
    return createDefaultCircuitBreakerState();
  }

  /**
   * Persist circuit breaker state to localStorage
   */
  private saveState(): void {
    try {
      localStorage.setItem(CIRCUIT_BREAKER_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    // Check if we should attempt recovery
    this.checkRecoveryWindow();
    return { ...this.state };
  }

  /**
   * Check if LOCAL mode is active
   */
  isLocalModeActive(): boolean {
    this.checkRecoveryWindow();
    return this.state.localModeActive;
  }

  /**
   * Record an IPFS failure (Step 2 or Step 10)
   * Increments consecutiveIpfsFailures and activates LOCAL mode if threshold reached.
   */
  recordIpfsFailure(): void {
    this.state.consecutiveIpfsFailures++;
    console.log(`🔧 [CircuitBreaker] IPFS failure recorded: ${this.state.consecutiveIpfsFailures}/${MAX_IPFS_FAILURES}`);

    if (this.state.consecutiveIpfsFailures >= MAX_IPFS_FAILURES) {
      this.activateLocalMode('IPFS failures exceeded threshold');
    }

    this.saveState();
  }

  /**
   * Record an IPFS success
   * Resets consecutiveIpfsFailures to 0.
   */
  recordIpfsSuccess(): void {
    if (this.state.consecutiveIpfsFailures > 0) {
      console.log(`🔧 [CircuitBreaker] IPFS success - resetting failure counter from ${this.state.consecutiveIpfsFailures} to 0`);
      this.state.consecutiveIpfsFailures = 0;
      this.saveState();
    }
  }

  /**
   * Record a conflict (sync restart from Step 1)
   * Increments consecutiveConflicts and activates LOCAL mode if threshold reached.
   */
  recordConflict(): void {
    this.state.consecutiveConflicts++;
    this.state.lastConflictTimestamp = Date.now();
    console.log(`🔧 [CircuitBreaker] Conflict recorded: ${this.state.consecutiveConflicts}/${MAX_CONSECUTIVE_CONFLICTS}`);

    if (this.state.consecutiveConflicts >= MAX_CONSECUTIVE_CONFLICTS) {
      this.activateLocalMode('Consecutive conflicts exceeded threshold');
    }

    this.saveState();
  }

  /**
   * Record a successful merge (no conflict)
   * Resets consecutiveConflicts to 0.
   */
  recordMergeSuccess(): void {
    if (this.state.consecutiveConflicts > 0) {
      console.log(`🔧 [CircuitBreaker] Merge success - resetting conflict counter from ${this.state.consecutiveConflicts} to 0`);
      this.state.consecutiveConflicts = 0;
      this.saveState();
    }
  }

  /**
   * Record a fully successful sync in NORMAL mode
   * Clears LOCAL mode and all counters.
   */
  recordFullSyncSuccess(): void {
    if (this.state.localModeActive || this.state.consecutiveConflicts > 0 || this.state.consecutiveIpfsFailures > 0) {
      console.log(`🔧 [CircuitBreaker] Full sync success - clearing all failure states`);
      this.state = createDefaultCircuitBreakerState();
      this.saveState();
    }
  }

  /**
   * Activate LOCAL mode due to failures
   */
  private activateLocalMode(reason: string): void {
    if (!this.state.localModeActive) {
      console.log(`🔧 [CircuitBreaker] Activating LOCAL mode: ${reason}`);
      this.state.localModeActive = true;
      this.state.localModeActivatedAt = Date.now();
      this.state.nextRecoveryAttempt = Date.now() + RECOVERY_INTERVAL_MS;
      this.saveState();
    }
  }

  /**
   * Check if we're in the recovery window and should attempt recovery
   */
  private checkRecoveryWindow(): void {
    if (!this.state.localModeActive) {
      return;
    }

    const now = Date.now();

    // If nextRecoveryAttempt is set and we've passed it, clear LOCAL mode for retry
    if (this.state.nextRecoveryAttempt && now >= this.state.nextRecoveryAttempt) {
      console.log(`🔧 [CircuitBreaker] Recovery window reached - attempting to exit LOCAL mode`);
      // Clear LOCAL mode but keep failure counters until we get a full success
      this.state.localModeActive = false;
      this.state.nextRecoveryAttempt = undefined;
      // Keep localModeActivatedAt for diagnostics
      this.saveState();
    }
  }

  /**
   * Force reset the circuit breaker (for testing/manual recovery)
   */
  reset(): void {
    console.log(`🔧 [CircuitBreaker] Force reset`);
    this.state = createDefaultCircuitBreakerState();
    this.saveState();
  }
}

// Singleton instance
let instance: CircuitBreakerServiceImpl | null = null;

/**
 * Get the circuit breaker service instance
 */
export function getCircuitBreakerService(): CircuitBreakerServiceImpl {
  if (!instance) {
    instance = new CircuitBreakerServiceImpl();
  }
  return instance;
}

// Export types for convenience
export type { CircuitBreakerState };
