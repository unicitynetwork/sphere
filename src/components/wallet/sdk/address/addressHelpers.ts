/**
 * WalletAddressHelper - Path-based address lookup and mutation utilities
 *
 * Key principle: A BIP32 path ALWAYS derives the same address from a given master key.
 * - If we try to add a different address for an existing path → FATAL ERROR
 * - This indicates corruption, wrong derivation, or data integrity issue
 *
 * Performance: O(n) lookup is negligible for typical wallet sizes (5-100 addresses)
 *
 * Generic implementation: Works with any wallet/address type that extends Base types.
 */

import type { BaseWalletAddress } from '../types';

/**
 * Generic wallet address helper that works with any wallet type
 * extending BaseWallet and BaseWalletAddress
 */
export class WalletAddressHelper {
  /**
   * Find address by BIP32 derivation path
   * @param wallet - The wallet to search
   * @param path - Full BIP32 path like "m/84'/1'/0'/0/5"
   * @returns The address if found, undefined otherwise
   */
  static findByPath<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W, path: string): A | undefined {
    return wallet.addresses.find((a) => a.path === path);
  }

  /**
   * Get the default address (first external/non-change address)
   * This replaces `wallet.addresses[0]` pattern for safer access
   *
   * @param wallet - The wallet
   * @returns First non-change address, or first address if all are change
   */
  static getDefault<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W): A {
    return wallet.addresses.find((a) => !a.isChange) ?? wallet.addresses[0];
  }

  /**
   * Get the default address, or undefined if wallet has no addresses
   * Safe version that doesn't throw on empty wallet
   */
  static getDefaultOrNull<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W): A | undefined {
    if (!wallet.addresses || wallet.addresses.length === 0) {
      return undefined;
    }
    return wallet.addresses.find((a) => !a.isChange) ?? wallet.addresses[0];
  }

  /**
   * Add new address to wallet (immutable operation)
   *
   * THROWS if address with same path but different address string already exists.
   * This indicates a serious derivation or data corruption issue.
   *
   * If the same path+address already exists, returns wallet unchanged (idempotent).
   *
   * @param wallet - The wallet to add to
   * @param newAddress - The address to add
   * @returns New wallet object with address added
   * @throws Error if path exists with different address (corruption indicator)
   */
  static add<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W, newAddress: A): W {
    if (!newAddress.path) {
      throw new Error('Cannot add address without a path');
    }

    const existing = this.findByPath(wallet, newAddress.path);

    if (existing) {
      // Path exists - verify it's the SAME address
      if (existing.address !== newAddress.address) {
        throw new Error(
          `CRITICAL: Attempted to overwrite address for path ${newAddress.path}\n` +
            `Existing: ${existing.address}\n` +
            `New: ${newAddress.address}\n` +
            `This indicates master key corruption or derivation logic error.`
        );
      }

      // Same path + same address = idempotent, return unchanged
      return wallet;
    }

    // New path - add to array
    return {
      ...wallet,
      addresses: [...wallet.addresses, newAddress],
    } as W;
  }

  /**
   * Remove address by path (immutable operation)
   * @param wallet - The wallet to modify
   * @param path - The path of the address to remove
   * @returns New wallet object with address removed
   */
  static removeByPath<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W, path: string): W {
    return {
      ...wallet,
      addresses: wallet.addresses.filter((a) => a.path !== path),
    } as W;
  }

  /**
   * Get all external (non-change) addresses
   * @param wallet - The wallet
   * @returns Array of external addresses
   */
  static getExternal<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W): A[] {
    return wallet.addresses.filter((a) => !a.isChange);
  }

  /**
   * Get all change addresses
   * @param wallet - The wallet
   * @returns Array of change addresses
   */
  static getChange<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W): A[] {
    return wallet.addresses.filter((a) => a.isChange);
  }

  /**
   * Check if wallet has an address with the given path
   * @param wallet - The wallet to check
   * @param path - The path to look for
   * @returns true if path exists
   */
  static hasPath<W extends { addresses: BaseWalletAddress[] }>(
    wallet: W,
    path: string
  ): boolean {
    return wallet.addresses.some((a) => a.path === path);
  }

  /**
   * Validate wallet address array integrity
   * Checks for duplicate paths which indicate data corruption
   *
   * @param wallet - The wallet to validate
   * @throws Error if duplicate paths found
   */
  static validate<W extends { addresses: BaseWalletAddress[] }>(wallet: W): void {
    const paths = wallet.addresses.map((a) => a.path).filter(Boolean);
    const uniquePaths = new Set(paths);

    if (paths.length !== uniquePaths.size) {
      // Find duplicates for error message
      const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i);
      throw new Error(
        `CRITICAL: Wallet has duplicate paths: ${duplicates.join(', ')}\n` +
          `This indicates data corruption. Please restore from backup.`
      );
    }
  }

  /**
   * Sort addresses with external first, then change, each sorted by index
   * Useful for display purposes
   *
   * @param wallet - The wallet
   * @returns New wallet with sorted addresses
   */
  static sortAddresses<
    A extends BaseWalletAddress,
    W extends { addresses: A[] }
  >(wallet: W): W {
    const sorted = [...wallet.addresses].sort((a, b) => {
      // External addresses first (isChange = false/undefined)
      const aIsChange = a.isChange ? 1 : 0;
      const bIsChange = b.isChange ? 1 : 0;
      if (aIsChange !== bIsChange) return aIsChange - bIsChange;
      // Then by index
      return a.index - b.index;
    });

    return {
      ...wallet,
      addresses: sorted,
    } as W;
  }
}
