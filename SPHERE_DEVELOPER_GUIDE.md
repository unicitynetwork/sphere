# Sphere Wallet Developer Guide: BIP32 Implementation & ALPHA Vesting

This document provides implementation directions for Sphere developers to:
1. Upgrade from the current custom derivation to **standard BIP32**
2. Implement **ALPHA coin vesting filtering** (vested vs unvested coins)

---

## Part 1: Implementing Standard BIP32 Derivation

### 1.1 Current Sphere Implementation (Non-Standard)

**File: `src/components/wallet/L1/sdk/address.ts`**

Your current derivation method:
```typescript
export function deriveChildKey(masterPriv: string, chainCode: string, index: number) {
  const data = masterPriv + index.toString(16).padStart(8, "0");
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(chainCode)
  ).toString();
  return {
    privateKey: I.substring(0, 64),
    nextChainCode: I.substring(64),
  };
}
```

**Problems:**
- Non-standard data format (should include public key for non-hardened)
- No hardened/non-hardened distinction
- No modular arithmetic with curve order
- Incompatible with BIP32 tools and hardware wallets

### 1.2 Standard BIP32 Specification

**BIP32 Child Key Derivation Formula:**

For **hardened** child keys (index >= 0x80000000):
```
data = 0x00 || ser256(kpar) || ser32(i)
I = HMAC-SHA512(Key = cpar, Data = data)
IL = I[0:32], IR = I[32:64]
ki = parse256(IL) + kpar (mod n)
ci = IR
```

For **non-hardened** child keys (index < 0x80000000):
```
data = serP(point(kpar)) || ser32(i)
I = HMAC-SHA512(Key = cpar, Data = data)
IL = I[0:32], IR = I[32:64]
ki = parse256(IL) + kpar (mod n)
ci = IR
```

Where:
- `kpar` = parent private key (32 bytes)
- `cpar` = parent chain code (32 bytes)
- `n` = secp256k1 curve order: `0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141`
- `ser256(k)` = 32-byte big-endian serialization of integer k
- `ser32(i)` = 4-byte big-endian serialization of index i
- `serP(P)` = compressed public key (33 bytes)

### 1.3 BIP32 Implementation for Sphere

**Replace `address.ts` with:**

