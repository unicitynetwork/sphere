import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import type { WalletAddress } from '../sdk/types';

// Session key for IdentityManager (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";

// Polling intervals (in milliseconds)
const INITIAL_POLL_INTERVAL = 5000;      // 5 seconds for first minute
const SUBSEQUENT_POLL_INTERVAL = 30000;  // 30 seconds after first minute
const FREQUENT_POLL_DURATION = 60000;    // 1 minute of frequent polling

/**
 * Extended address info with IPNS fetching state
 */
export interface AddressWithNametag {
  address: string;
  index: number;
  isChange?: boolean;          // True if this is a change address (chain=1)
  ipnsLoading: boolean;        // True while fetching from IPFS
  hasNametag: boolean;
  nametag?: string;
  ipnsName?: string;
  ipnsError?: string;
  firstFetchTime?: number;     // Timestamp of first fetch attempt (for backoff)
  lastFetchTime?: number;      // Timestamp of last fetch attempt
  // L3 inventory fields
  hasL3Inventory?: boolean;    // True if has L3 inventory (tokens/nametag)
  l3Address?: string;          // L3 address for inventory lookup
}

/**
 * Hook to fetch nametags for wallet addresses from IPNS
 *
 * IMPORTANT: Uses L3 identity private key (from UnifiedKeyManager) for IPNS derivation,
 * NOT the L1 wallet's private key. This ensures consistency with how nametags are published.
 */
