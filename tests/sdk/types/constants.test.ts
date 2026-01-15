/**
 * Tests for SDK constants
 *
 * Ensures all critical constants have correct values across the SDK.
 */

import { describe, it, expect } from 'vitest';
import {
  UNICITY_TOKEN_TYPE_HEX,
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
} from '../../../src/components/wallet/sdk/types';

describe('SDK Constants', () => {
  describe('UNICITY_TOKEN_TYPE_HEX', () => {
    it('should have correct value', () => {
      expect(UNICITY_TOKEN_TYPE_HEX).toBe('f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509');
    });

    it('should be 64 character hex string', () => {
      expect(UNICITY_TOKEN_TYPE_HEX).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should not be the wrong value (regression test)', () => {
      // This was the incorrect value that caused nametag minting to fail
      expect(UNICITY_TOKEN_TYPE_HEX).not.toBe('00000000000000000000000000000000000000000000000000000000000000ff');
    });
  });

  describe('DEFAULT_BASE_PATH', () => {
    it('should have correct BIP84 path', () => {
      expect(DEFAULT_BASE_PATH).toBe("m/84'/1'/0'");
    });

    it('should be valid BIP path format', () => {
      expect(DEFAULT_BASE_PATH).toMatch(/^m\/\d+'\/\d+'\/\d+'$/);
    });
  });

  describe('DEFAULT_DERIVATION_MODE', () => {
    it('should be bip32', () => {
      expect(DEFAULT_DERIVATION_MODE).toBe('bip32');
    });
  });
});
