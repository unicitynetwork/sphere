import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageProvider,
  createLocalStorageProvider,
  InMemoryProvider,
  createInMemoryProvider,
  PROVIDER_IDS,
} from '../../../src/components/wallet/sdk/storage/providers';

// ==========================================
// LocalStorageProvider Tests
// ==========================================

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  let mockStorage: Storage;

  beforeEach(() => {
    // Create mock storage
    const data = new Map<string, string>();
    mockStorage = {
      get length() { return data.size; },
      clear() { data.clear(); },
      getItem(key: string) { return data.get(key) ?? null; },
      key(index: number) { return Array.from(data.keys())[index] ?? null; },
      removeItem(key: string) { data.delete(key); },
      setItem(key: string, value: string) { data.set(key, value); },
    };

    provider = new LocalStorageProvider({ storage: mockStorage });
  });

  describe('metadata', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe(PROVIDER_IDS.LOCAL_STORAGE);
    });

    it('should have correct type', () => {
      expect(provider.type).toBe('local');
    });

    it('should have name and description', () => {
      expect(provider.name).toBe('Browser Storage');
      expect(provider.description).toBeTruthy();
    });
  });

  describe('lifecycle', () => {
    it('should start disconnected', () => {
      expect(provider.isConnected()).toBe(false);
      expect(provider.getStatus()).toBe('disconnected');
    });

    it('should connect successfully', async () => {
      await provider.connect();
      expect(provider.isConnected()).toBe(true);
      expect(provider.getStatus()).toBe('connected');
    });

    it('should disconnect', async () => {
      await provider.connect();
      await provider.disconnect();
      expect(provider.isConnected()).toBe(false);
      expect(provider.getStatus()).toBe('disconnected');
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should set and get value', async () => {
      await provider.set('key1', 'value1');
      const value = await provider.get('key1');
      expect(value).toBe('value1');
    });

    it('should return null for non-existent key', async () => {
      const value = await provider.get('non-existent');
      expect(value).toBeNull();
    });

    it('should check if key exists', async () => {
      await provider.set('key1', 'value1');
      expect(await provider.has('key1')).toBe(true);
      expect(await provider.has('non-existent')).toBe(false);
    });

    it('should remove key', async () => {
      await provider.set('key1', 'value1');
      await provider.remove('key1');
      expect(await provider.get('key1')).toBeNull();
    });

    it('should list keys', async () => {
      await provider.set('key1', 'value1');
      await provider.set('key2', 'value2');
      const keys = await provider.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should list keys with prefix', async () => {
      await provider.set('user_1', 'alice');
      await provider.set('user_2', 'bob');
      await provider.set('other', 'data');
      const keys = await provider.keys('user_');
      expect(keys).toHaveLength(2);
      expect(keys).toContain('user_1');
      expect(keys).toContain('user_2');
    });

    it('should clear all keys', async () => {
      await provider.set('key1', 'value1');
      await provider.set('key2', 'value2');
      await provider.clear();
      expect(await provider.keys()).toHaveLength(0);
    });

    it('should clear keys with prefix', async () => {
      await provider.set('user_1', 'alice');
      await provider.set('user_2', 'bob');
      await provider.set('other', 'data');
      await provider.clear('user_');
      const keys = await provider.keys();
      expect(keys).toHaveLength(1);
      expect(keys).toContain('other');
    });
  });

  describe('prefix handling', () => {
    it('should apply prefix to keys', async () => {
      const prefixedProvider = new LocalStorageProvider({
        storage: mockStorage,
        prefix: 'app_',
      });
      await prefixedProvider.connect();

      await prefixedProvider.set('key1', 'value1');

      // Direct storage access should show prefixed key
      expect(mockStorage.getItem('app_key1')).toBe('value1');

      // Provider should return unprefixed key
      const keys = await prefixedProvider.keys();
      expect(keys).toContain('key1');
    });
  });

  describe('factory function', () => {
    it('should create provider with createLocalStorageProvider', () => {
      const created = createLocalStorageProvider({ storage: mockStorage });
      expect(created).toBeInstanceOf(LocalStorageProvider);
    });
  });
});

// ==========================================
// InMemoryProvider Tests
// ==========================================

describe('InMemoryProvider', () => {
  let provider: InMemoryProvider;

  beforeEach(() => {
    provider = new InMemoryProvider();
  });

  describe('metadata', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe(PROVIDER_IDS.IN_MEMORY);
    });

    it('should have correct type', () => {
      expect(provider.type).toBe('local');
    });
  });

  describe('lifecycle', () => {
    it('should start disconnected', () => {
      expect(provider.isConnected()).toBe(false);
    });

    it('should connect and disconnect', async () => {
      await provider.connect();
      expect(provider.isConnected()).toBe(true);

      await provider.disconnect();
      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should set and get value', async () => {
      await provider.set('key1', 'value1');
      expect(await provider.get('key1')).toBe('value1');
    });

    it('should return null for non-existent key', async () => {
      expect(await provider.get('missing')).toBeNull();
    });

    it('should check existence', async () => {
      await provider.set('key1', 'value1');
      expect(await provider.has('key1')).toBe(true);
      expect(await provider.has('missing')).toBe(false);
    });

    it('should remove key', async () => {
      await provider.set('key1', 'value1');
      await provider.remove('key1');
      expect(await provider.has('key1')).toBe(false);
    });

    it('should list and clear keys', async () => {
      await provider.set('a', '1');
      await provider.set('b', '2');
      expect(await provider.keys()).toHaveLength(2);

      await provider.clear();
      expect(await provider.keys()).toHaveLength(0);
    });
  });

  describe('initial data', () => {
    it('should populate initial data', async () => {
      const providerWithData = new InMemoryProvider({
        initialData: { key1: 'value1', key2: 'value2' },
      });
      await providerWithData.connect();

      expect(await providerWithData.get('key1')).toBe('value1');
      expect(await providerWithData.get('key2')).toBe('value2');
    });
  });

  describe('testing helpers', () => {
    it('should return all data', async () => {
      await provider.connect();
      await provider.set('a', '1');
      await provider.set('b', '2');

      const allData = provider.getAllData();
      expect(allData).toEqual({ a: '1', b: '2' });
    });

    it('should return size', async () => {
      await provider.connect();
      expect(provider.size()).toBe(0);

      await provider.set('a', '1');
      expect(provider.size()).toBe(1);
    });

    it('should reset storage', async () => {
      await provider.connect();
      await provider.set('a', '1');

      provider.reset();
      expect(provider.size()).toBe(0);
    });
  });

  describe('prefix handling', () => {
    it('should apply prefix', async () => {
      const prefixedProvider = new InMemoryProvider({ prefix: 'test_' });
      await prefixedProvider.connect();

      await prefixedProvider.set('key', 'value');

      // getAllData shows internal prefixed keys
      const data = prefixedProvider.getAllData();
      expect(data['test_key']).toBe('value');

      // keys() returns unprefixed
      const keys = await prefixedProvider.keys();
      expect(keys).toContain('key');
    });
  });

  describe('factory function', () => {
    it('should create provider with createInMemoryProvider', () => {
      const created = createInMemoryProvider();
      expect(created).toBeInstanceOf(InMemoryProvider);
    });
  });
});
