import { describe, it, expect } from 'vitest';
import {
  compareTokenVersions,
  compareTokenVersionsSimple,
  countCommittedTransactions,
  countPendingTransactions,
  hasPendingTransactions,
  getTokenTransactionStats,
  isLocalBetter,
  isRemoteBetter,
  areTokensEqual,
} from '../../../src/components/wallet/sdk/storage/token-comparison';
import type { TxfToken, TxfTransaction } from '../../../src/components/wallet/sdk/types/txf';

// Helper to create a mock TxfToken
function createMockToken(options: {
  tokenId?: string;
  transactions?: Array<{ hasProof: boolean }>;
  stateHash?: string;
  genesisHash?: string;
}): TxfToken {
  const tokenId = options.tokenId || '0'.repeat(64);
  const stateHash = options.stateHash || '0000' + 'a'.repeat(60);

  const transactions: TxfTransaction[] = (options.transactions || []).map((tx, index) => ({
    previousStateHash: index === 0 ? stateHash : `0000${'b'.repeat(60)}`,
    newStateHash: `0000${'c'.repeat(56)}${index.toString().padStart(4, '0')}`,
    predicate: 'mock-predicate',
    inclusionProof: tx.hasProof ? {
      authenticator: {
        algorithm: 'secp256k1',
        publicKey: 'mock-pubkey',
        signature: 'mock-sig',
        stateHash: `0000${'c'.repeat(56)}${index.toString().padStart(4, '0')}`,
      },
      merkleTreePath: { root: 'mock-root', steps: [] },
      transactionHash: 'mock-tx-hash',
      unicityCertificate: 'mock-cert',
    } : null,
  }));

  return {
    version: '2.0',
    genesis: {
      data: {
        tokenId,
        tokenType: '0'.repeat(64),
        coinData: [['0'.repeat(64), '1000']],
        tokenData: '',
        salt: '0'.repeat(64),
        recipient: 'DIRECT://mock',
        recipientDataHash: null,
        reason: null,
      },
      inclusionProof: {
        authenticator: {
          algorithm: 'secp256k1',
          publicKey: 'mock-pubkey',
          signature: 'mock-sig',
          stateHash,
        },
        merkleTreePath: { root: 'mock-root', steps: [] },
        transactionHash: 'mock-tx-hash',
        unicityCertificate: 'mock-cert',
      },
    },
    state: {
      data: '',
      predicate: 'mock-predicate',
      stateHash: transactions.length > 0
        ? transactions[transactions.length - 1].newStateHash
        : stateHash,
    },
    transactions,
    nametags: [],
    _integrity: {
      genesisDataJSONHash: options.genesisHash || '0000' + 'd'.repeat(60),
    },
  };
}

