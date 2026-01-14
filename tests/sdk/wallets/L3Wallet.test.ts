import { describe, it, expect } from 'vitest';
import { L3Wallet } from '@/components/wallet/sdk/wallets/L3Wallet';

describe('L3Wallet', () => {
  const testPrivateKey = '0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d';

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const wallet = new L3Wallet();
      expect(wallet).toBeDefined();
    });

    it('should accept custom config', () => {
      const wallet = new L3Wallet({
        aggregatorUrl: 'https://custom.aggregator.url',
        apiKey: 'custom_api_key',
      });

      expect(wallet).toBeDefined();
      expect(wallet.getAggregatorUrl()).toBe('https://custom.aggregator.url');
    });
  });

  describe('createIdentity', () => {
    it('should create identity from private key', async () => {
      const wallet = new L3Wallet();
      const identity = await wallet.createIdentity(testPrivateKey);

      expect(identity).toBeDefined();
      expect(identity.privateKey).toBe(testPrivateKey);
      expect(identity.publicKey).toBeDefined();
      expect(identity.address).toBeDefined();
      expect(identity.signingService).toBeDefined();
    });

    it('should be deterministic', async () => {
      const wallet = new L3Wallet();

      const identity1 = await wallet.createIdentity(testPrivateKey);
      const identity2 = await wallet.createIdentity(testPrivateKey);

      expect(identity1.publicKey).toBe(identity2.publicKey);
      expect(identity1.address).toBe(identity2.address);
    });

    it('should create different identities for different keys', async () => {
      const wallet = new L3Wallet();
      const key2 = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';

      const identity1 = await wallet.createIdentity(testPrivateKey);
      const identity2 = await wallet.createIdentity(key2);

      expect(identity1.address).not.toBe(identity2.address);
    });
  });

  describe('deriveAddress', () => {
    it('should derive address from private key', async () => {
      const wallet = new L3Wallet();
      const address = await wallet.deriveAddress(testPrivateKey);

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
    });

    it('should match identity address', async () => {
      const wallet = new L3Wallet();

      const address = await wallet.deriveAddress(testPrivateKey);
      const identity = await wallet.createIdentity(testPrivateKey);

      expect(address).toBe(identity.address);
    });
  });

  describe('getAggregatorClient', () => {
    it('should return aggregator client', () => {
      const wallet = new L3Wallet();
      const client = wallet.getAggregatorClient();

      expect(client).toBeDefined();
    });
  });

  describe('getStateTransitionClient', () => {
    it('should return state transition client', () => {
      const wallet = new L3Wallet();
      const client = wallet.getStateTransitionClient();

      expect(client).toBeDefined();
    });
  });

  describe('getTokenType', () => {
    it('should return token type', () => {
      const wallet = new L3Wallet();
      const tokenType = wallet.getTokenType();

      expect(tokenType).toBeDefined();
    });
  });

  describe('getAggregatorUrl', () => {
    it('should return default aggregator URL', () => {
      const wallet = new L3Wallet();
      const url = wallet.getAggregatorUrl();

      expect(url).toBe('https://goggregator-test.unicity.network');
    });

    it('should return custom aggregator URL', () => {
      const customUrl = 'https://custom.aggregator.url';
      const wallet = new L3Wallet({ aggregatorUrl: customUrl });

      expect(wallet.getAggregatorUrl()).toBe(customUrl);
    });
  });
});
