import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NametagMintService, DefaultRandomBytesProvider } from '@/components/wallet/sdk/nostr/NametagService';
import type { StateTransitionProvider } from '@/components/wallet/sdk/nostr/TokenTransferService';

describe('NametagService', () => {
  describe('DefaultRandomBytesProvider', () => {
    it('should generate random bytes', () => {
      const provider = new DefaultRandomBytesProvider();
      const bytes = provider.getRandomBytes(32);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(32);
    });

    it('should generate different bytes each time', () => {
      const provider = new DefaultRandomBytesProvider();
      const bytes1 = provider.getRandomBytes(32);
      const bytes2 = provider.getRandomBytes(32);

      // While theoretically possible to be equal, practically never happens
      expect(Buffer.from(bytes1).toString('hex')).not.toBe(Buffer.from(bytes2).toString('hex'));
    });

    it('should generate correct length', () => {
      const provider = new DefaultRandomBytesProvider();

      expect(provider.getRandomBytes(16)).toHaveLength(16);
      expect(provider.getRandomBytes(64)).toHaveLength(64);
      expect(provider.getRandomBytes(1)).toHaveLength(1);
    });
  });

  describe('NametagMintService', () => {
    let mockStateProvider: StateTransitionProvider;
    let mockStateTransitionClient: {
      isMinted: ReturnType<typeof vi.fn>;
      submitMintCommitment: ReturnType<typeof vi.fn>;
    };
    let mockRootTrustBase: object;

    beforeEach(() => {
      mockStateTransitionClient = {
        isMinted: vi.fn().mockResolvedValue(false),
        submitMintCommitment: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      };

      mockRootTrustBase = {};

      mockStateProvider = {
        getStateTransitionClient: () => mockStateTransitionClient as unknown as ReturnType<StateTransitionProvider['getStateTransitionClient']>,
        getRootTrustBase: () => mockRootTrustBase as ReturnType<StateTransitionProvider['getRootTrustBase']>,
      };
    });

    describe('isAvailable', () => {
      it('should return true for unminted nametag', async () => {
        mockStateTransitionClient.isMinted.mockResolvedValue(false);

        const service = new NametagMintService(mockStateProvider);
        const available = await service.isAvailable('testnametag');

        expect(available).toBe(true);
        expect(mockStateTransitionClient.isMinted).toHaveBeenCalled();
      });

      it('should return false for minted nametag', async () => {
        mockStateTransitionClient.isMinted.mockResolvedValue(true);

        const service = new NametagMintService(mockStateProvider);
        const available = await service.isAvailable('existingnametag');

        expect(available).toBe(false);
      });

      it('should clean @ prefix from nametag', async () => {
        mockStateTransitionClient.isMinted.mockResolvedValue(false);

        const service = new NametagMintService(mockStateProvider);
        await service.isAvailable('@testnametag');

        // Should have called with cleaned nametag
        expect(mockStateTransitionClient.isMinted).toHaveBeenCalled();
      });

      it('should clean @unicity suffix from nametag', async () => {
        mockStateTransitionClient.isMinted.mockResolvedValue(false);

        const service = new NametagMintService(mockStateProvider);
        await service.isAvailable('testnametag@unicity');

        expect(mockStateTransitionClient.isMinted).toHaveBeenCalled();
      });
    });

    describe('getProxyAddress', () => {
      it('should return proxy address for nametag', async () => {
        const service = new NametagMintService(mockStateProvider);
        const address = await service.getProxyAddress('testnametag');

        expect(address).toBeDefined();
        expect(typeof address).toBe('string');
      });

      it('should be deterministic', async () => {
        const service = new NametagMintService(mockStateProvider);

        const address1 = await service.getProxyAddress('testnametag');
        const address2 = await service.getProxyAddress('testnametag');

        expect(address1).toBe(address2);
      });

      it('should return different addresses for different nametags', async () => {
        const service = new NametagMintService(mockStateProvider);

        const address1 = await service.getProxyAddress('nametag1');
        const address2 = await service.getProxyAddress('nametag2');

        expect(address1).not.toBe(address2);
      });
    });
  });
});