```typescript
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { createBech32 } from "./bech32";

const ec = new elliptic.ec("secp256k1");

// secp256k1 curve order
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

/**
 * Standard BIP32 child key derivation
 * @param parentPrivKey - Parent private key (hex string, 64 chars)
 * @param parentChainCode - Parent chain code (hex string, 64 chars)
 * @param index - Child index (use >= 0x80000000 for hardened)
 * @returns Child private key and chain code
 */
export function deriveChildKeyBIP32(
  parentPrivKey: string,
  parentChainCode: string,
  index: number
): { privateKey: string; chainCode: string } {

  const isHardened = index >= 0x80000000;
  let data: string;

  if (isHardened) {
    // Hardened derivation: 0x00 || parentPrivKey || index
    const indexHex = index.toString(16).padStart(8, "0");
    data = "00" + parentPrivKey + indexHex;
  } else {
    // Non-hardened derivation: compressedPubKey || index
    const keyPair = ec.keyFromPrivate(parentPrivKey, "hex");
    const compressedPubKey = keyPair.getPublic(true, "hex");
    const indexHex = index.toString(16).padStart(8, "0");
    data = compressedPubKey + indexHex;
  }

  // HMAC-SHA512 with chain code as key
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(parentChainCode)
  ).toString();

  const IL = I.substring(0, 64);  // Left 32 bytes
  const IR = I.substring(64);      // Right 32 bytes (new chain code)

  // Add IL to parent key mod n (curve order)
  const ilBigInt = BigInt("0x" + IL);
  const parentKeyBigInt = BigInt("0x" + parentPrivKey);

  // Check IL is valid (less than curve order)
  if (ilBigInt >= CURVE_ORDER) {
    throw new Error("Invalid key: IL >= curve order");
  }

  const childKeyBigInt = (ilBigInt + parentKeyBigInt) % CURVE_ORDER;

  // Check child key is valid (not zero)
  if (childKeyBigInt === 0n) {
    throw new Error("Invalid key: child key is zero");
  }

  const childPrivKey = childKeyBigInt.toString(16).padStart(64, "0");

  return {
    privateKey: childPrivKey,
    chainCode: IR,
  };
}

/**
 * Derive key at a full BIP44 path
 * @param masterPrivKey - Master private key
 * @param masterChainCode - Master chain code
 * @param path - BIP44 path like "m/44'/0'/0'/0/0"
 */
export function deriveKeyAtPath(
  masterPrivKey: string,
  masterChainCode: string,
  path: string
): { privateKey: string; chainCode: string } {

  const pathParts = path.replace("m/", "").split("/");

  let currentKey = masterPrivKey;
  let currentChainCode = masterChainCode;

  for (const part of pathParts) {
    const isHardened = part.endsWith("'") || part.endsWith("h");
    const indexStr = part.replace(/['h]$/, "");
    let index = parseInt(indexStr, 10);

    if (isHardened) {
      index += 0x80000000;  // Add hardened offset
    }

    const derived = deriveChildKeyBIP32(currentKey, currentChainCode, index);
    currentKey = derived.privateKey;
    currentChainCode = derived.chainCode;
  }

  return {
    privateKey: currentKey,
    chainCode: currentChainCode,
  };
}

/**
 * Generate HD address using standard BIP32
 */
export function generateHDAddressBIP32(
  masterPriv: string,
  chainCode: string,
  index: number,
  basePath: string = "m/44'/0'/0'"
) {
  // Standard path: m/44'/0'/0'/0/{index} (external chain, non-hardened)
  const fullPath = `${basePath}/0/${index}`;

  const derived = deriveKeyAtPath(masterPriv, chainCode, fullPath);

  const keyPair = ec.keyFromPrivate(derived.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 → RIPEMD160)
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
    index,
    path: fullPath,
  };
}
```

### 1.4 Master Key Generation from Seed (BIP32)

For proper BIP32, the master key and chain code should be derived from a seed:

```typescript
/**
 * Generate master key and chain code from seed (BIP32 standard)
 * @param seed - Random seed (typically 64 bytes from BIP39 mnemonic)
 */
export function generateMasterKeyFromSeed(seedHex: string): {
  masterPrivateKey: string;
  masterChainCode: string;
} {
  // BIP32: HMAC-SHA512 with key "Bitcoin seed"
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(seedHex),
    CryptoJS.enc.Utf8.parse("Bitcoin seed")
  ).toString();

  const IL = I.substring(0, 64);   // Master private key
  const IR = I.substring(64);       // Master chain code

  // Validate master key
  const masterKeyBigInt = BigInt("0x" + IL);
  if (masterKeyBigInt === 0n || masterKeyBigInt >= CURVE_ORDER) {
    throw new Error("Invalid master key generated");
  }

  return {
    masterPrivateKey: IL,
    masterChainCode: IR,
  };
}
```

### 1.5 Wallet.ts Updates

Update `wallet.ts` to use proper BIP32:

```typescript
import { generateMasterKeyFromSeed, generateHDAddressBIP32 } from "./address";

export function createWallet(): Wallet {
  // Generate 64-byte seed (512 bits)
  const seed = CryptoJS.lib.WordArray.random(64).toString();

  // Derive master key and chain code per BIP32
  const { masterPrivateKey, masterChainCode } = generateMasterKeyFromSeed(seed);

  const firstAddress = generateHDAddressBIP32(masterPrivateKey, masterChainCode, 0);

  const wallet: Wallet = {
    masterPrivateKey,
    chainCode: masterChainCode,
    addresses: [firstAddress],
    createdAt: Date.now(),
  };

  saveWalletToStorage("main", wallet);
  return wallet;
}
```

### 1.6 Standard BIP44 Paths for ALPHA

