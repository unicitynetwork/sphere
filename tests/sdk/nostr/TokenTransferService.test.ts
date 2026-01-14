import { describe, it, expect } from 'vitest';
import { createTokenTransferPayload } from '@/components/wallet/sdk/nostr/TokenTransferService';

// Mock the state-transition-sdk types
const mockToken = {
  id: { toString: () => 'token-id-123' },
  type: { bytes: Buffer.from('01', 'hex') },
  coins: null,
  toJSON: () => ({
    id: 'token-id-123',
    type: '01',
    state: {},
  }),
};

const mockTransferTx = {
  data: {
    recipient: { scheme: 1, address: 'recipient-addr' },
    salt: Buffer.from('00'.repeat(32), 'hex'),
  },
  toJSON: () => ({
    data: {
      recipient: 'recipient-addr',
      salt: '00'.repeat(32),
    },
  }),
};

describe('TokenTransferService', () => {
  describe('createTokenTransferPayload', () => {
    it('should create JSON payload from token and tx', () => {
      // @ts-expect-error - using mock objects
      const payload = createTokenTransferPayload(mockToken, mockTransferTx);

      expect(payload).toBeDefined();
      expect(typeof payload).toBe('string');

      const parsed = JSON.parse(payload);
      expect(parsed.sourceToken).toBeDefined();
      expect(parsed.transferTx).toBeDefined();
    });

    it('should produce valid JSON', () => {
      // @ts-expect-error - using mock objects
      const payload = createTokenTransferPayload(mockToken, mockTransferTx);

      expect(() => JSON.parse(payload)).not.toThrow();
    });
  });
});
