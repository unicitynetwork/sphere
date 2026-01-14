import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOSTR_RELAYS,
  InMemoryNostrStorage,
} from '@/components/wallet/sdk/nostr/types';

describe('nostr types', () => {
  describe('DEFAULT_NOSTR_RELAYS', () => {
    it('should export default relay URLs', () => {
      expect(DEFAULT_NOSTR_RELAYS).toBeDefined();
      expect(Array.isArray(DEFAULT_NOSTR_RELAYS)).toBe(true);
      expect(DEFAULT_NOSTR_RELAYS.length).toBeGreaterThan(0);
    });

    it('should have valid WSS URLs', () => {
      for (const relay of DEFAULT_NOSTR_RELAYS) {
        expect(relay.startsWith('wss://')).toBe(true);
      }
    });
  });

  describe('InMemoryNostrStorage', () => {
    it('should store and retrieve values', async () => {
      const storage = new InMemoryNostrStorage();

      await storage.set('key1', 'value1');
      const result = await storage.get('key1');

      expect(result).toBe('value1');
    });

    it('should return null for missing keys', async () => {
      const storage = new InMemoryNostrStorage();

      const result = await storage.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should overwrite existing values', async () => {
      const storage = new InMemoryNostrStorage();

      await storage.set('key', 'value1');
      await storage.set('key', 'value2');

      const result = await storage.get('key');
      expect(result).toBe('value2');
    });

    it('should remove values', async () => {
      const storage = new InMemoryNostrStorage();

      await storage.set('key', 'value');
      await storage.remove('key');

      const result = await storage.get('key');
      expect(result).toBeNull();
    });

    it('should handle multiple keys', async () => {
      const storage = new InMemoryNostrStorage();

      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');
      await storage.set('key3', 'value3');

      expect(await storage.get('key1')).toBe('value1');
      expect(await storage.get('key2')).toBe('value2');
      expect(await storage.get('key3')).toBe('value3');
    });

    it('should not throw on removing nonexistent key', async () => {
      const storage = new InMemoryNostrStorage();

      await expect(storage.remove('nonexistent')).resolves.toBeUndefined();
    });
  });
});
