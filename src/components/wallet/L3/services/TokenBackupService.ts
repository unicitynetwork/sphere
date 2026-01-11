/**
 * Token Backup Service
 *
 * Provides encrypted local backup for tokens since Unicity cannot recover lost tokens.
 *
 * CRITICAL CONTEXT:
 * - Unicity blockchain stores ONLY cryptographic hashes, NOT token data
 * - If a token is lost (IPFS failure, device loss, sync error), it is UNRECOVERABLE
 * - This service provides a safety net via encrypted local/downloadable backups
 *
 * Features:
 * - AES-256-GCM encryption with PBKDF2 key derivation
 * - Compatible with browser Web Crypto API
 * - Backup status monitoring (warns when backup is stale)
 * - Support for both file download and localStorage backup
 */

import { Token as LocalToken, TokenStatus } from "../data/model";
import type { TxfToken } from "./types/TxfTypes";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

// ==========================================
// Types
// ==========================================

export interface BackupMetadata {
  version: "1.0";
  timestamp: number;
  tokenCount: number;
  walletAddress: string;
  checksum: string; // SHA-256 of token data for integrity
}

export interface TokenBackupData {
  metadata: BackupMetadata;
  tokens: {
    id: string;
    jsonData: string;
    coinId: string;
    amount: string;
    symbol: string;
    type: string;
  }[];
}

export interface BackupStatus {
  needsBackup: boolean;
  reason: string;
  lastBackupTime: number | null;
  daysSinceBackup: number | null;
  lastSyncTime: number | null;
  daysSinceSync: number | null;
}

// ==========================================
// TokenBackupService
// ==========================================

export class TokenBackupService {
  private static instance: TokenBackupService | null = null;

  private readonly BACKUP_STALE_DAYS = 7;
  private readonly SYNC_WARNING_DAYS = 3;

  // ==========================================
  // Singleton
  // ==========================================