```
Purpose: 44' (BIP44)
Coin Type: 0' (use registered coin type when available)
Account: 0'
Change: 0 (external) or 1 (internal/change)
Address Index: 0, 1, 2, ...

Full path: m/44'/0'/0'/0/{index}
```

---

## Part 2: Implementing ALPHA Coin Vesting Filtering

### 2.1 Vesting Concept

ALPHA blockchain has **vested** and **unvested** coins based on when they were mined:

| Coin Type | Coinbase Block | Description |
|-----------|----------------|-------------|
| **Vested** | ≤ 280,000 | Early mining rewards, fully vested |
| **Unvested** | > 280,000 | Recent mining rewards, subject to vesting rules |

### 2.2 Core Constants

```typescript
// constants.ts
export const VESTING_THRESHOLD = 280000;  // Block height cutoff
export type VestingMode = "all" | "vested" | "unvested";
```

### 2.3 Vesting Classifier Module

Create `src/components/wallet/L1/sdk/vesting.ts`:

```typescript
import { getTransaction } from "./network";

export const VESTING_THRESHOLD = 280000;

interface VestingCacheEntry {
  blockHeight: number;
  isCoinbase: boolean;
  inputTxId: string | null;
  timestamp: number;
}

interface ClassificationResult {
  isVested: boolean;
  coinbaseHeight: number | null;
  error?: string;
}

interface UTXO {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
  vestingStatus?: "vested" | "unvested" | "error";
  coinbaseHeight?: number | null;
}

class VestingClassifier {
  private memoryCache = new Map<string, VestingCacheEntry>();
  private dbName = "SphereVestingCache";
  private storeName = "vestingCache";
  private db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB for persistent caching
   */
  async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "txHash" });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Classify a single UTXO as vested or unvested
   */
  async classifyUtxo(utxo: UTXO): Promise<ClassificationResult> {
    try {
      const result = await this.traceToOrigin(utxo.tx_hash);

      if (result.coinbaseHeight === null) {
        return { isVested: false, coinbaseHeight: null, error: "Could not trace to origin" };
      }

      return {
        isVested: result.coinbaseHeight <= VESTING_THRESHOLD,
        coinbaseHeight: result.coinbaseHeight,
      };
    } catch (error) {
      return {
        isVested: false,
        coinbaseHeight: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Trace a transaction back to its coinbase origin
   * Alpha blockchain has single-input transactions, making this a linear trace
   */
  async traceToOrigin(txHash: string): Promise<{ coinbaseHeight: number | null }> {
    const MAX_ITERATIONS = 10000;
    let currentTxHash = txHash;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Check memory cache
      const cached = this.memoryCache.get(currentTxHash);
      if (cached) {
        if (cached.isCoinbase) {
          return { coinbaseHeight: cached.blockHeight };
        }
        if (cached.inputTxId) {
          currentTxHash = cached.inputTxId;
          continue;
        }
      }

      // Check IndexedDB cache
      const dbCached = await this.loadFromDB(currentTxHash);
      if (dbCached) {
        this.memoryCache.set(currentTxHash, dbCached);
        if (dbCached.isCoinbase) {
          return { coinbaseHeight: dbCached.blockHeight };
        }
        if (dbCached.inputTxId) {
          currentTxHash = dbCached.inputTxId;
          continue;
        }
      }

      // Fetch from network
      const txData = await getTransaction(currentTxHash);
      if (!txData) {
        return { coinbaseHeight: null };
      }

      const isCoinbase = this.isCoinbaseTransaction(txData);
      const entry: VestingCacheEntry = {
        blockHeight: txData.height || 0,
        isCoinbase,
        inputTxId: isCoinbase ? null : txData.vin?.[0]?.txid || null,
        timestamp: Date.now(),
      };

      // Cache the result
      this.memoryCache.set(currentTxHash, entry);
      await this.saveToDB(currentTxHash, entry);

      if (isCoinbase) {
        return { coinbaseHeight: entry.blockHeight };
      }

      if (entry.inputTxId) {
        currentTxHash = entry.inputTxId;
      } else {
        return { coinbaseHeight: null };
      }
    }

    console.warn(`Max iterations reached tracing ${txHash}`);
    return { coinbaseHeight: null };
  }

  /**
   * Check if a transaction is a coinbase transaction
   */
  private isCoinbaseTransaction(txData: any): boolean {
    if (!txData.vin || txData.vin.length !== 1) return false;

    const vin = txData.vin[0];
    return (
      vin.coinbase !== undefined ||
      vin.txid === undefined ||
      vin.txid === "0000000000000000000000000000000000000000000000000000000000000000"
    );
  }

  /**
   * Batch classify multiple UTXOs with progress callback
   */
  async classifyUtxos(
    utxos: UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    vested: UTXO[];
    unvested: UTXO[];
    errors: Array<{ utxo: UTXO; error: string }>;
  }> {
    const vested: UTXO[] = [];
    const unvested: UTXO[] = [];
    const errors: Array<{ utxo: UTXO; error: string }> = [];

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const result = await this.classifyUtxo(utxo);

      if (result.error) {
        errors.push({ utxo, error: result.error });
        // Default to unvested on error for safety
        unvested.push({
          ...utxo,
          vestingStatus: "error",
          coinbaseHeight: null,
        });
      } else if (result.isVested) {
        vested.push({
          ...utxo,
          vestingStatus: "vested",
          coinbaseHeight: result.coinbaseHeight,
        });
      } else {
        unvested.push({
          ...utxo,
          vestingStatus: "unvested",
          coinbaseHeight: result.coinbaseHeight,
        });
      }

      // Report progress and yield to UI
      if (onProgress && i % 5 === 0) {
        onProgress(i + 1, utxos.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (onProgress) {
      onProgress(utxos.length, utxos.length);
    }

    return { vested, unvested, errors };
  }

  /**
   * Load cached entry from IndexedDB
   */
  private async loadFromDB(txHash: string): Promise<VestingCacheEntry | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(txHash);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Save cache entry to IndexedDB
   */
  private async saveToDB(txHash: string, entry: VestingCacheEntry): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      store.put({ txHash, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.memoryCache.clear();
    if (this.db) {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).clear();
    }
  }
}

export const vestingClassifier = new VestingClassifier();
```

