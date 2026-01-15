/**
 * Tests for TXF Token Validation
 *
 * Tests pure validation functions for TXF token structure and content.
 */

import { describe, it, expect } from 'vitest';
import {
  hasValidTxfStructure,
  hasValidGenesis,
  hasValidState,
  getUncommittedTransactions,
  getCommittedTransactions,
  hasUncommittedTxs,
  getTransactionAtIndex,
  getPreviousStateHash,
  getCurrentState,
  isSplitToken,
  extractBurnTxHash,
  getValidationSummary,
} from '../../../src/components/wallet/sdk/validation/txf-validation';
import type { TxfToken, TxfTransaction } from '../../../src/components/wallet/sdk/types/txf';

// Helper to create a minimal valid TXF token
const createMinimalToken = (): TxfToken => ({
  version: '2.0',
  genesis: {
    data: {
      tokenId: 'a'.repeat(64),
      tokenType: 'b'.repeat(64),
      coinData: [],
      tokenData: '',
      salt: 'c'.repeat(64),
      recipient: '',
      recipientDataHash: null,
      reason: null,
    },
    inclusionProof: {
      authenticator: {
        algorithm: 'secp256k1',
        publicKey: '',
        signature: '',
        stateHash: 'genesis_state_hash',
      },
      merkleTreePath: { root: '', steps: [] },
      transactionHash: '',
      unicityCertificate: '',
    },
  },
  state: {
    data: '',
    predicate: '',
    stateHash: 'current_state_hash',
  },
  transactions: [],
  nametags: [],
  _integrity: { genesisDataJSONHash: '' },
});

// Helper to create a transaction
const createTransaction = (opts: {
  previousStateHash: string;
  newStateHash: string;
  committed?: boolean;
}): TxfTransaction => ({
  previousStateHash: opts.previousStateHash,
  newStateHash: opts.newStateHash,
  predicate: '',
  inclusionProof: opts.committed
    ? {
        authenticator: {
          algorithm: '',
          publicKey: '',
          signature: '',
          stateHash: opts.newStateHash,
        },
        merkleTreePath: { root: '', steps: [] },
        transactionHash: '',
        unicityCertificate: '',
      }
    : null,
});