  static getInstance(): TokenBackupService {
    if (!TokenBackupService.instance) {
      TokenBackupService.instance = new TokenBackupService();
    }
    return TokenBackupService.instance;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Create encrypted backup of all tokens
   * Returns a Blob that can be downloaded by the user
   */
  async createEncryptedBackup(
    tokens: LocalToken[],
    password: string,
    walletAddress: string
  ): Promise<{ blob: Blob; tokenCount: number; checksum: string }> {
    // Build backup data structure
    const tokensData = tokens
      .filter(t => t.jsonData) // Only include tokens with valid data
      .map(t => ({
        id: t.id,
        jsonData: t.jsonData!,
        coinId: t.coinId || "",
        amount: t.amount || "0",
        symbol: t.symbol || "",
        type: t.type,
      }));

    // Calculate checksum for integrity verification
    const checksum = await this.calculateChecksum(JSON.stringify(tokensData));

    const backup: TokenBackupData = {
      metadata: {
        version: "1.0",
        timestamp: Date.now(),
        tokenCount: tokensData.length,
        walletAddress,
        checksum,
      },
      tokens: tokensData,
    };

    // Encrypt with password
    const encrypted = await this.encryptWithPassword(
      JSON.stringify(backup),
      password
    );

    // Update backup timestamp
    this.updateBackupTimestamp();

    console.log(`📦 Backup created: ${tokensData.length} tokens, checksum: ${checksum.slice(0, 16)}...`);

    return {
      blob: new Blob([encrypted], { type: "application/octet-stream" }),
      tokenCount: tokensData.length,
      checksum,
    };
  }

  /**
   * Restore tokens from encrypted backup
   * Validates checksum to ensure data integrity
   */
  async restoreFromBackup(
    encryptedData: ArrayBuffer,
    password: string
  ): Promise<{
    tokens: LocalToken[];
    metadata: BackupMetadata;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Decrypt
    let decrypted: string;
    try {
      decrypted = await this.decryptWithPassword(encryptedData, password);
    } catch {
      throw new Error("Failed to decrypt backup. Wrong password or corrupted file.");
    }

    // Parse backup data
    let backup: TokenBackupData;
    try {
      backup = JSON.parse(decrypted);
    } catch {
      throw new Error("Invalid backup format. File may be corrupted.");
    }

    // Validate structure
    if (!backup.metadata || !backup.tokens || !Array.isArray(backup.tokens)) {
      throw new Error("Invalid backup structure");
    }

    // Verify checksum
    const calculatedChecksum = await this.calculateChecksum(JSON.stringify(backup.tokens));
    if (calculatedChecksum !== backup.metadata.checksum) {
      warnings.push("Checksum mismatch - backup may have been tampered with");
    }

    // Check backup age
    const backupAge = Date.now() - backup.metadata.timestamp;
    const daysSinceBackup = backupAge / (1000 * 60 * 60 * 24);
    if (daysSinceBackup > this.BACKUP_STALE_DAYS) {
      warnings.push(`Backup is ${Math.floor(daysSinceBackup)} days old. Some tokens may have changed.`);
    }

    // Convert to Token objects
    const tokens = backup.tokens.map(t => new LocalToken({
      id: t.id,
      name: t.type === "NFT" ? "NFT" : "Token",
      type: t.type,
      timestamp: backup.metadata.timestamp,
      jsonData: t.jsonData,
      status: TokenStatus.CONFIRMED,
      amount: t.amount,
      coinId: t.coinId,
      symbol: t.symbol,
      sizeBytes: t.jsonData.length,
    }));

    console.log(`📦 Backup restored: ${tokens.length} tokens from ${new Date(backup.metadata.timestamp).toISOString()}`);

    return { tokens, metadata: backup.metadata, warnings };
  }

  /**
   * Create a quick local backup in localStorage (encrypted)
   * Useful for automatic periodic backups
   */
  async createLocalBackup(
    tokens: LocalToken[],
    password: string,
    walletAddress: string
  ): Promise<void> {
    const { blob } = await this.createEncryptedBackup(tokens, password, walletAddress);
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = this.arrayBufferToBase64(arrayBuffer);

    localStorage.setItem(STORAGE_KEYS.ENCRYPTED_TOKEN_BACKUP, base64);
    console.log(`📦 Local backup saved to localStorage`);
  }

  /**
   * Restore from local backup in localStorage
   */
  async restoreFromLocalBackup(
    password: string
  ): Promise<{
    tokens: LocalToken[];
    metadata: BackupMetadata;
    warnings: string[];
  } | null> {
    const base64 = localStorage.getItem(STORAGE_KEYS.ENCRYPTED_TOKEN_BACKUP);
    if (!base64) {
      return null;
    }

    const arrayBuffer = this.base64ToArrayBuffer(base64);
    return this.restoreFromBackup(arrayBuffer, password);
  }

  /**
   * Check if backup is recommended (IPFS sync old or failed)
   * Call this on app startup to prompt user
   */
  checkBackupStatus(): BackupStatus {
    const lastBackup = localStorage.getItem(STORAGE_KEYS.TOKEN_BACKUP_TIMESTAMP);
    const lastSync = localStorage.getItem(STORAGE_KEYS.LAST_IPFS_SYNC_SUCCESS);

    const now = Date.now();
    const lastBackupTime = lastBackup ? parseInt(lastBackup, 10) : null;
    const lastSyncTime = lastSync ? parseInt(lastSync, 10) : null;

    const daysSinceBackup = lastBackupTime
      ? (now - lastBackupTime) / (1000 * 60 * 60 * 24)
      : null;

    const daysSinceSync = lastSyncTime
      ? (now - lastSyncTime) / (1000 * 60 * 60 * 24)
      : null;

    // Determine if backup is needed
    let needsBackup = false;
    let reason = "";

    if (!lastBackupTime) {
      needsBackup = true;
      reason = "No backup recorded. Create your first backup to protect your tokens!";
    } else if (daysSinceBackup !== null && daysSinceBackup > this.BACKUP_STALE_DAYS) {
      needsBackup = true;
      reason = `Last backup was ${Math.floor(daysSinceBackup)} days ago. Create a fresh backup!`;
    } else if (!lastSyncTime) {
      needsBackup = true;
      reason = "No IPFS sync recorded. Backup recommended to protect tokens.";
    } else if (daysSinceSync !== null && daysSinceSync > this.SYNC_WARNING_DAYS) {
      needsBackup = true;
      reason = `No IPFS sync in ${Math.floor(daysSinceSync)} days. Create a backup!`;
    }

    return {
      needsBackup,
      reason,
      lastBackupTime,
      daysSinceBackup,
      lastSyncTime,
      daysSinceSync,
    };
  }

  /**
   * Update the backup timestamp (called after successful backup)
   */
  updateBackupTimestamp(): void {
    localStorage.setItem(STORAGE_KEYS.TOKEN_BACKUP_TIMESTAMP, Date.now().toString());
  }

  /**
   * Update the sync timestamp (call after successful IPFS sync)
   */
  updateSyncTimestamp(): void {
    localStorage.setItem(STORAGE_KEYS.LAST_IPFS_SYNC_SUCCESS, Date.now().toString());
  }

  /**
   * Get a summary of what's in a backup without full decryption
   * Useful for showing backup info before restore
   */
  async getBackupInfo(
    encryptedData: ArrayBuffer,
    password: string
  ): Promise<BackupMetadata | null> {
    try {
      const decrypted = await this.decryptWithPassword(encryptedData, password);
      const backup = JSON.parse(decrypted) as TokenBackupData;
      return backup.metadata;
    } catch {
      return null;
    }
  }

  /**
   * Verify backup integrity without full restore
   */
  async verifyBackup(
    encryptedData: ArrayBuffer,
    password: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const decrypted = await this.decryptWithPassword(encryptedData, password);
      const backup = JSON.parse(decrypted) as TokenBackupData;

      // Verify checksum
      const calculatedChecksum = await this.calculateChecksum(JSON.stringify(backup.tokens));
      if (calculatedChecksum !== backup.metadata.checksum) {
        return { valid: false, error: "Checksum mismatch" };
      }

      // Verify each token has valid TXF structure
      for (const tokenData of backup.tokens) {
        try {
          const txf = JSON.parse(tokenData.jsonData) as TxfToken;
          if (!txf.genesis || !txf.state) {
            return { valid: false, error: `Token ${tokenData.id} has invalid structure` };
          }
        } catch {
          return { valid: false, error: `Token ${tokenData.id} has invalid JSON` };
        }
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Export backup with human-readable filename
   */
  getBackupFilename(walletAddress: string): string {
    const date = new Date().toISOString().split("T")[0];
    const shortAddr = walletAddress.slice(0, 8);
    return `unicity-tokens-backup-${shortAddr}-${date}.enc`;
  }

  // ==========================================
  // Encryption/Decryption (AES-256-GCM with PBKDF2)
  // ==========================================

  private async encryptWithPassword(data: string, password: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();

    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key from password using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );

    // Encrypt the data
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(data)
    );

    // Combine salt + iv + encrypted data
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    return result.buffer;
  }

  private async decryptWithPassword(data: ArrayBuffer, password: string): Promise<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const dataArray = new Uint8Array(data);

    // Extract salt, IV, and encrypted data
    const salt = dataArray.slice(0, 16);
    const iv = dataArray.slice(16, 28);
    const encrypted = dataArray.slice(28);

    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    return decoder.decode(decrypted);
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  private async calculateChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// ==========================================
// Singleton Export
// ==========================================

/**
 * Get singleton instance of TokenBackupService
 */
export function getTokenBackupService(): TokenBackupService {
  return TokenBackupService.getInstance();
}
