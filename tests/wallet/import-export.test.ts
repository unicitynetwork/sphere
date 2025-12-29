import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Wallet Import/Export Tests
 *
 * Test fixtures naming convention:
 *   name_enc_PASSWORD.dat  - encrypted .dat with password PASSWORD
 *   name.dat               - unencrypted .dat
 *   name_enc_PASSWORD.txt  - encrypted .txt backup
 *   name.txt               - unencrypted .txt backup
 *   name_enc_PASSWORD.json - encrypted .json backup
 *   name.json              - unencrypted .json backup
 */

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface ParsedFilename {
  name: string;
  password: string | null;
  ext: string;
  encrypted: boolean;
}

interface CMasterKeyData {
  pos: number;
  encryptedKey: Buffer;
  salt: Buffer;
  iterations: number;
}

// Parse filename to extract password
function parseFilename(filename: string): ParsedFilename | null {
  const base = path.basename(filename);
  const encMatch = base.match(/^(.+)_enc_(.+)\.(dat|txt|json)$/);
  if (encMatch) {
    return { name: encMatch[1], password: encMatch[2], ext: encMatch[3], encrypted: true };
  }
  const simpleMatch = base.match(/^(.+)\.(dat|txt|json)$/);
  if (simpleMatch) {
    return { name: simpleMatch[1], password: null, ext: simpleMatch[2], encrypted: false };
  }
  return null;
}

// Find all CMasterKey structures in wallet.dat
function findAllCMasterKeys(data: Buffer): CMasterKeyData[] {
  const results: CMasterKeyData[] = [];
  for (let pos = 0; pos < data.length - 70; pos++) {
    if (data[pos] === 0x30) { // 48 = encrypted key length
      const saltLenPos = pos + 1 + 48;
      if (saltLenPos < data.length && data[saltLenPos] === 0x08) { // 8 = salt length
        const iterPos = saltLenPos + 1 + 8 + 4;
        if (iterPos + 4 <= data.length) {
          const iterations = data.readUInt32LE(iterPos);
          if (iterations >= 1000 && iterations <= 10000000) {
            results.push({
              pos,
              encryptedKey: data.slice(pos + 1, pos + 1 + 48),
              salt: data.slice(saltLenPos + 1, saltLenPos + 1 + 8),
              iterations
            });
          }
        }
      }
    }
  }
  return results;
}

// Decrypt master key using Bitcoin Core's iterative SHA512 method
function decryptMasterKey(encryptedKey: Buffer, salt: Buffer, iterations: number, password: string): string | null {
  const passwordBytes = Buffer.from(password, 'utf8');
  const inputBuf = Buffer.concat([passwordBytes, salt]);

  let hash = crypto.createHash('sha512').update(inputBuf).digest();
  for (let i = 0; i < iterations - 1; i++) {
    hash = crypto.createHash('sha512').update(hash).digest();
  }

  const key = hash.slice(0, 32);
  const iv = hash.slice(32, 48);

  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedKey),
      decipher.final()
    ]);
    return decrypted.toString('hex');
  } catch {
    return null;
  }
}

// Get all test fixtures
function getTestFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    return [];
  }
  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => /\.(dat|txt|json)$/.test(f))
    .map(f => path.join(FIXTURES_DIR, f));
}

describe('Wallet Import/Export', () => {
  beforeAll(() => {
    // Ensure fixtures directory exists
    getTestFixtures();
  });

  describe('Encrypted .dat wallet files', () => {
    it('should decrypt test_enc_UnicityHuicit1.dat with correct password', () => {
      const filePath = path.join(FIXTURES_DIR, 'test_enc_UnicityHuicit1.dat');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const data = fs.readFileSync(filePath);

      // Verify SQLite header
      const header = data.slice(0, 16).toString('utf8');
      expect(header.startsWith('SQLite format 3')).toBe(true);

      // Find CMasterKey structures
      const cmasterKeys = findAllCMasterKeys(data);
      expect(cmasterKeys.length).toBeGreaterThan(0);

      // Try to decrypt with password from filename
      const parsed = parseFilename(filePath);
      expect(parsed).not.toBeNull();
      expect(parsed!.password).toBe('UnicityHuicit1');

      let masterKey: string | null = null;
      for (const cmk of cmasterKeys) {
        masterKey = decryptMasterKey(cmk.encryptedKey, cmk.salt, cmk.iterations, parsed!.password!);
        if (masterKey && masterKey.length === 64) {
          break;
        }
      }

      expect(masterKey).not.toBeNull();
      expect(masterKey!.length).toBe(64);
      // Expected master key (first 16 chars)
      expect(masterKey!.startsWith('cf2e27f927fb1652')).toBe(true);
    });

    it('should fail with wrong password', () => {
      const filePath = path.join(FIXTURES_DIR, 'test_enc_UnicityHuicit1.dat');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const data = fs.readFileSync(filePath);
      const cmasterKeys = findAllCMasterKeys(data);

      let masterKey: string | null = null;
      for (const cmk of cmasterKeys) {
        masterKey = decryptMasterKey(cmk.encryptedKey, cmk.salt, cmk.iterations, 'wrongpassword');
        if (masterKey && masterKey.length === 64) {
          break;
        }
      }

      // Should fail - either null or wrong length
      expect(masterKey === null || masterKey.length !== 64).toBe(true);
    });
  });

  describe('Unencrypted .dat wallet files', () => {
    it('should detect unencrypted wallet (no CMasterKey)', () => {
      const filePath = path.join(FIXTURES_DIR, 'test_wallet.dat');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const data = fs.readFileSync(filePath);

      // Verify SQLite header
      const header = data.slice(0, 16).toString('utf8');
      expect(header.startsWith('SQLite format 3')).toBe(true);

      // Should have no CMasterKey (unencrypted)
      const cmasterKeys = findAllCMasterKeys(data);
      expect(cmasterKeys.length).toBe(0);
    });
  });

  describe('JSON wallet files', () => {
    it('should parse unencrypted JSON wallet', () => {
      const filePath = path.join(FIXTURES_DIR, 'test.json');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.masterPrivateKey).toBeDefined();
      expect(content.masterPrivateKey.length).toBe(64);
    });

    it('should detect encrypted JSON wallet', () => {
      const filePath = path.join(FIXTURES_DIR, 'test_enc_1111.json');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Encrypted JSON should have 'encrypted' field
      expect(content.encrypted).toBeDefined();
    });
  });

  describe('TXT wallet backup files', () => {
    it('should detect encrypted TXT backup', () => {
      const filePath = path.join(FIXTURES_DIR, 'test1_enc_1111.txt');
      if (!fs.existsSync(filePath)) {
        console.log('Skipping: fixture not found');
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');

      // Encrypted TXT should contain 'ENCRYPTED MASTER KEY'
      expect(content.includes('ENCRYPTED MASTER KEY')).toBe(true);
    });
  });

  describe('Filename parsing', () => {
    it('should parse encrypted .dat filename', () => {
      const parsed = parseFilename('test_enc_mypassword123.dat');
      expect(parsed).toEqual({
        name: 'test',
        password: 'mypassword123',
        ext: 'dat',
        encrypted: true
      });
    });

    it('should parse unencrypted .dat filename', () => {
      const parsed = parseFilename('wallet.dat');
      expect(parsed).toEqual({
        name: 'wallet',
        password: null,
        ext: 'dat',
        encrypted: false
      });
    });

    it('should parse encrypted .json filename', () => {
      const parsed = parseFilename('backup_enc_secret.json');
      expect(parsed).toEqual({
        name: 'backup',
        password: 'secret',
        ext: 'json',
        encrypted: true
      });
    });
  });
});
