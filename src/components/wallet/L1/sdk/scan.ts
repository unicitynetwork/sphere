/**
 * Wallet address scanning for BIP32 HD wallets
 * Port of index.html scanning functionality
 *
 * Enhanced to include L3 inventory checking:
 * - Addresses with L1 balance OR L3 inventory are included
 * - First 10 addresses get active IPFS sync in parallel
 * - Remaining addresses use lazy sync (on-demand)
 * - Cached nametags from localStorage displayed immediately
 */

import { deriveKeyAtPath } from "./address";
import { getBalance } from "./network";
import { createBech32 } from "./bech32";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
// L3 inventory checking imports
import { IdentityManager } from "../../L3/services/IdentityManager";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { fetchNametagFromIpns } from "../../L3/services/IpnsNametagFetcher";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";

const ec = new elliptic.ec("secp256k1");

/**
 * Generate address at specific BIP32 path (supports both external and change chains)
 */
function generateAddressAtPath(
  masterPrivKey: string,
  chainCode: string,
  path: string
) {
  const derived = deriveKeyAtPath(masterPrivKey, chainCode, path);

  const keyPair = ec.keyFromPrivate(derived.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 -> RIPEMD160)
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );

  const address = createBech32("alpha", 0, programBytes);

  return {
    address,
    privateKey: derived.privateKey,
    publicKey,
    path,
  };
}

export interface ScannedAddress {
  index: number;
  address: string;
  path: string;
  balance: number;
  privateKey: string;
  publicKey: string;
  isChange?: boolean;
  // L3 inventory fields
  l3Nametag?: string;       // Nametag (Unicity ID) if found
  hasL3Inventory?: boolean; // True if has L3 inventory
  l3Synced?: boolean;       // True if IPFS sync completed for this address
}

// Number of addresses to actively sync IPFS in parallel
const ACTIVE_SYNC_LIMIT = 10;

/**
 * Get cached L3 info from localStorage (instant, no network)
 *
 * Uses PATH as the single identifier for unambiguous address derivation.
 * This ensures consistent L3 addresses regardless of whether the address
 * is external or change.
 *
 * @param path - Full BIP32 path like "m/84'/1'/0'/0/0" or "m/84'/1'/0'/1/3"
 */
async function getCachedL3Info(
  path: string
): Promise<{
  nametag?: string;
  hasInventory: boolean;
  l3Address?: string;
  l3PrivateKey?: string;
}> {
  try {
    // Use path-based derivation for unambiguous L3 identity
    const identityManager = IdentityManager.getInstance("user-pin-1234");
    const identity = await identityManager.deriveIdentityFromPath(path);
    const l3Address = identity.address;

    // Check localStorage (instant)
    const localNametag = WalletRepository.checkNametagForAddress(l3Address);
    const localTokens = WalletRepository.checkTokensForAddress(l3Address);

    return {
      nametag: localNametag?.name,
      hasInventory: !!localNametag || localTokens,
      l3Address,
      l3PrivateKey: identity.privateKey,
    };
  } catch (error) {
    console.warn("Error getting cached L3 info:", error);
    return { hasInventory: false };
  }
}

export interface ScanProgress {
  current: number;
  total: number;
  found: number;
  totalBalance: number;
  foundAddresses: ScannedAddress[];
  l1ScanComplete?: boolean;  // True when L1 balance scan is done (IPNS may still be running)
}

export interface ScanResult {
  addresses: ScannedAddress[];
  totalBalance: number;
  scannedCount: number;
}

/**
 * Scan wallet addresses to find those with balances
 * @param wallet - Wallet with masterPrivateKey and chainCode
 * @param maxAddresses - Maximum addresses to scan (default 200)
 * @param onProgress - Progress callback
 * @param shouldStop - Function to check if scan should stop
 */