### 2.4 Vesting State Management

Create `src/components/wallet/L1/sdk/vestingState.ts`:

```typescript
import { vestingClassifier, VESTING_THRESHOLD } from "./vesting";
import type { VestingMode } from "./types";

interface AddressVestingCache {
  classifiedUtxos: {
    vested: UTXO[];
    unvested: UTXO[];
    all: UTXO[];
  };
  vestingBalances: {
    vested: bigint;
    unvested: bigint;
    all: bigint;
  };
}

class VestingStateManager {
  private currentMode: VestingMode = "all";
  private addressCache = new Map<string, AddressVestingCache>();
  private classificationInProgress = false;

  /**
   * Set the current vesting mode
   */
  setMode(mode: VestingMode): void {
    if (!["all", "vested", "unvested"].includes(mode)) {
      throw new Error(`Invalid vesting mode: ${mode}`);
    }
    this.currentMode = mode;
  }

  getMode(): VestingMode {
    return this.currentMode;
  }

  /**
   * Classify all UTXOs for an address
   */
  async classifyAddressUtxos(
    address: string,
    utxos: UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    if (this.classificationInProgress) return;

    this.classificationInProgress = true;

    try {
      await vestingClassifier.initDB();

      const result = await vestingClassifier.classifyUtxos(utxos, onProgress);

      // Calculate balances
      const vestedBalance = result.vested.reduce(
        (sum, utxo) => sum + BigInt(utxo.value),
        0n
      );
      const unvestedBalance = result.unvested.reduce(
        (sum, utxo) => sum + BigInt(utxo.value),
        0n
      );

      // Store in cache
      this.addressCache.set(address, {
        classifiedUtxos: {
          vested: result.vested,
          unvested: result.unvested,
          all: [...result.vested, ...result.unvested],
        },
        vestingBalances: {
          vested: vestedBalance,
          unvested: unvestedBalance,
          all: vestedBalance + unvestedBalance,
        },
      });

      // Log any errors
      if (result.errors.length > 0) {
        console.warn(`Vesting classification errors: ${result.errors.length}`);
        result.errors.slice(0, 5).forEach((err) => {
          console.warn(`  ${err.utxo.tx_hash}: ${err.error}`);
        });
      }
    } finally {
      this.classificationInProgress = false;
    }
  }

  /**
   * Get filtered UTXOs based on current vesting mode
   */
  getFilteredUtxos(address: string): UTXO[] {
    const cache = this.addressCache.get(address);
    if (!cache) return [];

    switch (this.currentMode) {
      case "vested":
        return cache.classifiedUtxos.vested;
      case "unvested":
        return cache.classifiedUtxos.unvested;
      default:
        return cache.classifiedUtxos.all;
    }
  }

  /**
   * Get balance for current vesting mode
   */
  getBalance(address: string): bigint {
    const cache = this.addressCache.get(address);
    if (!cache) return 0n;

    return cache.vestingBalances[this.currentMode];
  }

  /**
   * Get all balances for display
   */
  getAllBalances(address: string): {
    vested: bigint;
    unvested: bigint;
    all: bigint;
  } {
    const cache = this.addressCache.get(address);
    if (!cache) {
      return { vested: 0n, unvested: 0n, all: 0n };
    }
    return cache.vestingBalances;
  }

  /**
   * Check if classification is in progress
   */
  isClassifying(): boolean {
    return this.classificationInProgress;
  }

  /**
   * Clear cache for an address
   */
  clearAddressCache(address: string): void {
    this.addressCache.delete(address);
  }
}

export const vestingState = new VestingStateManager();
```

