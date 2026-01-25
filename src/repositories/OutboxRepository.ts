/**
 * OutboxRepository
 *
 * Persists pending token transfers to localStorage.
 * This is critical for preventing token loss - the outbox stores
 * the complete transfer state (including the random salt) BEFORE
 * submitting to the Unicity aggregator.
 *
 * The flow:
 * 1. Create commitment (with random salt)
 * 2. Save to outbox (localStorage)
 * 3. Sync outbox to IPFS (wait for success)
 * 4. Submit to aggregator (now safe - can recover from IPFS)
 * 5. Get proof, send via Nostr
 * 6. Mark complete, remove from outbox
 */

import type {
  OutboxEntry,
  OutboxEntryStatus,
  OutboxSplitGroup,
  MintOutboxEntry,
} from "../components/wallet/L3/services/types/OutboxTypes";
import {
  isTerminalStatus,
  isPendingStatus,
  validateOutboxEntry,
  validateMintOutboxEntry,
  isMintRecoverable,
} from "../components/wallet/L3/services/types/OutboxTypes";
import { STORAGE_KEYS } from "../config/storageKeys";
import { getInventoryStorage } from "../components/wallet/L3/services/storage/InventoryStorageAdapter";

export class OutboxRepository {
  private static instance: OutboxRepository;

  /** In-memory cache of outbox entries (transfers) */
  private _entries: Map<string, OutboxEntry> = new Map();

  /** In-memory cache of mint outbox entries */
  private _mintEntries: Map<string, MintOutboxEntry> = new Map();

  /** In-memory cache of split groups */
  private _splitGroups: Map<string, OutboxSplitGroup> = new Map();

