/**
 * IPFS Sync Provider
 *
 * Implements SyncProvider for IPFS/IPNS backup and sync.
 * Uses HTTP gateways for upload/download and IPNS for addressing.
 *
 * This is a platform-independent sync provider that can work in:
 * - Browser (via fetch API)
 * - Node.js (via fetch or node-fetch)
 *
 * For browser-specific features (Helia DHT), use the browser-specific
 * IpfsStorageService which provides additional functionality.
 */

import {
  PROVIDER_IDS,
  type SyncProvider,
  type ProviderStatus,
  type ProviderType,
  type SyncResult,
  type WalletSnapshot,
} from '../storage-provider';

// ==========================================
// Configuration
// ==========================================

export interface IpfsSyncProviderConfig {
  /** IPFS HTTP API gateway URLs for upload */
  uploadGateways?: string[];
  /** IPFS HTTP gateway URLs for download */
  downloadGateways?: string[];
  /** IPNS HTTP gateway URLs for name resolution */
  ipnsGateways?: string[];
  /** Timeout for HTTP requests in ms */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Function to derive IPNS keypair from wallet private key.
   * Must return { privateKey, publicKey, ipnsName } for IPNS publishing.
   */
  deriveKeyPair?: (walletPrivateKey: string) => Promise<IpnsKeyPair>;
  /** Wallet private key for IPNS operations */
  walletPrivateKey?: string;
}

export interface IpnsKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  ipnsName: string;
}

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: Required<Omit<IpfsSyncProviderConfig, 'deriveKeyPair' | 'walletPrivateKey'>> = {
  uploadGateways: [
    'https://ipfs.unicity.network/api/v0',
  ],
  downloadGateways: [
    'https://ipfs.unicity.network/ipfs',
    'https://dweb.link/ipfs',
    'https://cloudflare-ipfs.com/ipfs',
  ],
  ipnsGateways: [
    'https://ipfs.unicity.network/ipns',
    'https://dweb.link/ipns',
  ],
  timeout: 30000,
  debug: false,
};

// ==========================================
// Implementation
// ==========================================

/**
 * IPFS Sync Provider
 *
 * Syncs wallet data to IPFS with IPNS for addressing.
 * Uses HTTP gateways - no local IPFS node required.
 */
export class IpfsSyncProvider implements SyncProvider {
  // Metadata
  readonly id = PROVIDER_IDS.IPFS;
  readonly name = 'IPFS Network';
  readonly type: ProviderType = 'p2p';
  readonly icon = '🌐';
  readonly description = 'Decentralized storage on IPFS network';

  // Configuration
  private readonly uploadGateways: string[];
  private readonly downloadGateways: string[];
  private readonly ipnsGateways: string[];
  private readonly timeout: number;
  private readonly debug: boolean;
  private readonly deriveKeyPair?: (walletPrivateKey: string) => Promise<IpnsKeyPair>;
  private walletPrivateKey?: string;

  // State
  private status: ProviderStatus = 'disconnected';
  private keyPair: IpnsKeyPair | null = null;
  private lastSyncTimes: Map<string, number> = new Map();