### 2.5 React UI Components

Create `src/components/wallet/L1/VestingSelector.tsx`:

```tsx
import React from "react";
import { vestingState } from "./sdk/vestingState";
import type { VestingMode } from "./sdk/types";

interface VestingSelectorProps {
  address: string;
  onModeChange?: (mode: VestingMode) => void;
  classificationProgress?: { current: number; total: number } | null;
}

export const VestingSelector: React.FC<VestingSelectorProps> = ({
  address,
  onModeChange,
  classificationProgress,
}) => {
  const [mode, setMode] = React.useState<VestingMode>(vestingState.getMode());
  const balances = vestingState.getAllBalances(address);

  const handleModeChange = (newMode: VestingMode) => {
    vestingState.setMode(newMode);
    setMode(newMode);
    onModeChange?.(newMode);
  };

  const formatBalance = (satoshis: bigint): string => {
    const alpha = Number(satoshis) / 100000000;
    return alpha.toFixed(8) + " ALPHA";
  };

  return (
    <div className="vesting-selector">
      {/* All coins */}
      <div className={`vesting-row ${mode === "all" ? "selected" : ""}`}>
        <label>
          <input
            type="radio"
            name="vestingMode"
            value="all"
            checked={mode === "all"}
            onChange={() => handleModeChange("all")}
          />
          <span className="mode-label">All:</span>
        </label>
        <span className="balance">{formatBalance(balances.all)}</span>
      </div>

      {/* Vested coins */}
      <div className={`vesting-row vested ${mode === "vested" ? "selected" : ""}`}>
        <label>
          <input
            type="radio"
            name="vestingMode"
            value="vested"
            checked={mode === "vested"}
            onChange={() => handleModeChange("vested")}
          />
          <span className="mode-label vested-color">Vested:</span>
        </label>
        <span className="balance vested-color">{formatBalance(balances.vested)}</span>
      </div>

      {/* Unvested coins */}
      <div className={`vesting-row unvested ${mode === "unvested" ? "selected" : ""}`}>
        <label>
          <input
            type="radio"
            name="vestingMode"
            value="unvested"
            checked={mode === "unvested"}
            onChange={() => handleModeChange("unvested")}
          />
          <span className="mode-label unvested-color">Unvested:</span>
        </label>
        <span className="balance unvested-color">{formatBalance(balances.unvested)}</span>
      </div>

      {/* Classification progress */}
      {classificationProgress && (
        <div className="classification-progress">
          Classifying coins... {classificationProgress.current}/{classificationProgress.total}
        </div>
      )}
    </div>
  );
};
```

