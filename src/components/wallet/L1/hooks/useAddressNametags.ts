import { useEffect, useState } from 'react';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { IdentityManager } from '../../L3/services/IdentityManager';
import type { WalletAddress } from '../sdk/types';

// Session key for IdentityManager (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";

/**
 * Extended address info with IPNS fetching state
 * Matches the DerivedAddressInfo pattern from CreateWalletFlow
 */
export interface AddressWithNametag {
  address: string;
  index: number;
  privateKey?: string;         // Needed to derive IPNS name
  ipnsLoading: boolean;        // True while fetching from IPFS
  hasNametag: boolean;
  nametag?: string;
  ipnsName?: string;
  ipnsError?: string;
}

/**
 * Hook to fetch nametags for wallet addresses from IPNS
 *
 * IMPORTANT: Uses L3 identity private key (from UnifiedKeyManager) for IPNS derivation,
 * NOT the L1 wallet's private key. This ensures consistency with how nametags are published.
 *
 * This follows the same pattern as CreateWalletFlow's IPNS fetching logic.
 */
export function useAddressNametags(addresses: WalletAddress[] | undefined) {
  const [addressesWithNametags, setAddressesWithNametags] = useState<AddressWithNametag[]>([]);

  // Initialize addresses with loading state when addresses change
  useEffect(() => {
    if (!addresses || addresses.length === 0) {
      setAddressesWithNametags([]);
      return;
    }

    const initializeAddresses = async () => {
      console.log(`🔍 [L1] Initializing nametag fetch for ${addresses.length} addresses...`);
      const identityManager = IdentityManager.getInstance(SESSION_KEY);

      // IMPORTANT: Use array position (i) for L3 derivation, NOT addr.index
      // This matches CreateWalletFlow behavior where sequential indices are used
      // to ensure consistent IPNS name derivation across the app
      const initialState: AddressWithNametag[] = await Promise.all(
        addresses.map(async (addr, i) => {
          try {
            // Derive L3 identity using sequential array position (0, 1, 2...)
            // NOT addr.index which may have gaps or be non-sequential
            const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(i);
            console.log(`🔍 [L1] Deriving L3 identity for position ${i}: L1=${addr.address.slice(0, 12)}... L3=${l3Identity.address.slice(0, 12)}...`);
            return {
              address: addr.address,
              index: i,  // Use sequential index for L3 derivation
              privateKey: l3Identity.privateKey,
              ipnsLoading: true,  // Mark for fetching
              hasNametag: false,
              nametag: undefined,
            };
          } catch (error) {
            console.warn(`🔍 [L1] Failed to derive L3 identity for position ${i}:`, error);
            return {
              address: addr.address,
              index: i,
              ipnsLoading: false,
              hasNametag: false,
              nametag: undefined,
              ipnsError: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      setAddressesWithNametags(initialState);
    };

    initializeAddresses();
  }, [addresses]);

  // Fetch nametags from IPNS in parallel when addresses have ipnsLoading: true
  // This matches the CreateWalletFlow pattern exactly
  useEffect(() => {
    if (addressesWithNametags.length === 0) return;

    // Find addresses that need IPNS fetching
    const addressesToFetch = addressesWithNametags.filter(
      (addr) => addr.ipnsLoading && addr.privateKey
    );

    if (addressesToFetch.length === 0) return;

    // Fetch nametags in parallel
    const fetchAllNametags = async () => {
      console.log(`🔍 [L1] Fetching nametags from IPNS for ${addressesToFetch.length} addresses...`);

      const fetchPromises = addressesToFetch.map(async (addr) => {
        try {
          const result = await fetchNametagFromIpns(addr.privateKey!);
          console.log(`🔍 [L1] IPNS result for ${addr.address.slice(0, 12)}... (index ${addr.index}): ${result.nametag || 'none'} (via ${result.source})`);

          // Update state with fetched result - update individual address
          setAddressesWithNametags((prev) =>
            prev.map((a) =>
              a.address === addr.address
                ? {
                    ...a,
                    ipnsName: result.ipnsName,
                    hasNametag: !!result.nametag,
                    nametag: result.nametag || undefined,
                    ipnsLoading: false,
                    ipnsError: result.error,
                    // Clear private key after use (security)
                    privateKey: undefined,
                  }
                : a
            )
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.warn(`🔍 [L1] IPNS fetch error for ${addr.address}:`, errorMsg);
          // Mark as failed but not loading
          setAddressesWithNametags((prev) =>
            prev.map((a) =>
              a.address === addr.address
                ? {
                    ...a,
                    ipnsLoading: false,
                    ipnsError: errorMsg,
                    privateKey: undefined,
                  }
                : a
            )
          );
        }
      });

      await Promise.allSettled(fetchPromises);
      console.log('🔍 [L1] IPNS nametag fetch complete');
    };

    fetchAllNametags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesWithNametags.length]);

  /**
   * Force refresh nametag for a specific address
   */
  const refreshNametag = async (address: string, index: number) => {
    // Mark as loading
    setAddressesWithNametags((prev) =>
      prev.map((a) =>
        a.address === address
          ? { ...a, ipnsLoading: true, hasNametag: false, nametag: undefined }
          : a
      )
    );

    try {
      const identityManager = IdentityManager.getInstance(SESSION_KEY);
      const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(index);
      const result = await fetchNametagFromIpns(l3Identity.privateKey);

      setAddressesWithNametags((prev) =>
        prev.map((a) =>
          a.address === address
            ? {
                ...a,
                ipnsLoading: false,
                hasNametag: !!result.nametag,
                nametag: result.nametag || undefined,
                ipnsName: result.ipnsName,
                ipnsError: result.error,
              }
            : a
        )
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setAddressesWithNametags((prev) =>
        prev.map((a) =>
          a.address === address
            ? { ...a, ipnsLoading: false, ipnsError: errorMsg }
            : a
        )
      );
    }
  };

  // Convert to lookup object for easy access by address
  const nametagState: { [address: string]: AddressWithNametag } = {};
  for (const addr of addressesWithNametags) {
    nametagState[addr.address] = addr;
  }

  return { nametagState, addressesWithNametags, refreshNametag };
}