  constructor(config: IpfsSyncProviderConfig = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.uploadGateways = merged.uploadGateways;
    this.downloadGateways = merged.downloadGateways;
    this.ipnsGateways = merged.ipnsGateways;
    this.timeout = merged.timeout;
    this.debug = merged.debug;
    this.deriveKeyPair = config.deriveKeyPair;
    this.walletPrivateKey = config.walletPrivateKey;
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async connect(config?: { walletPrivateKey?: string }): Promise<void> {
    this.status = 'connecting';
    this.log('Connecting to IPFS...');

    try {
      // Use config from connect() or from constructor
      const privateKey = config?.walletPrivateKey ?? this.walletPrivateKey;

      if (privateKey && this.deriveKeyPair) {
        this.keyPair = await this.deriveKeyPair(privateKey);
        this.log(`IPNS name: ${this.keyPair.ipnsName}`);
      }

      // Test gateway connectivity
      const testUrl = `${this.downloadGateways[0]}/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`;
      const response = await this.fetchWithTimeout(testUrl, { method: 'HEAD' });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Gateway test failed: ${response.status}`);
      }

      this.status = 'connected';
      this.log('Connected to IPFS');
    } catch (error) {
      this.status = 'error';
      throw new Error(`Failed to connect to IPFS: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.keyPair = null;
    this.log('Disconnected from IPFS');
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  // ==========================================
  // Sync Operations
  // ==========================================

  async push(snapshot: WalletSnapshot): Promise<SyncResult> {
    this.log(`Pushing snapshot for ${snapshot.address.slice(0, 20)}...`);

    try {
      // 1. Serialize snapshot to JSON
      const data = JSON.stringify(snapshot);

      // 2. Upload to IPFS
      const cid = await this.uploadToIpfs(data);
      this.log(`Uploaded to IPFS: ${cid}`);

      // 3. Publish IPNS record (if keypair available)
      let ipnsPublished = false;
      if (this.keyPair) {
        ipnsPublished = await this.publishIpns(cid);
        if (ipnsPublished) {
          this.log(`Published IPNS: ${this.keyPair.ipnsName} -> ${cid}`);
        }
      }

      // 4. Update last sync time
      this.lastSyncTimes.set(snapshot.address, Date.now());

      return {
        providerId: this.id,
        success: true,
        pushed: snapshot.tokens.length,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.log(`Push failed: ${error}`);
      return {
        providerId: this.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  async pull(address: string): Promise<WalletSnapshot | null> {
    this.log(`Pulling snapshot for ${address.slice(0, 20)}...`);

    try {
      // 1. Resolve IPNS to get latest CID
      if (!this.keyPair) {
        this.log('No keypair available for IPNS resolution');
        return null;
      }

      const cid = await this.resolveIpns(this.keyPair.ipnsName);
      if (!cid) {
        this.log('IPNS resolution failed - no content found');
        return null;
      }

      this.log(`Resolved IPNS to CID: ${cid}`);

      // 2. Fetch content from IPFS
      const data = await this.fetchFromIpfs(cid);
      if (!data) {
        this.log('Failed to fetch content from IPFS');
        return null;
      }

      // 3. Parse snapshot
      const snapshot = JSON.parse(data) as WalletSnapshot;

      // 4. Validate address matches
      if (snapshot.address !== address) {
        this.log(`Address mismatch: expected ${address}, got ${snapshot.address}`);
        return null;
      }

      this.log(`Pulled snapshot: ${snapshot.tokens.length} tokens`);
      return snapshot;
    } catch (error) {
      this.log(`Pull failed: ${error}`);
      return null;
    }
  }

  async getLastSyncTime(address: string): Promise<number | null> {
    return this.lastSyncTimes.get(address) ?? null;
  }

  // ==========================================
  // IPFS Operations
  // ==========================================

  private async uploadToIpfs(data: string): Promise<string> {
    for (const gateway of this.uploadGateways) {
      try {
        const formData = new FormData();
        formData.append('file', new Blob([data], { type: 'application/json' }));

        const response = await this.fetchWithTimeout(`${gateway}/add`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const result = await response.json();
          return result.Hash || result.cid;
        }
      } catch (error) {
        this.log(`Upload to ${gateway} failed: ${error}`);
      }
    }

    throw new Error('All upload gateways failed');
  }

  private async fetchFromIpfs(cid: string): Promise<string | null> {
    for (const gateway of this.downloadGateways) {
      try {
        const response = await this.fetchWithTimeout(`${gateway}/${cid}`);

        if (response.ok) {
          return await response.text();
        }
      } catch (error) {
        this.log(`Fetch from ${gateway} failed: ${error}`);
      }
    }

    return null;
  }

  // ==========================================
  // IPNS Operations
  // ==========================================

  private async publishIpns(cid: string): Promise<boolean> {
    if (!this.keyPair) return false;

    // TODO: Implement IPNS record creation and publishing
    // This requires signing the record with the private key
    // For now, we rely on the upload gateway to handle IPNS
    this.log(`IPNS publishing not yet implemented - CID: ${cid}`);
    return false;
  }

  private async resolveIpns(ipnsName: string): Promise<string | null> {
    for (const gateway of this.ipnsGateways) {
      try {
        // Try direct resolution
        const response = await this.fetchWithTimeout(`${gateway}/${ipnsName}`, {
          method: 'HEAD',
          redirect: 'manual',
        });

        // Check for redirect to IPFS CID
        const location = response.headers.get('location');
        if (location) {
          const cidMatch = location.match(/\/ipfs\/([a-zA-Z0-9]+)/);
          if (cidMatch) {
            return cidMatch[1];
          }
        }

        // Try API endpoint
        const apiResponse = await this.fetchWithTimeout(
          `${gateway.replace('/ipns', '')}/api/v0/name/resolve?arg=${ipnsName}`
        );

        if (apiResponse.ok) {
          const result = await apiResponse.json();
          if (result.Path) {
            const cidMatch = result.Path.match(/\/ipfs\/([a-zA-Z0-9]+)/);
            if (cidMatch) {
              return cidMatch[1];
            }
          }
        }
      } catch (error) {
        this.log(`IPNS resolution via ${gateway} failed: ${error}`);
      }
    }

    return null;
  }

  // ==========================================
  // Helpers
  // ==========================================

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[IpfsSyncProvider] ${message}`);
    }
  }

  // ==========================================
  // Public Getters
  // ==========================================

  /**
   * Get the IPNS name for the current wallet
   */
  getIpnsName(): string | null {
    return this.keyPair?.ipnsName ?? null;
  }

  /**
   * Set wallet private key for IPNS operations
   */
  setWalletPrivateKey(privateKey: string): void {
    this.walletPrivateKey = privateKey;
    // Reset keypair - will be derived on next connect
    this.keyPair = null;
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an IPFS sync provider
 */
export function createIpfsSyncProvider(
  config?: IpfsSyncProviderConfig
): IpfsSyncProvider {
  return new IpfsSyncProvider(config);
}
