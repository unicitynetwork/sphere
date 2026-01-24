/**
 * IPFS State Persistence Interface (Platform-Independent)
 *
 * Defines interface for persisting IPFS/IPNS state (version, sequence number, CID).
 * Implementations can use localStorage (browser), files (CLI), or other storage.
 */

// ==========================================
// Types
// ==========================================

/**
 * Persisted state for IPFS storage
 */
export interface IpfsPersistedState {
  /** Current version counter */
  version: number;
  /** IPNS sequence number (bigint stored as string) */
  sequenceNumber: string;
  /** Last known CID */
  lastCid: string | null;
  /** Pending IPNS publish CID (for retry after failed publish) */
  pendingIpnsCid?: string | null;
}

/**
 * Interface for IPFS state persistence
 * Implementations handle platform-specific storage (localStorage, files, etc.)
 */
export interface IpfsStatePersistence {
  /**
   * Load persisted state for an IPNS name
   * @param ipnsName - The IPNS name (PeerId string)
   * @returns Persisted state or null if not found
   */
  load(ipnsName: string): IpfsPersistedState | null;

  /**
   * Save state for an IPNS name
   * @param ipnsName - The IPNS name (PeerId string)
   * @param state - State to persist
   */
  save(ipnsName: string, state: IpfsPersistedState): void;

  /**
   * Clear persisted state for an IPNS name
   * @param ipnsName - The IPNS name (PeerId string)
   */
  clear(ipnsName: string): void;

  /**
   * Migrate state from old key format to new
   * @param oldIpnsName - Old IPNS name format
   * @param newIpnsName - New IPNS name format (PeerId)
   */
  migrate?(oldIpnsName: string, newIpnsName: string): void;
}

// ==========================================
// In-Memory Implementation (for testing/CLI)
// ==========================================

/**
 * In-memory IPFS state persistence (no actual storage)
 * Useful for testing or stateless CLI operations
 */
export class InMemoryIpfsStatePersistence implements IpfsStatePersistence {
  private states = new Map<string, IpfsPersistedState>();

  load(ipnsName: string): IpfsPersistedState | null {
    return this.states.get(ipnsName) ?? null;
  }

  save(ipnsName: string, state: IpfsPersistedState): void {
    this.states.set(ipnsName, state);
  }

  clear(ipnsName: string): void {
    this.states.delete(ipnsName);
  }

  migrate(oldIpnsName: string, newIpnsName: string): void {
    const state = this.states.get(oldIpnsName);
    if (state && !this.states.has(newIpnsName)) {
      this.states.set(newIpnsName, state);
      this.states.delete(oldIpnsName);
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an in-memory IPFS state persistence
 */
export function createInMemoryIpfsStatePersistence(): IpfsStatePersistence {
  return new InMemoryIpfsStatePersistence();
}
