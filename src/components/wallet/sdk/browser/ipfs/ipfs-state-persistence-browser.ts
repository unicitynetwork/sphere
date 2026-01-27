/**
 * Browser IPFS State Persistence (localStorage)
 *
 * Implements IpfsStatePersistence using browser localStorage.
 * Handles key migration from old format to new PeerId format.
 */

import type { IpfsStatePersistence, IpfsPersistedState } from '../../storage/ipfs-state-persistence';

// ==========================================
// Constants
// ==========================================

const KEY_PREFIX_VERSION = 'ipfs_version_';
const KEY_PREFIX_SEQUENCE = 'ipns_seq_';
const KEY_PREFIX_LAST_CID = 'ipfs_last_cid_';
const KEY_PREFIX_PENDING_IPNS = 'ipfs_pending_ipns_';

// ==========================================
// Browser Implementation
// ==========================================

/**
 * Browser localStorage implementation of IPFS state persistence
 */
export class BrowserIpfsStatePersistence implements IpfsStatePersistence {
  private readonly keyPrefixVersion: string;
  private readonly keyPrefixSequence: string;
  private readonly keyPrefixLastCid: string;
  private readonly keyPrefixPendingIpns: string;

  constructor(options?: {
    keyPrefixVersion?: string;
    keyPrefixSequence?: string;
    keyPrefixLastCid?: string;
    keyPrefixPendingIpns?: string;
  }) {
    this.keyPrefixVersion = options?.keyPrefixVersion ?? KEY_PREFIX_VERSION;
    this.keyPrefixSequence = options?.keyPrefixSequence ?? KEY_PREFIX_SEQUENCE;
    this.keyPrefixLastCid = options?.keyPrefixLastCid ?? KEY_PREFIX_LAST_CID;
    this.keyPrefixPendingIpns = options?.keyPrefixPendingIpns ?? KEY_PREFIX_PENDING_IPNS;
  }

  /**
   * Check if localStorage is available
   */
  private isAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  load(ipnsName: string): IpfsPersistedState | null {
    if (!this.isAvailable()) return null;

    try {
      const versionKey = `${this.keyPrefixVersion}${ipnsName}`;
      const seqKey = `${this.keyPrefixSequence}${ipnsName}`;
      const cidKey = `${this.keyPrefixLastCid}${ipnsName}`;
      const pendingKey = `${this.keyPrefixPendingIpns}${ipnsName}`;

      const versionStr = localStorage.getItem(versionKey);
      const seqStr = localStorage.getItem(seqKey);
      const lastCid = localStorage.getItem(cidKey);
      const pendingIpnsCid = localStorage.getItem(pendingKey);

      // Return null if no state was ever saved
      if (!versionStr && !seqStr && !lastCid && !pendingIpnsCid) {
        return null;
      }

      return {
        version: versionStr ? parseInt(versionStr, 10) : 0,
        sequenceNumber: seqStr ?? '0',
        lastCid: lastCid,
        pendingIpnsCid: pendingIpnsCid,
      };
    } catch (error) {
      console.warn('[IpfsStatePersistence] Failed to load state:', error);
      return null;
    }
  }

  save(ipnsName: string, state: IpfsPersistedState): void {
    if (!this.isAvailable()) return;

    try {
      const versionKey = `${this.keyPrefixVersion}${ipnsName}`;
      const seqKey = `${this.keyPrefixSequence}${ipnsName}`;
      const cidKey = `${this.keyPrefixLastCid}${ipnsName}`;
      const pendingKey = `${this.keyPrefixPendingIpns}${ipnsName}`;

      localStorage.setItem(versionKey, String(state.version));
      localStorage.setItem(seqKey, state.sequenceNumber);

      if (state.lastCid) {
        localStorage.setItem(cidKey, state.lastCid);
      } else {
        localStorage.removeItem(cidKey);
      }

      if (state.pendingIpnsCid) {
        localStorage.setItem(pendingKey, state.pendingIpnsCid);
      } else {
        localStorage.removeItem(pendingKey);
      }
    } catch (error) {
      console.warn('[IpfsStatePersistence] Failed to save state:', error);
    }
  }