export function useAddressNametags(addresses: WalletAddress[] | undefined) {
  const [addressesWithNametags, setAddressesWithNametags] = useState<AddressWithNametag[]>([]);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const initializedAddressesRef = useRef<Set<string>>(new Set());
  const fetchInProgressRef = useRef<Set<string>>(new Set());

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // Fetch a single address's nametag and check L3 inventory
  // NOTE: isChange is CRITICAL - external and change addresses have DIFFERENT L3 identities!
  const fetchSingleNametag = useCallback(async (
    _address: string,
    index: number,
    isChange: boolean = false
  ): Promise<{
    hasNametag: boolean;
    nametag?: string;
    ipnsName?: string;
    ipnsError?: string;
    hasL3Inventory?: boolean;
    l3Address?: string;
  }> => {
    try {
      const identityManager = IdentityManager.getInstance(SESSION_KEY);
      // Pass isChange to derive the correct L3 identity (chain=0 for external, chain=1 for change)
      const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(index, undefined, isChange);
      const l3Address = l3Identity.address;
      const result = await fetchNametagFromIpns(l3Identity.privateKey);

      // Check L3 inventory from localStorage (instant check)
      const localNametag = WalletRepository.checkNametagForAddress(l3Address);
      const localTokens = WalletRepository.checkTokensForAddress(l3Address);
      const hasL3Inventory = !!result.nametag || !!localNametag || localTokens;

      return {
        hasNametag: !!result.nametag,
        nametag: result.nametag || localNametag?.name || undefined,
        ipnsName: result.ipnsName,
        ipnsError: result.error,
        hasL3Inventory,
        l3Address,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        hasNametag: false,
        ipnsError: errorMsg,
        hasL3Inventory: false,
      };
    }
  }, []);

  // Initialize and fetch nametags for addresses
  useEffect(() => {
    if (!addresses || addresses.length === 0) {
      setAddressesWithNametags([]);
      initializedAddressesRef.current.clear();
      return;
    }

    // Find addresses that haven't been initialized yet
    const newAddresses = addresses.filter(
      addr => !initializedAddressesRef.current.has(addr.address)
    );

    if (newAddresses.length === 0) {
      return;
    }

    console.log(`🔍 [L1] Initializing ${newAddresses.length} new addresses for nametag fetch...`);

    // Mark as initialized immediately to prevent duplicate processing
    newAddresses.forEach(addr => initializedAddressesRef.current.add(addr.address));

    // Add new addresses to state with loading state
    // IMPORTANT: Use addr.index (BIP32 derivation index) AND addr.isChange for L3 derivation
    // External and change addresses have DIFFERENT L3 identities (different chain in BIP32 path)
    const newStates: AddressWithNametag[] = newAddresses.map((addr) => {
      return {
        address: addr.address,
        index: addr.index,  // Use actual BIP32 index, not sequential position
        isChange: addr.isChange,  // Track change status for correct L3 derivation
        ipnsLoading: true,
        hasNametag: false,
        nametag: undefined,
        firstFetchTime: Date.now(),
      };
    });

    setAddressesWithNametags(prev => [...prev, ...newStates]);

    // Fetch nametags for all addresses (external and change have DIFFERENT L3 identities)
    const fetchNewAddresses = async () => {
      for (const addr of newAddresses) {
        if (!mountedRef.current) return;

        // Skip if already fetching
        if (fetchInProgressRef.current.has(addr.address)) continue;
        fetchInProgressRef.current.add(addr.address);

        // Use actual BIP32 index AND isChange for L3 derivation
        const l3Index = addr.index;
        const isChange = addr.isChange ?? false;
        console.log(`🔍 [L1] Fetching nametag for ${addr.address.slice(0, 12)}... (L3 index ${l3Index}, isChange=${isChange})`);

        const result = await fetchSingleNametag(addr.address, l3Index, isChange);

        if (!mountedRef.current) return;

        console.log(`🔍 [L1] IPNS result for ${addr.address.slice(0, 12)}...: ${result.nametag || 'none'}`);

        setAddressesWithNametags(prev =>
          prev.map(a =>
            a.address === addr.address
              ? {
                  ...a,
                  ipnsLoading: false,
                  hasNametag: result.hasNametag,
                  nametag: result.nametag,
                  ipnsName: result.ipnsName,
                  ipnsError: result.ipnsError,
                  lastFetchTime: Date.now(),
                  hasL3Inventory: result.hasL3Inventory,
                  l3Address: result.l3Address,
                }
              : a
          )
        );

        fetchInProgressRef.current.delete(addr.address);
      }
    };

    fetchNewAddresses();
  }, [addresses, fetchSingleNametag]);

  // Continuous polling for addresses without nametags
  useEffect(() => {
    const scheduleNextPoll = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }

      // Find addresses that need polling (no nametag, not currently loading)
      const addressesNeedingPoll = addressesWithNametags.filter(
        (addr) => !addr.hasNametag && !addr.ipnsLoading && addr.firstFetchTime && !fetchInProgressRef.current.has(addr.address)
      );

      if (addressesNeedingPoll.length === 0) {
        return;
      }

      // Determine next poll time based on oldest address's first fetch time
      const now = Date.now();

      // Check if any address is still in the "frequent poll" window
      const hasRecentAddress = addressesNeedingPoll.some(
        (addr) => addr.firstFetchTime && (now - addr.firstFetchTime) < FREQUENT_POLL_DURATION
      );

      const nextPollInterval = hasRecentAddress ? INITIAL_POLL_INTERVAL : SUBSEQUENT_POLL_INTERVAL;

      // Check if enough time has passed since last fetch for any address
      const addressReadyForPoll = addressesNeedingPoll.filter((addr) => {
        if (!addr.lastFetchTime) return true;
        const timeSinceLastFetch = now - addr.lastFetchTime;
        const isRecent = addr.firstFetchTime && (now - addr.firstFetchTime) < FREQUENT_POLL_DURATION;
        const requiredInterval = isRecent ? INITIAL_POLL_INTERVAL : SUBSEQUENT_POLL_INTERVAL;
        return timeSinceLastFetch >= requiredInterval;
      });

      if (addressReadyForPoll.length > 0) {
        // Poll now
        pollTimerRef.current = setTimeout(async () => {
          if (!mountedRef.current) return;

          console.log(`🔄 [L1] Polling ${addressReadyForPoll.length} addresses for nametags...`);

          for (const addr of addressReadyForPoll) {
            if (!mountedRef.current) return;
            if (fetchInProgressRef.current.has(addr.address)) continue;

            fetchInProgressRef.current.add(addr.address);

            // Mark as loading
            setAddressesWithNametags((prev) =>
              prev.map((a) =>
                a.address === addr.address ? { ...a, ipnsLoading: true } : a
              )
            );

            const result = await fetchSingleNametag(addr.address, addr.index, addr.isChange ?? false);

            if (!mountedRef.current) return;

            if (result.hasNametag) {
              console.log(`✅ [L1] Found nametag for ${addr.address.slice(0, 12)}...: ${result.nametag} (isChange=${addr.isChange})`);
            }

            setAddressesWithNametags((prev) =>
              prev.map((a) =>
                a.address === addr.address
                  ? {
                      ...a,
                      ipnsLoading: false,
                      hasNametag: result.hasNametag,
                      nametag: result.nametag,
                      ipnsName: result.ipnsName,
                      ipnsError: result.ipnsError,
                      lastFetchTime: Date.now(),
                      hasL3Inventory: result.hasL3Inventory,
                      l3Address: result.l3Address,
                    }
                  : a
              )
            );

            fetchInProgressRef.current.delete(addr.address);
          }

          // Schedule next poll
          if (mountedRef.current) {
            scheduleNextPoll();
          }
        }, 100);
      } else {
        // Schedule next check
        pollTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            scheduleNextPoll();
          }
        }, nextPollInterval);
      }
    };

    // Start polling after we have addresses
    if (addressesWithNametags.length > 0) {
      // Start polling after a short delay
      const startTimer = setTimeout(() => {
        if (mountedRef.current) {
          scheduleNextPoll();
        }
      }, 1000);

      return () => {
        clearTimeout(startTimer);
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
        }
      };
    }
  }, [addressesWithNametags, fetchSingleNametag]);

  /**
   * Force refresh nametag for a specific address
   * @param isChange - True for change addresses (chain=1), false for external (chain=0)
   */
  const refreshNametag = useCallback(async (address: string, index: number, isChange: boolean = false) => {
    if (fetchInProgressRef.current.has(address)) return;

    fetchInProgressRef.current.add(address);

    // Mark as loading
    setAddressesWithNametags((prev) =>
      prev.map((a) =>
        a.address === address
          ? { ...a, ipnsLoading: true, hasNametag: false, nametag: undefined }
          : a
      )
    );

    const result = await fetchSingleNametag(address, index, isChange);

    setAddressesWithNametags((prev) =>
      prev.map((a) =>
        a.address === address
          ? {
              ...a,
              ipnsLoading: false,
              hasNametag: result.hasNametag,
              nametag: result.nametag,
              ipnsName: result.ipnsName,
              ipnsError: result.ipnsError,
              lastFetchTime: Date.now(),
              hasL3Inventory: result.hasL3Inventory,
              l3Address: result.l3Address,
            }
          : a
      )
    );

    fetchInProgressRef.current.delete(address);
  }, [fetchSingleNametag]);

  // Convert to lookup object for easy access by address
  const nametagState: { [address: string]: AddressWithNametag } = {};
  for (const addr of addressesWithNametags) {
    nametagState[addr.address] = addr;
  }

  return { nametagState, addressesWithNametags, refreshNametag };
}