export async function scanWalletAddresses(
  wallet: Wallet,
  maxAddresses: number = 200,
  onProgress?: (progress: ScanProgress) => void,
  shouldStop?: () => boolean
): Promise<ScanResult> {
  const foundAddresses: ScannedAddress[] = [];
  let totalBalance = 0;
  let l1ScanComplete = false;  // Track when L1 balance scan completes

  if (!wallet.masterPrivateKey) {
    throw new Error("No master private key in wallet");
  }

  // For BIP32 wallets, we need chainCode
  const chainCode = wallet.masterChainCode || wallet.chainCode;
  if (!chainCode) {
    throw new Error("No chain code found - cannot derive BIP32 addresses");
  }

  // Use descriptorPath from wallet if available (from .dat file)
  // Otherwise default to BIP44 mainnet (standard for Alpha)
  const basePaths = wallet.descriptorPath
    ? [`m/${wallet.descriptorPath}`]  // Single path from wallet file
    : ["m/44'/0'/0'"];                 // Default: BIP44 mainnet

  console.log(`[Scan] Using base path: ${basePaths[0]}`);
  console.log(`[Scan] Master key prefix: ${wallet.masterPrivateKey.slice(0, 16)}...`);
  console.log(`[Scan] Chain code prefix: ${chainCode.slice(0, 16)}...`);

  // Initialize UnifiedKeyManager with wallet's basePath before deriving L3 identities
  // This ensures getCachedL3Info uses the same derivation path as Select Address window
  const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
  await keyManager.importWithMode(
    wallet.masterPrivateKey,
    chainCode,
    "bip32",
    basePaths[0]  // Use the detected/specified base path
  );
  console.log(`[Scan] UnifiedKeyManager initialized with basePath: ${basePaths[0]}`);

  // Scan both external (0) and change (1) chains
  const chains = [0, 1];

  // IPNS nametag cache - populated by background prefetch
  // Key: L1 private key (since L3 uses same key)
  const ipnsNametagCache = new Map<string, string | null>();
  // Track which addresses need nametag discovery (for background fetch)
  const addressesForIpnsFetch: { privateKey: string; index: number; chain: number; basePath: string }[] = [];
  // Store full address info for prefetched addresses (to add if found after main loop)
  const prefetchedAddressInfo = new Map<string, {
    address: string;
    path: string;
    privateKey: string;
    publicKey: string;
    index: number;
    chain: number;  // 0 = external, 1 = change
  }>();

  // Start IPNS prefetch in background (non-blocking)
  // This runs concurrently with the main L1 balance scan
  console.log(`[Scan] Starting IPNS nametag prefetch in background...`);

  const runIpnsPrefetch = async () => {
    // IMPORTANT: L3 identity uses the SAME private key as the L1 address
    // Use the wallet's base path for both external (chain 0) and change (chain 1) addresses
    for (const basePath of basePaths) {
      for (const prefetchChain of [0, 1]) {
        for (let i = 0; i < Math.min(ACTIVE_SYNC_LIMIT, maxAddresses); i++) {
          const fullPath = `${basePath}/${prefetchChain}/${i}`;
          try {
            const addrInfo = generateAddressAtPath(wallet.masterPrivateKey, chainCode, fullPath);
            // Only add if not already added (same private key from different path)
            if (!prefetchedAddressInfo.has(addrInfo.privateKey)) {
              addressesForIpnsFetch.push({ privateKey: addrInfo.privateKey, index: i, chain: prefetchChain, basePath });
              // Store full address info for later (in case we need to add it after main scan)
              prefetchedAddressInfo.set(addrInfo.privateKey, {
                address: addrInfo.address,
                path: fullPath,
                privateKey: addrInfo.privateKey,
                publicKey: addrInfo.publicKey,
                index: i,
                chain: prefetchChain,
              });
            }
          } catch {
            // Ignore derivation errors
          }
        }
      }
    }

    // Fetch nametags in parallel (with 30s timeout for all)
    // When a nametag is found, immediately add the address to create a feeling of progress
    const fetchPromises = addressesForIpnsFetch.map(async ({ privateKey, index, chain, basePath: addrBasePath }) => {
      try {
        const result = await fetchNametagFromIpns(privateKey);
        if (result.nametag) {
          ipnsNametagCache.set(privateKey, result.nametag);
          const chainLabel = chain === 1 ? "change" : "external";
          const fullPath = `${addrBasePath}/${chain}/${index}`;
          console.log(`[Scan] Found nametag from IPNS for ${chainLabel} index ${index} (path: ${fullPath}, key: ${privateKey.slice(0, 8)}...): ${result.nametag}`);

          // Progressive addition: Add address immediately if not already found
          // Check by privateKey since that uniquely identifies the address (same key = same address)
          const addrInfo = prefetchedAddressInfo.get(privateKey);
          if (addrInfo) {
            const isChangeAddr = addrInfo.chain === 1;
            const existingIdx = foundAddresses.findIndex(a => a.privateKey === privateKey);

            if (existingIdx >= 0) {
              // Entry exists, just update nametag if not set
              if (!foundAddresses[existingIdx].l3Nametag) {
                foundAddresses[existingIdx].l3Nametag = result.nametag;
                foundAddresses[existingIdx].hasL3Inventory = true;
                console.log(`[Scan] Updated ${chainLabel} index ${addrInfo.index} with nametag @${result.nametag}`);
              }
            } else {
              // No entry for this address yet, add L3-only entry
              foundAddresses.push({
                index: addrInfo.index,
                address: addrInfo.address,
                path: addrInfo.path,
                balance: 0,
                privateKey: addrInfo.privateKey,
                publicKey: addrInfo.publicKey,
                isChange: isChangeAddr,
                l3Nametag: result.nametag,
                hasL3Inventory: true,
                l3Synced: false,
              });
              console.log(`[Scan] Added L3 ${chainLabel} address ${addrInfo.index} with nametag @${result.nametag}`);
            }

            // Report progress immediately so UI shows the new address
            onProgress?.({
              current: Math.max(...foundAddresses.map(a => a.index), 0) + 1,
              total: maxAddresses,
              found: foundAddresses.length,
              totalBalance,
              foundAddresses: [...foundAddresses],
              l1ScanComplete,  // Preserve L1 scan status
            });
          }
        }
      } catch {
        // Ignore fetch errors
      }
    });

    await Promise.race([
      Promise.all(fetchPromises),
      new Promise(resolve => setTimeout(resolve, 30000))
    ]);

    console.log(`[Scan] IPNS prefetch complete, found ${ipnsNametagCache.size} nametags`);
  };

  // Start prefetch (don't await - runs in background)
  const prefetchPromise = runIpnsPrefetch();

  for (let i = 0; i < maxAddresses; i++) {
    // Check if scan should stop
    if (shouldStop?.()) {
      break;
    }

    // Try each base path and both chains
    for (const basePath of basePaths) {
      for (const chain of chains) {
        try {
          // Build full path: basePath/chain/index
          const fullPath = `${basePath}/${chain}/${i}`;

          const addrInfo = generateAddressAtPath(
            wallet.masterPrivateKey,
            chainCode,
            fullPath
          );

          // Check balance
          const balance = await getBalance(addrInfo.address);

          // Get cached L3 info (from localStorage, instant)
          // Uses path-based derivation for unambiguous L3 identity
          const cachedL3 = await getCachedL3Info(fullPath);

          // Check if we have a pre-fetched nametag from IPNS
          // Use the L1 private key since L3 uses the same key
          const prefetchedNametag = ipnsNametagCache.get(addrInfo.privateKey);

          // Include address if has L1 balance OR cached L3 inventory OR prefetched nametag
          const hasL3 = cachedL3.hasInventory || !!prefetchedNametag;
          const includeAddress = balance > 0 || hasL3;

          // Check for existing entry (by privateKey since that uniquely identifies the address)
          // The prefetch may have already added this address when a nametag was found
          const existingIndex = foundAddresses.findIndex(a => a.privateKey === addrInfo.privateKey);

          if (includeAddress) {
            if (existingIndex >= 0) {
              // Update existing entry (e.g., L3-only entry gets L1 balance)
              // If L1 has balance, prefer L1 address; otherwise keep existing
              const existing = foundAddresses[existingIndex];
              if (balance > 0 && existing.balance === 0) {
                // L1 has balance, update to use L1 address
                foundAddresses[existingIndex] = {
                  ...existing,
                  address: addrInfo.address,
                  path: addrInfo.path,
                  balance,
                  privateKey: addrInfo.privateKey,
                  publicKey: addrInfo.publicKey,
                  l3Nametag: prefetchedNametag || cachedL3.nametag || existing.l3Nametag,
                  hasL3Inventory: hasL3 || existing.hasL3Inventory,
                };
                totalBalance += balance;
              } else if (balance === 0 && existing.balance === 0) {
                // Both L3-only, merge nametag info
                foundAddresses[existingIndex] = {
                  ...existing,
                  l3Nametag: prefetchedNametag || cachedL3.nametag || existing.l3Nametag,
                  hasL3Inventory: hasL3 || existing.hasL3Inventory,
                };
              }
              // If existing already has balance, don't replace
            } else {
              // New entry
              foundAddresses.push({
                index: i,
                address: addrInfo.address,
                path: addrInfo.path,
                balance,
                privateKey: addrInfo.privateKey,
                publicKey: addrInfo.publicKey,
                isChange: chain === 1,
                // L3 inventory info (from cache or prefetch)
                l3Nametag: prefetchedNametag || cachedL3.nametag,
                hasL3Inventory: hasL3,
                l3Synced: false, // Not yet synced from IPFS
              });
              totalBalance += balance;
            }
          }
        } catch (e) {
          // Continue on derivation errors
          console.warn(`Error deriving address at ${basePath}/${chain}/${i}:`, e);
        }
      }
    }

    // Report progress with found addresses
    onProgress?.({
      current: i + 1,
      total: maxAddresses,
      found: foundAddresses.length,
      totalBalance,
      foundAddresses: [...foundAddresses],
    });

    // Small delay to avoid overwhelming the server
    if (i % 10 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  // Mark L1 scan as complete (IPNS may still be running in background)
  l1ScanComplete = true;

  // Report L1 scan complete - UI can now show "Load Selected" button
  onProgress?.({
    current: maxAddresses,
    total: maxAddresses,
    found: foundAddresses.length,
    totalBalance,
    foundAddresses: [...foundAddresses],
    l1ScanComplete: true,
  });

  // Wait for IPNS prefetch to complete (with 30s max timeout)
  console.log(`[Scan] Main scan complete. Waiting for IPNS prefetch to finish...`);
  await prefetchPromise;

  // Safety net: Check if any addresses with nametags were missed
  // (Most addresses should have been added progressively during prefetch)
  // Check by privateKey since that uniquely identifies the address
  let addedFromPrefetch = 0;
  for (const [privateKey, nametag] of ipnsNametagCache) {
    if (!nametag) continue;

    const addrInfo = prefetchedAddressInfo.get(privateKey);
    if (!addrInfo) continue;

    const isChangeAddr = addrInfo.chain === 1;
    const chainLabel = isChangeAddr ? "change" : "external";

    // Check if this address already has an entry (by privateKey)
    const existingIndex = foundAddresses.findIndex(a => a.privateKey === privateKey);

    if (existingIndex >= 0) {
      // Entry exists, ensure nametag is set
      if (!foundAddresses[existingIndex].l3Nametag) {
        foundAddresses[existingIndex].l3Nametag = nametag;
        foundAddresses[existingIndex].hasL3Inventory = true;
      }
    } else {
      // No entry for this address, add L3-only entry
      foundAddresses.push({
        index: addrInfo.index,
        address: addrInfo.address,
        path: addrInfo.path,
        balance: 0,
        privateKey: addrInfo.privateKey,
        publicKey: addrInfo.publicKey,
        isChange: isChangeAddr,
        l3Nametag: nametag,
        hasL3Inventory: true,
        l3Synced: false,
      });
      addedFromPrefetch++;
      console.log(`[Scan] Safety net: Added ${chainLabel} address ${addrInfo.index} with nametag @${nametag}`);
    }
  }

  // Report final progress if we added addresses from prefetch
  if (addedFromPrefetch > 0) {
    onProgress?.({
      current: maxAddresses,
      total: maxAddresses,
      found: foundAddresses.length,
      totalBalance,
      foundAddresses: [...foundAddresses],
      l1ScanComplete: true,  // L1 scan is definitely complete at this point
    });
  }

  // Report final results
  if (foundAddresses.length > 0) {
    console.log(`[Scan] Scan complete: found ${foundAddresses.length} addresses (${addedFromPrefetch} from IPNS prefetch)`);
  }

  return {
    addresses: foundAddresses,
    totalBalance,
    scannedCount: Math.min(maxAddresses, shouldStop?.() ? 0 : maxAddresses),
  };
}