  clear(ipnsName: string): void {
    if (!this.isAvailable()) return;

    try {
      const versionKey = `${this.keyPrefixVersion}${ipnsName}`;
      const seqKey = `${this.keyPrefixSequence}${ipnsName}`;
      const cidKey = `${this.keyPrefixLastCid}${ipnsName}`;
      const pendingKey = `${this.keyPrefixPendingIpns}${ipnsName}`;

      localStorage.removeItem(versionKey);
      localStorage.removeItem(seqKey);
      localStorage.removeItem(cidKey);
      localStorage.removeItem(pendingKey);
    } catch (error) {
      console.warn('[IpfsStatePersistence] Failed to clear state:', error);
    }
  }

  migrate(oldIpnsName: string, newIpnsName: string): void {
    if (!this.isAvailable()) return;
    if (oldIpnsName === newIpnsName) return;

    try {
      // Migrate version
      const oldVersionKey = `${this.keyPrefixVersion}${oldIpnsName}`;
      const newVersionKey = `${this.keyPrefixVersion}${newIpnsName}`;
      const version = localStorage.getItem(oldVersionKey);
      if (version && !localStorage.getItem(newVersionKey)) {
        localStorage.setItem(newVersionKey, version);
        localStorage.removeItem(oldVersionKey);
        console.log(`[IpfsStatePersistence] Migrated version: ${oldIpnsName} -> ${newIpnsName}`);
      }

      // Migrate sequence number
      const oldSeqKey = `${this.keyPrefixSequence}${oldIpnsName}`;
      const newSeqKey = `${this.keyPrefixSequence}${newIpnsName}`;
      const seq = localStorage.getItem(oldSeqKey);
      if (seq && !localStorage.getItem(newSeqKey)) {
        localStorage.setItem(newSeqKey, seq);
        localStorage.removeItem(oldSeqKey);
        console.log(`[IpfsStatePersistence] Migrated sequence: ${oldIpnsName} -> ${newIpnsName}`);
      }

      // Migrate last CID
      const oldCidKey = `${this.keyPrefixLastCid}${oldIpnsName}`;
      const newCidKey = `${this.keyPrefixLastCid}${newIpnsName}`;
      const cid = localStorage.getItem(oldCidKey);
      if (cid && !localStorage.getItem(newCidKey)) {
        localStorage.setItem(newCidKey, cid);
        localStorage.removeItem(oldCidKey);
        console.log(`[IpfsStatePersistence] Migrated CID: ${oldIpnsName} -> ${newIpnsName}`);
      }

      // Migrate pending IPNS CID
      const oldPendingKey = `${this.keyPrefixPendingIpns}${oldIpnsName}`;
      const newPendingKey = `${this.keyPrefixPendingIpns}${newIpnsName}`;
      const pendingCid = localStorage.getItem(oldPendingKey);
      if (pendingCid && !localStorage.getItem(newPendingKey)) {
        localStorage.setItem(newPendingKey, pendingCid);
        localStorage.removeItem(oldPendingKey);
        console.log(`[IpfsStatePersistence] Migrated pending IPNS: ${oldIpnsName} -> ${newIpnsName}`);
      }
    } catch (error) {
      console.warn('[IpfsStatePersistence] Failed to migrate state:', error);
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a browser localStorage IPFS state persistence
 */
export function createBrowserIpfsStatePersistence(options?: {
  keyPrefixVersion?: string;
  keyPrefixSequence?: string;
  keyPrefixLastCid?: string;
  keyPrefixPendingIpns?: string;
}): IpfsStatePersistence {
  return new BrowserIpfsStatePersistence(options);
}