  /** Current wallet address (for namespacing if needed) */
  private _currentAddress: string | null = null;

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): OutboxRepository {
    if (!OutboxRepository.instance) {
      OutboxRepository.instance = new OutboxRepository();
    }
    return OutboxRepository.instance;
  }

  // ==========================================
  // Address Management
  // ==========================================

  /**
   * Set the current wallet address
   * Call this when wallet is loaded/changed
   */
  setCurrentAddress(address: string): void {
    if (this._currentAddress !== address) {
      this._currentAddress = address;
      this.loadFromStorage();
    }
  }

  getCurrentAddress(): string | null {
    return this._currentAddress;
  }

  // ==========================================
  // CRUD Operations
  // ==========================================

  /**
   * Add a new outbox entry
   * @throws Error if entry with same ID already exists
   */
  addEntry(entry: OutboxEntry): void {
    const validation = validateOutboxEntry(entry);
    if (!validation.valid) {
      throw new Error(`Invalid outbox entry: ${validation.error}`);
    }

    if (this._entries.has(entry.id)) {
      throw new Error(`Outbox entry ${entry.id} already exists`);
    }

    this._entries.set(entry.id, { ...entry });
    this.saveToStorage();

    console.log(`📤 Outbox: Added entry ${entry.id.slice(0, 8)}... (${entry.type}, status=${entry.status})`);
  }

  /**
   * Update an existing outbox entry
   * @returns The updated entry
   */
  updateEntry(id: string, updates: Partial<OutboxEntry>): OutboxEntry {
    const existing = this._entries.get(id);
    if (!existing) {
      throw new Error(`Outbox entry ${id} not found`);
    }

    const updated: OutboxEntry = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const validation = validateOutboxEntry(updated);
    if (!validation.valid) {
      throw new Error(`Invalid outbox entry after update: ${validation.error}`);
    }

    this._entries.set(id, updated);
    this.saveToStorage();

    console.log(`📤 Outbox: Updated entry ${id.slice(0, 8)}... (status=${updated.status})`);

    return updated;
  }

  /**
   * Update just the status of an entry (convenience method)
   */
  updateStatus(id: string, status: OutboxEntryStatus, error?: string): OutboxEntry {
    const updates: Partial<OutboxEntry> = { status };
    if (error) {
      updates.lastError = error;
    }
    return this.updateEntry(id, updates);
  }

  /**
   * Remove an outbox entry
   */
  removeEntry(id: string): void {
    const existed = this._entries.delete(id);
    if (existed) {
      this.saveToStorage();
      console.log(`📤 Outbox: Removed entry ${id.slice(0, 8)}...`);
    }
  }

  /**
   * Get an outbox entry by ID
   */
  getEntry(id: string): OutboxEntry | null {
    const entry = this._entries.get(id);
    return entry ? { ...entry } : null;
  }

  /**
   * Check if an entry exists
   */
  hasEntry(id: string): boolean {
    return this._entries.has(id);
  }

  // ==========================================
  // Query Methods
  // ==========================================

  /**
   * Get all entries
   */
  getAllEntries(): OutboxEntry[] {
    return Array.from(this._entries.values()).map((e) => ({ ...e }));
  }

  /**
   * Get all pending (non-terminal) entries
   */
  getPendingEntries(): OutboxEntry[] {
    return Array.from(this._entries.values())
      .filter((e) => isPendingStatus(e.status))
      .map((e) => ({ ...e }));
  }

  /**
   * Get entries by status
   */
  getEntriesByStatus(status: OutboxEntryStatus): OutboxEntry[] {
    return Array.from(this._entries.values())
      .filter((e) => e.status === status)
      .map((e) => ({ ...e }));
  }

  /**
   * Get entries for a specific source token
   */
  getEntriesForToken(sourceTokenId: string): OutboxEntry[] {
    return Array.from(this._entries.values())
      .filter((e) => e.sourceTokenId === sourceTokenId)
      .map((e) => ({ ...e }));
  }

  /**
   * Check if a token has any pending outbox entries
   * Use this to prevent double-spend
   */
  isTokenInOutbox(sourceTokenId: string): boolean {
    for (const entry of this._entries.values()) {
      if (entry.sourceTokenId === sourceTokenId && isPendingStatus(entry.status)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the count of pending entries
   */
  getPendingCount(): number {
    let count = 0;
    for (const entry of this._entries.values()) {
      if (isPendingStatus(entry.status)) {
        count++;
      }
    }
    return count;
  }

  // ==========================================
  // Split Group Management
  // ==========================================

  /**
   * Create a new split group
   */
  createSplitGroup(group: OutboxSplitGroup): void {
    if (this._splitGroups.has(group.groupId)) {
      throw new Error(`Split group ${group.groupId} already exists`);
    }

    this._splitGroups.set(group.groupId, { ...group });
    this.saveSplitGroupsToStorage();

    console.log(`📤 Outbox: Created split group ${group.groupId.slice(0, 8)}...`);
  }

  /**
   * Get a split group by ID
   */
  getSplitGroup(groupId: string): OutboxSplitGroup | null {
    const group = this._splitGroups.get(groupId);
    return group ? { ...group } : null;
  }

  /**
   * Add an entry ID to a split group
   */
  addEntryToSplitGroup(groupId: string, entryId: string): void {
    const group = this._splitGroups.get(groupId);
    if (!group) {
      throw new Error(`Split group ${groupId} not found`);
    }

    if (!group.entryIds.includes(entryId)) {
      group.entryIds.push(entryId);
      this.saveSplitGroupsToStorage();
    }
  }

  /**
   * Remove a split group
   */
  removeSplitGroup(groupId: string): void {
    const existed = this._splitGroups.delete(groupId);
    if (existed) {
      this.saveSplitGroupsToStorage();
      console.log(`📤 Outbox: Removed split group ${groupId.slice(0, 8)}...`);
    }
  }

  /**
   * Get all split groups
   */
  getAllSplitGroups(): OutboxSplitGroup[] {
    return Array.from(this._splitGroups.values()).map((g) => ({ ...g }));
  }

  // ==========================================
  // IPFS Integration
  // ==========================================

  /**
   * Get all entries for IPFS sync
   * Returns entries that should be included in the TXF storage
   */
  getAllForSync(): OutboxEntry[] {
    // Include all non-completed entries
    // Completed entries can be cleaned up after sync
    return Array.from(this._entries.values())
      .filter((e) => e.status !== "COMPLETED")
      .map((e) => ({ ...e }));
  }

  /**
   * Import entries from remote IPFS storage
   * Used during bidirectional sync
   */
  importFromRemote(remoteEntries: OutboxEntry[]): void {
    let imported = 0;

    for (const remote of remoteEntries) {
      const local = this._entries.get(remote.id);

      if (!local) {
        // New entry from remote - add it
        this._entries.set(remote.id, { ...remote });
        imported++;
      } else if (remote.updatedAt > local.updatedAt) {
        // Remote is newer - update local
        this._entries.set(remote.id, { ...remote });
        imported++;
      }
      // If local is newer or same, keep local
    }

    if (imported > 0) {
      this.saveToStorage();
      console.log(`📤 Outbox: Imported ${imported} entries from remote`);
    }
  }

  // ==========================================
  // Mint Outbox CRUD Operations
  // ==========================================

  /**
   * Add a new mint outbox entry
   * @throws Error if entry with same ID already exists
   */
  addMintEntry(entry: MintOutboxEntry): void {
    const validation = validateMintOutboxEntry(entry);
    if (!validation.valid) {
      throw new Error(`Invalid mint outbox entry: ${validation.error}`);
    }

    if (this._mintEntries.has(entry.id)) {
      throw new Error(`Mint outbox entry ${entry.id} already exists`);
    }

    this._mintEntries.set(entry.id, { ...entry });
    this.saveMintEntriesToStorage();

    console.log(`📤 Outbox: Added mint entry ${entry.id.slice(0, 8)}... (${entry.type}, status=${entry.status})`);
  }

  /**
   * Get a mint outbox entry by ID
   */
  getMintEntry(id: string): MintOutboxEntry | null {
    const entry = this._mintEntries.get(id);
    return entry ? { ...entry } : null;
  }

  /**
   * Update an existing mint outbox entry
   * @returns The updated entry
   */
  updateMintEntry(id: string, updates: Partial<MintOutboxEntry>): MintOutboxEntry {
    const existing = this._mintEntries.get(id);
    if (!existing) {
      throw new Error(`Mint outbox entry ${id} not found`);
    }

    const updated: MintOutboxEntry = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const validation = validateMintOutboxEntry(updated);
    if (!validation.valid) {
      throw new Error(`Invalid mint outbox entry after update: ${validation.error}`);
    }

    this._mintEntries.set(id, updated);
    this.saveMintEntriesToStorage();

    console.log(`📤 Outbox: Updated mint entry ${id.slice(0, 8)}... (status=${updated.status})`);

    return updated;
  }

  /**
   * Update just the status of a mint entry (convenience method)
   */
  updateMintStatus(id: string, status: OutboxEntryStatus, error?: string): MintOutboxEntry {
    const updates: Partial<MintOutboxEntry> = { status };
    if (error) {
      updates.lastError = error;
    }
    return this.updateMintEntry(id, updates);
  }

  /**
   * Remove a mint outbox entry
   */
  removeMintEntry(id: string): void {
    const existed = this._mintEntries.delete(id);
    if (existed) {
      this.saveMintEntriesToStorage();
      console.log(`📤 Outbox: Removed mint entry ${id.slice(0, 8)}...`);
    }
  }

  /**
   * Check if a mint entry exists
   */
  hasMintEntry(id: string): boolean {
    return this._mintEntries.has(id);
  }

  // ==========================================
  // Mint Outbox Query Methods
  // ==========================================

  /**
   * Get all mint entries
   */
  getAllMintEntries(): MintOutboxEntry[] {
    return Array.from(this._mintEntries.values()).map((e) => ({ ...e }));
  }

  /**
   * Get all pending (non-terminal) mint entries
   */
  getPendingMintEntries(): MintOutboxEntry[] {
    return Array.from(this._mintEntries.values())
      .filter((e) => isPendingStatus(e.status))
      .map((e) => ({ ...e }));
  }

  /**
   * Get mint entries that can be recovered
   */
  getMintEntriesForRecovery(): MintOutboxEntry[] {
    return Array.from(this._mintEntries.values())
      .filter((e) => isMintRecoverable(e))
      .map((e) => ({ ...e }));
  }

  /**
   * Get mint entries by status
   */
  getMintEntriesByStatus(status: OutboxEntryStatus): MintOutboxEntry[] {
    return Array.from(this._mintEntries.values())
      .filter((e) => e.status === status)
      .map((e) => ({ ...e }));
  }

  /**
   * Check if there's a pending mint for a specific nametag
   * Use this to prevent duplicate mints
   */
  isNametagMintInProgress(nametag: string): boolean {
    for (const entry of this._mintEntries.values()) {
      if (entry.nametag === nametag && isPendingStatus(entry.status)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all mint entries for IPFS sync
   */
  getAllMintEntriesForSync(): MintOutboxEntry[] {
    // Include all non-completed entries
    return Array.from(this._mintEntries.values())
      .filter((e) => e.status !== "COMPLETED")
      .map((e) => ({ ...e }));
  }

  /**
   * Import mint entries from remote IPFS storage
   */
  importMintEntriesFromRemote(remoteEntries: MintOutboxEntry[]): void {
    let imported = 0;

    for (const remote of remoteEntries) {
      const local = this._mintEntries.get(remote.id);

      if (!local) {
        // New entry from remote - add it
        this._mintEntries.set(remote.id, { ...remote });
        imported++;
      } else if (remote.updatedAt > local.updatedAt) {
        // Remote is newer - update local
        this._mintEntries.set(remote.id, { ...remote });
        imported++;
      }
      // If local is newer or same, keep local
    }

    if (imported > 0) {
      this.saveMintEntriesToStorage();
      console.log(`📤 Outbox: Imported ${imported} mint entries from remote`);
    }
  }

  // ==========================================
  // Cleanup
  // ==========================================

  /**
   * Remove completed entries older than maxAge milliseconds
   * @param maxAge Maximum age in milliseconds (default: 24 hours)
   * @returns Number of entries removed (transfers + mints)
   */
  cleanupCompleted(maxAge: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    // Cleanup transfer entries
    for (const [id, entry] of this._entries) {
      if (isTerminalStatus(entry.status) && entry.updatedAt < cutoff) {
        this._entries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.saveToStorage();
    }

    // Cleanup mint entries
    let mintRemoved = 0;
    for (const [id, entry] of this._mintEntries) {
      if (isTerminalStatus(entry.status) && entry.updatedAt < cutoff) {
        this._mintEntries.delete(id);
        mintRemoved++;
      }
    }

    if (mintRemoved > 0) {
      this.saveMintEntriesToStorage();
    }

    const totalRemoved = removed + mintRemoved;
    if (totalRemoved > 0) {
      console.log(`📤 Outbox: Cleaned up ${removed} transfer entries and ${mintRemoved} mint entries`);
    }

    return totalRemoved;
  }

  /**
   * Clear all entries (use with caution!)
   */
  clearAll(): void {
    this._entries.clear();
    this._mintEntries.clear();
    this._splitGroups.clear();
    this.saveToStorage();
    this.saveMintEntriesToStorage();
    this.saveSplitGroupsToStorage();
    console.log(`📤 Outbox: Cleared all entries`);
  }

  // ==========================================
  // Storage Operations
  // ==========================================

  private getStorageKey(): string {
    // If we have a current address, namespace the storage
    if (this._currentAddress) {
      return `${STORAGE_KEYS.OUTBOX}_${this._currentAddress}`;
    }
    return STORAGE_KEYS.OUTBOX;
  }

  private getSplitGroupsStorageKey(): string {
    if (this._currentAddress) {
      return `${STORAGE_KEYS.OUTBOX_SPLIT_GROUPS}_${this._currentAddress}`;
    }
    return STORAGE_KEYS.OUTBOX_SPLIT_GROUPS;
  }

  private getMintEntriesStorageKey(): string {
    if (this._currentAddress) {
      return `${STORAGE_KEYS.OUTBOX}_mint_${this._currentAddress}`;
    }
    return `${STORAGE_KEYS.OUTBOX}_mint`;
  }

  private loadFromStorage(): void {
    try {
      const storage = getInventoryStorage();

      // Load transfer entries
      const json = storage.getItem(this.getStorageKey());
      if (json) {
        const entries = JSON.parse(json) as OutboxEntry[];
        this._entries.clear();
        for (const entry of entries) {
          this._entries.set(entry.id, entry);
        }
        console.log(`📤 Outbox: Loaded ${this._entries.size} transfer entries from storage`);
      } else {
        this._entries.clear();
      }

      // Load mint entries
      const mintJson = storage.getItem(this.getMintEntriesStorageKey());
      if (mintJson) {
        const mintEntries = JSON.parse(mintJson) as MintOutboxEntry[];
        this._mintEntries.clear();
        for (const entry of mintEntries) {
          this._mintEntries.set(entry.id, entry);
        }
        if (this._mintEntries.size > 0) {
          console.log(`📤 Outbox: Loaded ${this._mintEntries.size} mint entries from storage`);
        }
      } else {
        this._mintEntries.clear();
      }

      // Load split groups
      const groupsJson = storage.getItem(this.getSplitGroupsStorageKey());
      if (groupsJson) {
        const groups = JSON.parse(groupsJson) as OutboxSplitGroup[];
        this._splitGroups.clear();
        for (const group of groups) {
          this._splitGroups.set(group.groupId, group);
        }
      } else {
        this._splitGroups.clear();
      }
    } catch (error) {
      console.error("📤 Outbox: Failed to load from storage:", error);
      this._entries.clear();
      this._mintEntries.clear();
      this._splitGroups.clear();
    }
  }

  private saveToStorage(): void {
    try {
      const entries = Array.from(this._entries.values());
      const storage = getInventoryStorage();
      storage.setItem(this.getStorageKey(), JSON.stringify(entries));
    } catch (error) {
      console.error("📤 Outbox: Failed to save to storage:", error);
    }
  }

  private saveMintEntriesToStorage(): void {
    try {
      const entries = Array.from(this._mintEntries.values());
      const storage = getInventoryStorage();
      storage.setItem(this.getMintEntriesStorageKey(), JSON.stringify(entries));
    } catch (error) {
      console.error("📤 Outbox: Failed to save mint entries to storage:", error);
    }
  }

  private saveSplitGroupsToStorage(): void {
    try {
      const groups = Array.from(this._splitGroups.values());
      const storage = getInventoryStorage();
      storage.setItem(this.getSplitGroupsStorageKey(), JSON.stringify(groups));
    } catch (error) {
      console.error("📤 Outbox: Failed to save split groups to storage:", error);
    }
  }

  // ==========================================
  // Debug / Stats
  // ==========================================

  /**
   * Get statistics about the outbox (transfers and mints)
   */
  getStats(): {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    byStatus: Record<OutboxEntryStatus, number>;
    mints: {
      total: number;
      pending: number;
      completed: number;
      failed: number;
      byStatus: Record<OutboxEntryStatus, number>;
    };
  } {
    // Transfer stats
    const byStatus: Record<OutboxEntryStatus, number> = {
      PENDING_IPFS_SYNC: 0,
      READY_TO_SUBMIT: 0,
      SUBMITTED: 0,
      PROOF_RECEIVED: 0,
      NOSTR_SENT: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    for (const entry of this._entries.values()) {
      byStatus[entry.status]++;
    }

    // Mint stats
    const mintByStatus: Record<OutboxEntryStatus, number> = {
      PENDING_IPFS_SYNC: 0,
      READY_TO_SUBMIT: 0,
      SUBMITTED: 0,
      PROOF_RECEIVED: 0,
      NOSTR_SENT: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    let mintPending = 0;
    for (const entry of this._mintEntries.values()) {
      mintByStatus[entry.status]++;
      if (isPendingStatus(entry.status)) {
        mintPending++;
      }
    }

    return {
      total: this._entries.size,
      pending: this.getPendingCount(),
      completed: byStatus.COMPLETED,
      failed: byStatus.FAILED,
      byStatus,
      mints: {
        total: this._mintEntries.size,
        pending: mintPending,
        completed: mintByStatus.COMPLETED,
        failed: mintByStatus.FAILED,
        byStatus: mintByStatus,
      },
    };
  }
}

// Export singleton getter for convenience
export function getOutboxRepository(): OutboxRepository {
  return OutboxRepository.getInstance();
}
