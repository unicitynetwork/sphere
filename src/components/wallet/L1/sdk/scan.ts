/**
 * Wallet address scanning for BIP32 HD wallets
 * Port of index.html scanning functionality
 */

import { deriveKeyAtPath } from "./address";
import { getBalance } from "./network";
import { createBech32 } from "./bech32";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";

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
}

export interface ScanProgress {
  current: number;
  total: number;
  found: number;
  totalBalance: number;
  foundAddresses: ScannedAddress[];
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

  if (!wallet.masterPrivateKey) {
    throw new Error("No master private key in wallet");
  }

  // For BIP32 wallets, we need chainCode
  const chainCode = wallet.masterChainCode || wallet.chainCode;
  if (!chainCode) {
    throw new Error("No chain code found - cannot derive BIP32 addresses");
  }

  // Try different base paths that Alpha wallet might use
  const basePaths = [
    "m/84'/1'/0'",  // BIP84 testnet (common for Alpha)
    "m/84'/0'/0'",  // BIP84 mainnet
    "m/44'/1'/0'",  // BIP44 testnet
    "m/44'/0'/0'",  // BIP44 mainnet
  ];

  // Scan both external (0) and change (1) chains
  const chains = [0, 1];

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

          if (balance > 0) {
            foundAddresses.push({
              index: i,
              address: addrInfo.address,
              path: addrInfo.path,
              balance,
              privateKey: addrInfo.privateKey,
              publicKey: addrInfo.publicKey,
              isChange: chain === 1,
            });
            totalBalance += balance;
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

  return {
    addresses: foundAddresses,
    totalBalance,
    scannedCount: Math.min(maxAddresses, shouldStop?.() ? 0 : maxAddresses),
  };
}
