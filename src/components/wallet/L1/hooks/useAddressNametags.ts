import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { checkNametagForAddress, hasTokensForAddress } from '../../L3/services/InventorySyncService';
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
  path: string;                // PRIMARY KEY - BIP32 derivation path
  index: number;               // For display purposes only
  isChange?: boolean;          // For display purposes only
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
  // Uses PATH as the single identifier - no index/isChange ambiguity
  const fetchSingleNametag = useCallback(async (
    path: string  // Use path as the ONLY identifier
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
      // Use path-based derivation for unambiguous L3 identity
      const l3Identity = await identityManager.deriveIdentityFromPath(path);
      const l3Address = l3Identity.address;
      const result = await fetchNametagFromIpns(l3Identity.privateKey);

      // Check L3 inventory from localStorage (instant check)
      const localNametag = checkNametagForAddress(l3Address);
      const localTokens = hasTokensForAddress(l3Address);
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
  // Uses PATH as the primary key for all lookups
  useEffect(() => {
    if (!addresses || addresses.length === 0) {
      setAddressesWithNametags([]);
      initializedAddressesRef.current.clear();
      return;
    }

    // Find addresses that haven't been initialized yet (use path as key)
    const newAddresses = addresses.filter(
      addr => addr.path && !initializedAddressesRef.current.has(addr.path)
    );

    if (newAddresses.length === 0) {
      return;
    }

    console.log(`🔍 [L1] Initializing ${newAddresses.length} new addresses for nametag fetch...`);

    // Mark as initialized immediately to prevent duplicate processing (use path as key)
    newAddresses.forEach(addr => {
      if (addr.path) initializedAddressesRef.current.add(addr.path);
    });

    // Initialize addresses and fetch nametags
    const initializeAndFetch = async () => {
      // Add new addresses to state - check local storage first before marking as loading
      // PATH is the primary key - index and isChange are for display only
      const newStates: AddressWithNametag[] = await Promise.all(newAddresses.map(async (addr) => {
        // Check local storage first via L3 identity
        try {
          const identityManager = IdentityManager.getInstance(SESSION_KEY);
          const l3Identity = await identityManager.deriveIdentityFromPath(addr.path!);
          const localNametag = checkNametagForAddress(l3Identity.address);
          const localTokens = hasTokensForAddress(l3Identity.address);

          if (localNametag) {
            console.log(`🔍 [L1] Found local nametag for ${addr.address.slice(0, 12)}...: ${localNametag.name}`);
            return {
              address: addr.address,
              path: addr.path!,
              index: addr.index,
              isChange: addr.isChange,
              ipnsLoading: false,  // No need to fetch - already have it locally
              hasNametag: true,
              nametag: localNametag.name,
              l3Address: l3Identity.address,
              hasL3Inventory: true,
              firstFetchTime: Date.now(),
            };
          }

          // Has tokens but no nametag - still need to check IPNS but mark inventory
          if (localTokens) {
            return {
              address: addr.address,
              path: addr.path!,
              index: addr.index,
              isChange: addr.isChange,
              ipnsLoading: true,
              hasNametag: false,
              nametag: undefined,
              l3Address: l3Identity.address,
              hasL3Inventory: true,
              firstFetchTime: Date.now(),
            };
          }
        } catch (error) {
          console.warn(`[L1] Error checking local nametag for ${addr.address.slice(0, 12)}...`, error);
        }

        // Default: need to fetch from IPNS
        return {
          address: addr.address,
          path: addr.path!,
          index: addr.index,
          isChange: addr.isChange,
          ipnsLoading: true,
          hasNametag: false,
          nametag: undefined,
          firstFetchTime: Date.now(),
        };
      }));

      if (!mountedRef.current) return;

      setAddressesWithNametags(prev => [...prev, ...newStates]);

      // Filter addresses that need IPNS fetching (those still loading)
      const addressesNeedingFetch = newStates.filter(s => s.ipnsLoading);

      // Fetch nametags using PATH as the identifier
      for (const state of addressesNeedingFetch) {
        if (!mountedRef.current) return;

        const addr = newAddresses.find(a => a.path === state.path);
        if (!addr?.path) continue;

        // Skip if already fetching (use path as key)
        if (fetchInProgressRef.current.has(addr.path)) continue;
        fetchInProgressRef.current.add(addr.path);

        console.log(`🔍 [L1] Fetching nametag for ${addr.address.slice(0, 12)}... (path: ${addr.path})`);

        // Use path for L3 derivation - unambiguous!
        const result = await fetchSingleNametag(addr.path);

        if (!mountedRef.current) return;

        console.log(`🔍 [L1] IPNS result for ${addr.address.slice(0, 12)}...: ${result.nametag || 'none'}`);

        // Match by path - unambiguous!
        setAddressesWithNametags(prev =>
          prev.map(a =>
            a.path === addr.path
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

        fetchInProgressRef.current.delete(addr.path);
      }
    };

    initializeAndFetch();
  }, [addresses, fetchSingleNametag]);

  // Continuous polling for addresses without nametags
  // Uses PATH as the key for all lookups
  useEffect(() => {
    const scheduleNextPoll = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }

      // Find addresses that need polling (no nametag, not currently loading) - use path as key
      const addressesNeedingPoll = addressesWithNametags.filter(
        (addr) => !addr.hasNametag && !addr.ipnsLoading && addr.firstFetchTime && !fetchInProgressRef.current.has(addr.path)
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
            // Use path as key
            if (fetchInProgressRef.current.has(addr.path)) continue;

            fetchInProgressRef.current.add(addr.path);

            // Mark as loading - match by path
            setAddressesWithNametags((prev) =>
              prev.map((a) =>
                a.path === addr.path ? { ...a, ipnsLoading: true } : a
              )
            );

            // Use path for L3 derivation - unambiguous!
            const result = await fetchSingleNametag(addr.path);

            if (!mountedRef.current) return;

            if (result.hasNametag) {
              console.log(`✅ [L1] Found nametag for ${addr.address.slice(0, 12)}...: ${result.nametag} (path=${addr.path})`);
            }

            // Match by path - unambiguous!
            setAddressesWithNametags((prev) =>
              prev.map((a) =>
                a.path === addr.path
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

            fetchInProgressRef.current.delete(addr.path);
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
   * @param path - BIP32 derivation path (the ONLY identifier needed)
   */
  const refreshNametag = useCallback(async (path: string) => {
    // Use path as the key
    if (fetchInProgressRef.current.has(path)) return;

    fetchInProgressRef.current.add(path);

    // Mark as loading - match by path
    setAddressesWithNametags((prev) =>
      prev.map((a) =>
        a.path === path
          ? { ...a, ipnsLoading: true, hasNametag: false, nametag: undefined }
          : a
      )
    );

    // Use path for L3 derivation - unambiguous!
    const result = await fetchSingleNametag(path);

    // Match by path - unambiguous!
    setAddressesWithNametags((prev) =>
      prev.map((a) =>
        a.path === path
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

    fetchInProgressRef.current.delete(path);
  }, [fetchSingleNametag]);

  // Convert to lookup object for easy access by address
  const nametagState: { [address: string]: AddressWithNametag } = {};
  for (const addr of addressesWithNametags) {
    nametagState[addr.address] = addr;
  }

  return { nametagState, addressesWithNametags, refreshNametag };
}