describe('TXF Validation', () => {
  describe('hasValidTxfStructure', () => {
    it('should return true for valid token structure', () => {
      const token = createMinimalToken();
      expect(hasValidTxfStructure(token)).toBe(true);
    });

    it('should return false for null', () => {
      expect(hasValidTxfStructure(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(hasValidTxfStructure(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(hasValidTxfStructure('string')).toBe(false);
      expect(hasValidTxfStructure(123)).toBe(false);
    });

    it('should return false for missing genesis', () => {
      expect(hasValidTxfStructure({ state: {} })).toBe(false);
    });

    it('should return false for missing state', () => {
      expect(hasValidTxfStructure({ genesis: {} })).toBe(false);
    });
  });

  describe('hasValidGenesis', () => {
    it('should return true for valid genesis', () => {
      const token = createMinimalToken();
      expect(hasValidGenesis(token)).toBe(true);
    });

    it('should return false for missing tokenId', () => {
      const token = createMinimalToken();
      // @ts-expect-error - testing invalid state
      token.genesis.data.tokenId = undefined;
      expect(hasValidGenesis(token)).toBe(false);
    });

    it('should return false for missing inclusionProof', () => {
      const token = createMinimalToken();
      // @ts-expect-error - testing invalid state
      token.genesis.inclusionProof = undefined;
      expect(hasValidGenesis(token)).toBe(false);
    });
  });

  describe('hasValidState', () => {
    it('should return true for valid state with stateHash', () => {
      const token = createMinimalToken();
      expect(hasValidState(token)).toBe(true);
    });

    it('should return false for missing stateHash', () => {
      const token = createMinimalToken();
      // @ts-expect-error - testing invalid state
      token.state.stateHash = undefined;
      expect(hasValidState(token)).toBe(false);
    });
  });

  describe('getUncommittedTransactions', () => {
    it('should return empty array for token without transactions', () => {
      const token = createMinimalToken();
      expect(getUncommittedTransactions(token)).toEqual([]);
    });

    it('should return uncommitted transactions', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'a', newStateHash: 'b', committed: true }),
        createTransaction({ previousStateHash: 'b', newStateHash: 'c', committed: false }),
      ];
      const uncommitted = getUncommittedTransactions(token);
      expect(uncommitted).toHaveLength(1);
      expect(uncommitted[0].newStateHash).toBe('c');
    });

    it('should return empty array for null input', () => {
      expect(getUncommittedTransactions(null)).toEqual([]);
    });
  });

  describe('getCommittedTransactions', () => {
    it('should return empty array for token without transactions', () => {
      const token = createMinimalToken();
      expect(getCommittedTransactions(token)).toEqual([]);
    });

    it('should return committed transactions', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'a', newStateHash: 'b', committed: true }),
        createTransaction({ previousStateHash: 'b', newStateHash: 'c', committed: false }),
      ];
      const committed = getCommittedTransactions(token);
      expect(committed).toHaveLength(1);
      expect(committed[0].newStateHash).toBe('b');
    });
  });

  describe('hasUncommittedTxs', () => {
    it('should return false for token without transactions', () => {
      const token = createMinimalToken();
      expect(hasUncommittedTxs(token)).toBe(false);
    });

    it('should return true for token with uncommitted transactions', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'a', newStateHash: 'b', committed: false }),
      ];
      expect(hasUncommittedTxs(token)).toBe(true);
    });
  });

  describe('getTransactionAtIndex', () => {
    it('should return transaction at index', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'a', newStateHash: 'b', committed: true }),
        createTransaction({ previousStateHash: 'b', newStateHash: 'c', committed: true }),
      ];
      expect(getTransactionAtIndex(token, 0)?.newStateHash).toBe('b');
      expect(getTransactionAtIndex(token, 1)?.newStateHash).toBe('c');
    });

    it('should return undefined for invalid index', () => {
      const token = createMinimalToken();
      expect(getTransactionAtIndex(token, 0)).toBeUndefined();
      expect(getTransactionAtIndex(token, -1)).toBeUndefined();
    });
  });

  describe('getPreviousStateHash', () => {
    it('should return genesis state hash for first transaction', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'genesis_state_hash', newStateHash: 'b', committed: true }),
      ];
      expect(getPreviousStateHash(token, 0)).toBe('genesis_state_hash');
    });

    it('should return previous transaction state hash', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'genesis_state_hash', newStateHash: 'b', committed: true }),
        createTransaction({ previousStateHash: 'b', newStateHash: 'c', committed: true }),
      ];
      expect(getPreviousStateHash(token, 1)).toBe('b');
    });

    it('should return null for negative index', () => {
      const token = createMinimalToken();
      expect(getPreviousStateHash(token, -1)).toBeNull();
    });
  });

  describe('getCurrentState', () => {
    it('should return genesis state for token without transactions', () => {
      const token = createMinimalToken();
      expect(getCurrentState(token)).toBe('genesis_state_hash');
    });

    it('should return latest committed transaction state', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'genesis_state_hash', newStateHash: 'state1', committed: true }),
        createTransaction({ previousStateHash: 'state1', newStateHash: 'state2', committed: true }),
      ];
      expect(getCurrentState(token)).toBe('state2');
    });

    it('should skip uncommitted transactions', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'genesis_state_hash', newStateHash: 'state1', committed: true }),
        createTransaction({ previousStateHash: 'state1', newStateHash: 'state2', committed: false }),
      ];
      expect(getCurrentState(token)).toBe('state1');
    });
  });

  describe('isSplitToken', () => {
    it('should return false for non-split token', () => {
      const token = createMinimalToken();
      expect(isSplitToken(token)).toBe(false);
    });

    it('should return true for SPLIT_MINT prefix', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = 'SPLIT_MINT:abc123';
      expect(isSplitToken(token)).toBe(true);
    });

    it('should return true for JSON format with burnTransactionHash', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = JSON.stringify({ burnTransactionHash: 'abc123' });
      expect(isSplitToken(token)).toBe(true);
    });

    it('should return true for JSON format with splitMintReason', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = JSON.stringify({
        splitMintReason: { burnTransactionHash: 'abc123' },
      });
      expect(isSplitToken(token)).toBe(true);
    });

    it('should return false for invalid JSON', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = '{invalid json';
      expect(isSplitToken(token)).toBe(false);
    });
  });

  describe('extractBurnTxHash', () => {
    it('should return null for non-split token', () => {
      const token = createMinimalToken();
      expect(extractBurnTxHash(token)).toBeNull();
    });

    it('should extract hash from SPLIT_MINT prefix', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = 'SPLIT_MINT:abc123def456';
      expect(extractBurnTxHash(token)).toBe('abc123def456');
    });

    it('should extract hash from JSON burnTransactionHash', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = JSON.stringify({ burnTransactionHash: 'xyz789' });
      expect(extractBurnTxHash(token)).toBe('xyz789');
    });

    it('should extract hash from JSON splitMintReason', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = JSON.stringify({
        splitMintReason: { burnTransactionHash: 'nested123' },
      });
      expect(extractBurnTxHash(token)).toBe('nested123');
    });
  });

  describe('getValidationSummary', () => {
    it('should return correct summary for valid token', () => {
      const token = createMinimalToken();
      token.transactions = [
        createTransaction({ previousStateHash: 'a', newStateHash: 'b', committed: true }),
        createTransaction({ previousStateHash: 'b', newStateHash: 'c', committed: false }),
      ];

      const summary = getValidationSummary(token);
      expect(summary.hasValidStructure).toBe(true);
      expect(summary.hasValidGenesis).toBe(true);
      expect(summary.hasValidState).toBe(true);
      expect(summary.transactionCount).toBe(2);
      expect(summary.committedCount).toBe(1);
      expect(summary.uncommittedCount).toBe(1);
      expect(summary.isSplitToken).toBe(false);
      expect(summary.burnTxHash).toBeNull();
    });

    it('should detect split token in summary', () => {
      const token = createMinimalToken();
      token.genesis.data.reason = 'SPLIT_MINT:abc123';

      const summary = getValidationSummary(token);
      expect(summary.isSplitToken).toBe(true);
      expect(summary.burnTxHash).toBe('abc123');
    });
  });
});