### 2.6 CSS Styling

```css
.vesting-selector {
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-secondary);
}

.vesting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 4px;
}

.vesting-row.selected {
  background: var(--bg-selected);
}

.vesting-row label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.mode-label {
  font-weight: 500;
}

.balance {
  font-family: monospace;
}

/* Color coding */
.vested-color {
  color: #4CAF50;  /* Green */
}

.unvested-color {
  color: #FF9800;  /* Orange */
}

.vesting-row.vested.selected {
  background: rgba(76, 175, 80, 0.1);
}

.vesting-row.unvested.selected {
  background: rgba(255, 152, 0, 0.1);
}

.classification-progress {
  text-align: center;
  padding: 8px;
  color: var(--text-secondary);
  font-size: 0.9em;
}
```

### 2.7 Transaction Integration

When creating transactions, filter UTXOs by vesting mode:

```typescript
// In transaction creation code
async function prepareSendTransaction(
  address: string,
  recipientAddress: string,
  amount: bigint,
  feePerUtxo: bigint = 10000n
): Promise<TransactionPlan> {

  // Get UTXOs filtered by current vesting mode
  const availableUtxos = vestingState.getFilteredUtxos(address);

  console.log(`Using ${availableUtxos.length} UTXOs (mode: ${vestingState.getMode()})`);

  // Sort by value ascending for optimal UTXO selection
  const sortedUtxos = [...availableUtxos].sort((a, b) => a.value - b.value);

  // Collect UTXOs until we have enough
  let totalInput = 0n;
  const selectedUtxos: UTXO[] = [];

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    totalInput += BigInt(utxo.value);

    const fee = BigInt(selectedUtxos.length) * feePerUtxo;
    if (totalInput >= amount + fee) {
      break;
    }
  }

  const fee = BigInt(selectedUtxos.length) * feePerUtxo;

  if (totalInput < amount + fee) {
    throw new Error(
      `Insufficient ${vestingState.getMode()} balance. ` +
      `Available: ${totalInput}, Required: ${amount + fee}`
    );
  }

  return {
    inputs: selectedUtxos,
    outputs: [
      { address: recipientAddress, value: amount },
      // Change output if needed
      ...(totalInput > amount + fee
        ? [{ address, value: totalInput - amount - fee }]
        : []),
    ],
    fee,
    vestingMode: vestingState.getMode(),
  };
}
```

### 2.8 Network Integration

Add transaction fetching to `network.ts`:

```typescript
/**
 * Get full transaction data from Fulcrum
 */
export async function getTransaction(txHash: string): Promise<any> {
  const response = await sendRpcRequest("blockchain.transaction.get", [txHash, true]);
  return response;
}
```

---

## Summary

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `sdk/address.ts` | **Replace** | Standard BIP32 derivation |
| `sdk/wallet.ts` | **Modify** | Use BIP32 master key generation |
| `sdk/types.ts` | **Modify** | Add `VestingMode` type |
| `sdk/vesting.ts` | **Create** | Vesting classifier module |
| `sdk/vestingState.ts` | **Create** | Vesting state management |
| `sdk/network.ts` | **Modify** | Add `getTransaction()` function |
| `VestingSelector.tsx` | **Create** | React vesting mode UI |
| `styles/vesting.css` | **Create** | Vesting UI styling |

### Key Constants

```typescript
// BIP32
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const BIP44_PATH = "m/44'/0'/0'";

// Vesting
const VESTING_THRESHOLD = 280000;
const SATOSHI_PER_ALPHA = 100000000n;
```

### Testing Checklist

- [ ] BIP32 derivation produces correct addresses
- [ ] Vesting classification traces to coinbase correctly
- [ ] Vesting cache persists across sessions
- [ ] Transaction creation respects vesting mode
- [ ] UI shows correct balances per mode
- [ ] Error handling for classification failures