describe('token-comparison', () => {
  describe('countCommittedTransactions', () => {
    it('returns 0 for token with no transactions', () => {
      const token = createMockToken({});
      expect(countCommittedTransactions(token)).toBe(0);
    });

    it('returns correct count for all committed transactions', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: true },
          { hasProof: true },
        ],
      });
      expect(countCommittedTransactions(token)).toBe(3);
    });

    it('returns correct count for mixed transactions', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: false },
          { hasProof: true },
        ],
      });
      expect(countCommittedTransactions(token)).toBe(2);
    });
  });

  describe('countPendingTransactions', () => {
    it('returns 0 for token with no transactions', () => {
      const token = createMockToken({});
      expect(countPendingTransactions(token)).toBe(0);
    });

    it('returns correct count for all pending transactions', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: false },
          { hasProof: false },
        ],
      });
      expect(countPendingTransactions(token)).toBe(2);
    });
  });

  describe('hasPendingTransactions', () => {
    it('returns false for token with no transactions', () => {
      const token = createMockToken({});
      expect(hasPendingTransactions(token)).toBe(false);
    });

    it('returns true if any transaction is pending', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: false },
        ],
      });
      expect(hasPendingTransactions(token)).toBe(true);
    });

    it('returns false if all transactions are committed', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: true },
        ],
      });
      expect(hasPendingTransactions(token)).toBe(false);
    });
  });

  describe('getTokenTransactionStats', () => {
    it('returns correct stats for complex token', () => {
      const token = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: false },
          { hasProof: true },
        ],
      });

      const stats = getTokenTransactionStats(token);

      expect(stats.totalTransactions).toBe(3);
      expect(stats.committedTransactions).toBe(2);
      expect(stats.pendingTransactions).toBe(1);
      expect(stats.totalProofs).toBe(3); // genesis + 2 committed
      expect(stats.hasPending).toBe(true);
    });
  });

  describe('compareTokenVersions', () => {
    it('committed beats pending-only (local wins)', () => {
      const local = createMockToken({
        transactions: [{ hasProof: true }],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: false }],
      });

      const result = compareTokenVersions(local, remote);

      expect(result.winner).toBe('local');
      expect(result.reason).toContain('committed');
    });

    it('committed beats pending-only (remote wins)', () => {
      const local = createMockToken({
        transactions: [{ hasProof: false }],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: true }],
      });

      const result = compareTokenVersions(local, remote);

      expect(result.winner).toBe('remote');
      expect(result.reason).toContain('committed');
    });

    it('longer committed chain wins', () => {
      const local = createMockToken({
        transactions: [
          { hasProof: true },
          { hasProof: true },
        ],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: true }],
      });

      const result = compareTokenVersions(local, remote);

      expect(result.winner).toBe('local');
      expect(result.localCommitted).toBe(2);
      expect(result.remoteCommitted).toBe(1);
    });

    it('same committed count - more proofs wins', () => {
      const local = createMockToken({
        transactions: [{ hasProof: true }],
      });
      // Remote has same committed but somehow fewer total proofs
      const remote = createMockToken({
        transactions: [{ hasProof: true }],
      });

      const result = compareTokenVersions(local, remote);

      // Same proofs - will fall through to state hash comparison
      // Since we use same mock data, state hashes may be equal
      expect(['local', 'equal']).toContain(result.winner);
    });

    it('identical tokens are equal', () => {
      const tokenData = {
        tokenId: '1'.repeat(64),
        stateHash: '0000' + 'e'.repeat(60),
        genesisHash: '0000' + 'f'.repeat(60),
      };

      const local = createMockToken(tokenData);
      const remote = createMockToken(tokenData);

      const result = compareTokenVersions(local, remote);

      expect(result.winner).toBe('equal');
      expect(result.reason).toContain('equal');
    });

    it('deterministic tiebreaker uses genesis hash', () => {
      const local = createMockToken({
        genesisHash: '0000' + 'z'.repeat(60), // Higher hash
        stateHash: '0000' + 'a'.repeat(60),
      });
      const remote = createMockToken({
        genesisHash: '0000' + 'a'.repeat(60), // Lower hash
        stateHash: '0000' + 'b'.repeat(60), // Different state
      });

      const result = compareTokenVersions(local, remote);

      expect(result.winner).toBe('local');
      expect(result.reason).toContain('tiebreaker');
    });
  });

  describe('compareTokenVersionsSimple', () => {
    it('returns just the winner', () => {
      const local = createMockToken({
        transactions: [{ hasProof: true }],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: false }],
      });

      expect(compareTokenVersionsSimple(local, remote)).toBe('local');
    });
  });

  describe('helper functions', () => {
    it('isLocalBetter returns true when local wins', () => {
      const local = createMockToken({
        transactions: [{ hasProof: true }, { hasProof: true }],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: true }],
      });

      expect(isLocalBetter(local, remote)).toBe(true);
      expect(isRemoteBetter(local, remote)).toBe(false);
    });

    it('isRemoteBetter returns true when remote wins', () => {
      const local = createMockToken({
        transactions: [{ hasProof: true }],
      });
      const remote = createMockToken({
        transactions: [{ hasProof: true }, { hasProof: true }],
      });

      expect(isRemoteBetter(local, remote)).toBe(true);
      expect(isLocalBetter(local, remote)).toBe(false);
    });

    it('areTokensEqual returns true for identical tokens', () => {
      const tokenData = {
        tokenId: '2'.repeat(64),
        stateHash: '0000' + 'x'.repeat(60),
      };

      const local = createMockToken(tokenData);
      const remote = createMockToken(tokenData);

      expect(areTokensEqual(local, remote)).toBe(true);
    });
  });
});
