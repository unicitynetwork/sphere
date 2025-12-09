import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { IdentityManager } from '../../L3/services/IdentityManager';
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
  ipnsLoading: boolean;        // True while fetching from IPFS
  hasNametag: boolean;
  nametag?: string;
  ipnsName?: string;
  ipnsError?: string;
  firstFetchTime?: number;     // Timestamp of first fetch attempt (for backoff)
  lastFetchTime?: number;      // Timestamp of last fetch attempt
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

  // Fetch a single address's nametag
  const fetchSingleNametag = useCallback(async (_address: string, index: number): Promise<{
    hasNametag: boolean;
    nametag?: string;
    ipnsName?: string;
    ipnsError?: string;
  }> => {
    try {
      const identityManager = IdentityManager.getInstance(SESSION_KEY);
      const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(index);
      const result = await fetchNametagFromIpns(l3Identity.privateKey);

      return {
        hasNametag: !!result.nametag,
        nametag: result.nametag || undefined,
        ipnsName: result.ipnsName,
        ipnsError: result.error,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        hasNametag: false,
        ipnsError: errorMsg,
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
    const newStates: AddressWithNametag[] = newAddresses.map((addr) => {
      const sequentialIndex = addresses.findIndex(a => a.address === addr.address);
      return {
        address: addr.address,
        index: sequentialIndex,
        ipnsLoading: true,
        hasNametag: false,
        nametag: undefined,
        firstFetchTime: Date.now(),
      };
    });

    setAddressesWithNametags(prev => [...prev, ...newStates]);

    // Fetch nametags for new addresses
    const fetchNewAddresses = async () => {
      for (const addr of newAddresses) {
        if (!mountedRef.current) return;

        const sequentialIndex = addresses.findIndex(a => a.address === addr.address);

        // Skip if already fetching
        if (fetchInProgressRef.current.has(addr.address)) continue;
        fetchInProgressRef.current.add(addr.address);

        console.log(`🔍 [L1] Fetching nametag for ${addr.address.slice(0, 12)}... (index ${sequentialIndex})`);

        const result = await fetchSingleNametag(addr.address, sequentialIndex);

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

            const result = await fetchSingleNametag(addr.address, addr.index);

            if (!mountedRef.current) return;

            if (result.hasNametag) {
              console.log(`✅ [L1] Found nametag for ${addr.address.slice(0, 12)}...: ${result.nametag}`);
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
   */
  const refreshNametag = useCallback(async (address: string, index: number) => {
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

    const result = await fetchSingleNametag(address, index);

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
