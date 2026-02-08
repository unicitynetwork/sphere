# Sphere-SDK Integration Plan

## Overview

Integration of local `sphere-sdk` into the Sphere project to replace current L1/L3 wallet implementations.

**SDK Location:** `/home/linux/unicitynetwork/sphere-sdk`
**SDK Version:** 0.1.8

---

## Table of Contents

1. [Project Preparation](#phase-1-project-preparation)
2. [SDK Constants](#sdk-constants)
3. [Cleanup - Remove Legacy Code](#phase-2-cleanup---remove-legacy-code)
4. [SDK Adapter Layer](#phase-3-sdk-adapter-layer)
5. [Query Keys Design](#query-keys-design)
6. [React Hooks Design](#react-hooks-design)
7. [Component Migration](#phase-6-component-migration)
8. [Execution Order](#execution-order)

---

## Phase 1: Project Preparation

### 1.1 Link SDK Locally

Add to `package.json`:
```json
{
  "dependencies": {
    "@unicitylabs/sphere-sdk": "file:../sphere-sdk"
  }
}
```

Then run:
```bash
npm install
```

### 1.2 Remove IPFS Dependencies (Temporarily)

Remove from `package.json` for now:
```
- @helia/ipns
- @helia/json
- helia
- @noble/ed25519 (if only used for IPFS)
```

> **Note:** Helia is an **optional peer dependency** in sphere-sdk. When IPFS support
> is implemented in SDK, we'll add helia back to sphere's dependencies. The SDK will
> automatically detect and use it.

---

## SDK Constants

SDK provides all network/wallet constants. Most current configs will be deleted.

### Constants from SDK (use directly)

```typescript
import {
  // Storage
  STORAGE_PREFIX,              // 'sphere_'
  STORAGE_KEYS_GLOBAL,         // { MNEMONIC, MASTER_KEY, CHAIN_CODE, ... }
  STORAGE_KEYS_ADDRESS,        // { PENDING_TRANSFERS, OUTBOX, CONVERSATIONS, ... }
  getAddressStorageKey,        // (addressId, key) => string
  getAddressId,                // (directAddress) => 'DIRECT_xxx_yyy'

  // Nostr
  DEFAULT_NOSTR_RELAYS,        // ['wss://relay.unicity.network', ...]
  TEST_NOSTR_RELAYS,           // ['wss://nostr-relay.testnet.unicity.network']
  NOSTR_EVENT_KINDS,           // { DIRECT_MESSAGE: 4, TOKEN_TRANSFER: 31113, ... }

  // Aggregator (Oracle)
  DEFAULT_AGGREGATOR_URL,      // 'https://aggregator.unicity.network/rpc'
  DEV_AGGREGATOR_URL,          // 'https://dev-aggregator.dyndns.org/rpc'
  TEST_AGGREGATOR_URL,         // 'https://goggregator-test.unicity.network'
  DEFAULT_AGGREGATOR_TIMEOUT,  // 30000
  DEFAULT_AGGREGATOR_API_KEY,  // 'sk_...'

  // IPFS (for future use)
  DEFAULT_IPFS_GATEWAYS,       // ['https://ipfs.unicity.network', ...]
  DEFAULT_IPFS_BOOTSTRAP_PEERS,

  // Wallet
  DEFAULT_BASE_PATH,           // "m/44'/0'/0'"
  DEFAULT_DERIVATION_PATH,     // "m/44'/0'/0'/0/0"
  COIN_TYPES,                  // { ALPHA: 'ALPHA', TEST: 'TEST' }

  // L1 (Electrum)
  DEFAULT_ELECTRUM_URL,        // 'wss://fulcrum.alpha.unicity.network:50004'
  TEST_ELECTRUM_URL,           // 'wss://fulcrum.alpha.testnet.unicity.network:50004'

  // Networks (presets)
  NETWORKS,                    // { mainnet: {...}, testnet: {...}, dev: {...} }

  // Timeouts & Limits
  TIMEOUTS,                    // { WEBSOCKET_CONNECT, NOSTR_RECONNECT_DELAY, ... }
  LIMITS,                      // { NAMETAG_MIN_LENGTH, NAMETAG_MAX_LENGTH, ... }
} from '@unicitylabs/sphere-sdk';
```

### Config files to DELETE (replaced by SDK)

```
src/config/nostr.config.ts      → SDK: DEFAULT_NOSTR_RELAYS, NOSTR_EVENT_KINDS
src/config/ipfs.config.ts       → SDK: DEFAULT_IPFS_GATEWAYS, DEFAULT_IPFS_BOOTSTRAP_PEERS
src/config/nostrPin.config.ts   → SDK handles internally
```

### Config files to KEEP (app-specific)

```
src/config/queryKeys.ts         → REPLACE with src/sdk/queryKeys.ts (new SPHERE_KEYS)
src/config/storageKeys.ts       → SIMPLIFY (keep only app-specific keys)
src/config/activities.ts        → Keep (agent UI config)
src/config/groupChat.config.ts  → Keep (NIP-29 group chat)
```

### Simplified storageKeys.ts (after cleanup)

```typescript
// src/config/storageKeys.ts (simplified)

// Re-export SDK storage constants
export {
  STORAGE_PREFIX,
  STORAGE_KEYS_GLOBAL,
  STORAGE_KEYS_ADDRESS,
  getAddressStorageKey,
  getAddressId,
} from '@unicitylabs/sphere-sdk';

// App-specific keys (not in SDK)
export const APP_STORAGE_KEYS = {
  // Theme & UI
  THEME: 'sphere_theme',
  WALLET_ACTIVE_LAYER: 'sphere_wallet_active_layer',
  WELCOME_ACCEPTED: 'sphere_welcome_accepted',

  // Onboarding state
  AUTHENTICATED: 'sphere_authenticated',
  ONBOARDING_IN_PROGRESS: 'sphere_onboarding_in_progress',
  ONBOARDING_COMPLETE: 'sphere_onboarding_complete',

  // Chat (DMs)
  CHAT_CONVERSATIONS: 'sphere_chat_conversations',
  CHAT_MESSAGES: 'sphere_chat_messages',
  CHAT_MODE: 'sphere_chat_mode',
  CHAT_SELECTED_GROUP: 'sphere_chat_selected_group',
  CHAT_SELECTED_DM: 'sphere_chat_selected_dm',

  // Group Chat (NIP-29)
  GROUP_CHAT_GROUPS: 'sphere_group_chat_groups',
  GROUP_CHAT_MESSAGES: 'sphere_group_chat_messages',
  GROUP_CHAT_MEMBERS: 'sphere_group_chat_members',
  GROUP_CHAT_RELAY_URL: 'sphere_group_chat_relay_url',

  // Agent Chat
  AGENT_CHAT_SESSIONS: 'sphere_agent_chat_sessions',
  AGENT_CHAT_TOMBSTONES: 'sphere_agent_chat_tombstones',

  // Dev settings
  DEV_AGGREGATOR_URL: 'sphere_dev_aggregator_url',
  DEV_SKIP_TRUST_BASE: 'sphere_dev_skip_trust_base',
} as const;

export const APP_STORAGE_KEY_GENERATORS = {
  agentMemory: (userId: string, activityId: string) =>
    `sphere_agent_memory:${userId}:${activityId}` as const,
  agentChatMessages: (sessionId: string) =>
    `sphere_agent_chat_messages:${sessionId}` as const,
} as const;
```

### 1.3 Remove IPFS Files

**Full removal (11 files):**
```
src/components/wallet/L3/services/IpfsStorageService.ts
src/components/wallet/L3/services/IpfsHttpResolver.ts
src/components/wallet/L3/services/IpfsPublisher.ts
src/components/wallet/L3/services/IpfsMetrics.ts
src/components/wallet/L3/services/IpfsCache.ts
src/components/wallet/L3/services/IpnsUtils.ts
src/components/wallet/L3/services/IpnsNametagFetcher.ts
src/components/wallet/L3/services/types/IpfsTransport.ts
src/components/wallet/L3/hooks/useIpfsStorage.ts
src/components/agents/shared/ChatHistoryIpfsService.ts
src/config/ipfs.config.ts
```

---

## Phase 2: Cleanup - Remove Legacy Code

### 2.1 Remove Legacy L3 Services

**Services replaced by SDK (delete these):**
```
src/components/wallet/L3/services/ServiceProvider.ts
src/components/wallet/L3/services/IdentityManager.ts
src/components/wallet/L3/services/NostrService.ts
src/components/wallet/L3/services/NametagService.ts
src/components/wallet/L3/services/RegistryService.ts
src/components/wallet/L3/services/TokenValidationService.ts
src/components/wallet/L3/services/transfer/TokenSplitCalculator.ts
src/components/wallet/L3/services/transfer/TokenSplitExecutor.ts
src/components/wallet/L3/services/TxfSerializer.ts
src/components/wallet/L3/services/TokenBackupService.ts
src/components/wallet/L3/services/TokenRecoveryService.ts
src/components/wallet/L3/services/OutboxRecoveryService.ts
src/components/wallet/L3/services/NostrPinPublisher.ts
src/components/wallet/L3/services/InventorySyncService.ts
src/components/wallet/L3/services/SyncCoordinator.ts
src/components/wallet/L3/services/SyncQueue.ts
src/components/wallet/L3/services/ConflictResolutionService.ts
src/components/wallet/L3/services/InventoryBackgroundLoops.ts
src/components/wallet/L3/services/utils/SyncModeDetector.ts
```

**Keep:**
```
src/components/wallet/L3/services/FaucetService.ts  → Keep (faucet API)
src/components/wallet/L3/services/api.ts            → Keep (agent API)
```

**Types to remove:**
```
src/components/wallet/L3/services/types/OutboxTypes.ts
src/components/wallet/L3/services/types/TxfSchemas.ts
src/components/wallet/L3/services/types/TxfTypes.ts
src/components/wallet/L3/services/types/QueueTypes.ts
```

### 2.2 Remove Legacy L1 SDK

**Remove entire directory (16 files):**
```
src/components/wallet/L1/sdk/
```

### 2.3 Remove Shared Services

```
src/components/wallet/shared/services/UnifiedKeyManager.ts
src/repositories/WalletRepository.ts
src/repositories/OutboxRepository.ts
```

### 2.4 Remove Legacy Hooks

```
src/components/wallet/L3/hooks/useWallet.ts
src/components/wallet/L3/hooks/useInventorySync.ts
src/components/wallet/L3/hooks/useTransactionHistory.ts
src/components/wallet/L1/hooks/useL1Wallet.ts
```

---

## Phase 3: SDK Adapter Layer

### 3.1 Directory Structure (mirrors SDK modules)

```
src/sdk/
├── index.ts                        # Public exports
├── SphereProvider.tsx              # React Context + TanStack Query integration
├── config.ts                       # SDK configuration
├── queryKeys.ts                    # TanStack Query keys
├── types.ts                        # Re-export SDK types + UI types
│
├── hooks/
│   ├── index.ts                    # All hook exports
│   │
│   ├── core/                       # Core wallet hooks
│   │   ├── useSphere.ts            # Access Sphere instance
│   │   ├── useWalletStatus.ts      # Loading/exists state
│   │   ├── useIdentity.ts          # Current identity
│   │   ├── useNametag.ts           # Nametag operations
│   │   └── useSphereEvents.ts      # SDK event subscriptions
│   │
│   ├── payments/                   # L3 payments hooks
│   │   ├── useTokens.ts            # Token list
│   │   ├── useBalance.ts           # Balance by coinId
│   │   ├── useAssets.ts            # Aggregated assets
│   │   ├── useTransfer.ts          # Send tokens mutation
│   │   └── useTransactionHistory.ts
│   │
│   └── l1/                         # L1 (ALPHA) hooks
│       ├── useL1Balance.ts         # L1 balance + vesting
│       ├── useL1Utxos.ts           # UTXOs
│       ├── useL1Send.ts            # L1 send mutation
│       └── useL1Transactions.ts    # L1 tx history
│
└── utils/
    ├── format.ts                   # Amount formatting
    └── queryHelpers.ts             # Query invalidation helpers
```

---

## Query Keys Design

```typescript
// src/sdk/queryKeys.ts

export const SPHERE_KEYS = {
  // ─────────────────────────────────────────────────────────────
  // Root
  // ─────────────────────────────────────────────────────────────
  all: ['sphere'] as const,

  // ─────────────────────────────────────────────────────────────
  // Core / Wallet
  // ─────────────────────────────────────────────────────────────
  wallet: {
    all:    ['sphere', 'wallet'] as const,
    exists: ['sphere', 'wallet', 'exists'] as const,
    status: ['sphere', 'wallet', 'status'] as const,
  },

  identity: {
    all:       ['sphere', 'identity'] as const,
    current:   ['sphere', 'identity', 'current'] as const,
    nametag:   ['sphere', 'identity', 'nametag'] as const,
    addresses: ['sphere', 'identity', 'addresses'] as const,
  },

  // ─────────────────────────────────────────────────────────────
  // Payments (L3)
  // ─────────────────────────────────────────────────────────────
  payments: {
    all: ['sphere', 'payments'] as const,

    tokens: {
      all:    ['sphere', 'payments', 'tokens'] as const,
      list:   ['sphere', 'payments', 'tokens', 'list'] as const,
      byId:   (id: string) => ['sphere', 'payments', 'tokens', id] as const,
    },

    balance: {
      all:    ['sphere', 'payments', 'balance'] as const,
      byCoin: (coinId: string) => ['sphere', 'payments', 'balance', coinId] as const,
      total:  ['sphere', 'payments', 'balance', 'total'] as const,
    },

    assets: {
      all:  ['sphere', 'payments', 'assets'] as const,
      list: ['sphere', 'payments', 'assets', 'list'] as const,
    },

    transactions: {
      all:     ['sphere', 'payments', 'transactions'] as const,
      history: ['sphere', 'payments', 'transactions', 'history'] as const,
      pending: ['sphere', 'payments', 'transactions', 'pending'] as const,
    },
  },

  // ─────────────────────────────────────────────────────────────
  // L1 (ALPHA blockchain)
  // ─────────────────────────────────────────────────────────────
  l1: {
    all:          ['sphere', 'l1'] as const,
    balance:      ['sphere', 'l1', 'balance'] as const,
    utxos:        ['sphere', 'l1', 'utxos'] as const,
    transactions: ['sphere', 'l1', 'transactions'] as const,
    vesting:      ['sphere', 'l1', 'vesting'] as const,
    blockHeight:  ['sphere', 'l1', 'blockHeight'] as const,
  },

  // ─────────────────────────────────────────────────────────────
  // Market data
  // ─────────────────────────────────────────────────────────────
  market: {
    all:      ['sphere', 'market'] as const,
    prices:   ['sphere', 'market', 'prices'] as const,
    registry: ['sphere', 'market', 'registry'] as const,
  },
} as const;

// Type helper
export type SphereQueryKey = typeof SPHERE_KEYS;
```

### Query Key Migration Table

| Old Key | New Key |
|---------|---------|
| `['wallet', 'identity']` | `SPHERE_KEYS.identity.current` |
| `['wallet', 'nametag']` | `SPHERE_KEYS.identity.nametag` |
| `['wallet', 'tokens']` | `SPHERE_KEYS.payments.tokens.list` |
| `['wallet', 'aggregated']` | `SPHERE_KEYS.payments.assets.list` |
| `['wallet', 'transaction-history']` | `SPHERE_KEYS.payments.transactions.history` |
| `['l1', 'wallet']` | `SPHERE_KEYS.wallet.status` |
| `['l1', 'balance', addr]` | `SPHERE_KEYS.l1.balance` |
| `['l1', 'vesting', addr]` | `SPHERE_KEYS.l1.vesting` |
| `['l1', 'transactions', addr]` | `SPHERE_KEYS.l1.transactions` |
| `['market', 'prices']` | `SPHERE_KEYS.market.prices` |
| `['market', 'registry']` | `SPHERE_KEYS.market.registry` |

---

## React Hooks Design

### Core Hooks

#### `useSphereContext` / `useSphere`

```typescript
// src/sdk/hooks/core/useSphere.ts

// Full context access
export function useSphereContext(): SphereContextValue {
  const context = useContext(SphereContext);
  if (!context) {
    throw new Error('useSphereContext must be used within SphereProvider');
  }
  return context;
}

// Just the Sphere instance (throws if not initialized)
export function useSphere(): Sphere {
  const { sphere } = useSphereContext();
  if (!sphere) {
    throw new Error('Wallet not initialized');
  }
  return sphere;
}
```

#### `useWalletStatus`

```typescript
// src/sdk/hooks/core/useWalletStatus.ts

interface WalletStatus {
  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;
}

export function useWalletStatus(): WalletStatus;
```

#### `useIdentity`

```typescript
// src/sdk/hooks/core/useIdentity.ts

interface UseIdentityReturn {
  // Data
  identity: Identity | null;
  isLoading: boolean;
  error: Error | null;

  // Computed helpers
  directAddress: string | null;
  l1Address: string | null;
  nametag: string | null;
  displayName: string;        // @nametag or truncated address
  shortAddress: string;       // First 8 chars of directAddress
}

export function useIdentity(): UseIdentityReturn;

// Query key: SPHERE_KEYS.identity.current
// Stale time: Infinity
```

#### `useNametag`

```typescript
// src/sdk/hooks/core/useNametag.ts

interface UseNametagReturn {
  // Current nametag
  nametag: string | null;
  isLoading: boolean;

  // Register mutation
  register: (name: string) => Promise<void>;
  isRegistering: boolean;
  registerError: Error | null;

  // Resolve helper
  resolve: (name: string) => Promise<string | null>;
}

export function useNametag(): UseNametagReturn;

// Query key: SPHERE_KEYS.identity.nametag
```

---

### Payments Hooks (L3)

#### `useTokens`

```typescript
// src/sdk/hooks/payments/useTokens.ts

interface UseTokensReturn {
  tokens: Token[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  // Computed
  tokenCount: number;
  hasTokens: boolean;

  // Filters
  confirmedTokens: Token[];
  pendingTokens: Token[];
}

export function useTokens(): UseTokensReturn;

// Query key: SPHERE_KEYS.payments.tokens.list
// Stale time: Infinity (invalidated by events)
```

#### `useBalance`

```typescript
// src/sdk/hooks/payments/useBalance.ts

interface UseBalanceReturn {
  balance: TokenBalance | null;
  isLoading: boolean;
  error: Error | null;

  // Formatted strings (human readable)
  total: string;
  confirmed: string;
  unconfirmed: string;

  // Raw amounts (smallest units)
  totalRaw: string;
  confirmedRaw: string;
  unconfirmedRaw: string;
}

export function useBalance(coinId?: string): UseBalanceReturn;

// Query key: SPHERE_KEYS.payments.balance.byCoin(coinId)
// Default coinId: 'ALPHA'
```

#### `useAssets`

```typescript
// src/sdk/hooks/payments/useAssets.ts

interface UseAssetsReturn {
  assets: Asset[];
  isLoading: boolean;
  error: Error | null;

  // Computed
  assetCount: number;
  totalValueUsd: string;
}

export function useAssets(): UseAssetsReturn;

// Query key: SPHERE_KEYS.payments.assets.list
```

#### `useTransfer`

```typescript
// src/sdk/hooks/payments/useTransfer.ts

interface TransferParams {
  coinId: string;
  amount: string;
  recipient: string;    // @nametag or DIRECT://...
  memo?: string;
}

interface UseTransferReturn {
  // Mutation
  transfer: (params: TransferParams) => Promise<TransferResult>;
  isLoading: boolean;
  error: Error | null;

  // Last result
  lastResult: TransferResult | null;
  reset: () => void;
}

export function useTransfer(): UseTransferReturn;

// Invalidates on success:
//   - SPHERE_KEYS.payments.tokens.all
//   - SPHERE_KEYS.payments.balance.all
//   - SPHERE_KEYS.payments.assets.all
//   - SPHERE_KEYS.payments.transactions.all
```

#### `useTransactionHistory`

```typescript
// src/sdk/hooks/payments/useTransactionHistory.ts

interface Transaction {
  id: string;
  type: 'incoming' | 'outgoing';
  coinId: string;
  symbol: string;
  amount: string;
  counterparty: string;     // nametag or address
  timestamp: number;
  status: 'completed' | 'pending' | 'failed';
  memo?: string;
}

interface UseTransactionHistoryReturn {
  transactions: Transaction[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  // Filters
  incoming: Transaction[];
  outgoing: Transaction[];
}

export function useTransactionHistory(): UseTransactionHistoryReturn;

// Query key: SPHERE_KEYS.payments.transactions.history
// Stale time: 30_000
```

---

### L1 Hooks

#### `useL1Balance`

```typescript
// src/sdk/hooks/l1/useL1Balance.ts

interface L1BalanceData {
  confirmed: string;
  unconfirmed: string;
  total: string;
  vested: string;
  unvested: string;
}

interface UseL1BalanceReturn {
  balance: L1BalanceData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  // Formatted
  totalFormatted: string;
  vestedFormatted: string;
  unvestedFormatted: string;
}

export function useL1Balance(): UseL1BalanceReturn;

// Query key: SPHERE_KEYS.l1.balance
// Stale time: 30_000
// Refetch interval: 60_000
```

#### `useL1Utxos`

```typescript
// src/sdk/hooks/l1/useL1Utxos.ts

interface Utxo {
  txid: string;
  vout: number;
  value: string;
  address: string;
  isVested: boolean;
}

interface UseL1UtxosReturn {
  utxos: Utxo[];
  isLoading: boolean;
  error: Error | null;

  // Computed
  utxoCount: number;
  vestedUtxos: Utxo[];
  unvestedUtxos: Utxo[];
}

export function useL1Utxos(): UseL1UtxosReturn;

// Query key: SPHERE_KEYS.l1.utxos
```

#### `useL1Send`

```typescript
// src/sdk/hooks/l1/useL1Send.ts

interface L1SendParams {
  toAddress: string;
  amount: string;
  feeRate?: number;
  useVested?: boolean;
}

interface L1SendResult {
  txHash: string;
  fee: string;
}

interface UseL1SendReturn {
  send: (params: L1SendParams) => Promise<L1SendResult>;
  isLoading: boolean;
  error: Error | null;
  lastResult: L1SendResult | null;
}

export function useL1Send(): UseL1SendReturn;

// Invalidates on success:
//   - SPHERE_KEYS.l1.all
```

#### `useL1Transactions`

```typescript
// src/sdk/hooks/l1/useL1Transactions.ts

interface L1Transaction {
  txid: string;
  type: 'incoming' | 'outgoing';
  amount: string;
  fee: string;
  confirmations: number;
  timestamp: number;
  address: string;
}

interface UseL1TransactionsReturn {
  transactions: L1Transaction[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useL1Transactions(): UseL1TransactionsReturn;

// Query key: SPHERE_KEYS.l1.transactions
// Stale time: 30_000
```

---

### Event Handling

```typescript
// src/sdk/hooks/core/useSphereEvents.ts

export function useSphereEvents(): void {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sphere) return;

    const handleIncomingTransfer = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.tokens.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.balance.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.transactions.all });
    };

    const handleTransferConfirmed = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.tokens.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.balance.all });
    };

    const handleNametagChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    };

    const handleIdentityChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
    };

    sphere.on('transfer:incoming', handleIncomingTransfer);
    sphere.on('transfer:confirmed', handleTransferConfirmed);
    sphere.on('nametag:registered', handleNametagChange);
    sphere.on('nametag:recovered', handleNametagChange);
    sphere.on('identity:changed', handleIdentityChange);

    return () => {
      sphere.off('transfer:incoming', handleIncomingTransfer);
      sphere.off('transfer:confirmed', handleTransferConfirmed);
      sphere.off('nametag:registered', handleNametagChange);
      sphere.off('nametag:recovered', handleNametagChange);
      sphere.off('identity:changed', handleIdentityChange);
    };
  }, [sphere, queryClient]);
}
```

---

## Phase 4: SphereProvider

```typescript
// src/sdk/SphereProvider.tsx

import { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders, type BrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';
import type { NetworkType, Identity } from '@unicitylabs/sphere-sdk';

export interface SphereContextValue {
  // Instance
  sphere: Sphere | null;
  providers: BrowserProviders | null;

  // State
  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;

  // Wallet lifecycle
  createWallet: (options?: CreateWalletOptions) => Promise<string>;
  importWallet: (mnemonic: string, options?: ImportWalletOptions) => Promise<void>;
  deleteWallet: () => Promise<void>;

  // Re-initialization
  reinitialize: () => Promise<void>;
}

interface CreateWalletOptions {
  nametag?: string;
}

interface ImportWalletOptions {
  nametag?: string;
}

interface SphereProviderProps {
  children: ReactNode;
  network?: NetworkType;
}

const SphereContext = createContext<SphereContextValue | null>(null);

export function SphereProvider({
  children,
  network = 'testnet'
}: SphereProviderProps) {
  const [sphere, setSphere] = useState<Sphere | null>(null);
  const [providers, setProviders] = useState<BrowserProviders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialize = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const browserProviders = createBrowserProviders({ network });
      setProviders(browserProviders);

      const exists = await Sphere.exists(browserProviders.storage);
      setWalletExists(exists);

      if (exists) {
        const { sphere: instance } = await Sphere.init({
          ...browserProviders,
        });
        setSphere(instance);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [network]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const createWallet = useCallback(async (options?: CreateWalletOptions) => {
    if (!providers) throw new Error('Providers not initialized');

    const { sphere: instance, generatedMnemonic } = await Sphere.init({
      ...providers,
      autoGenerate: true,
      nametag: options?.nametag,
    });

    setSphere(instance);
    setWalletExists(true);

    if (!generatedMnemonic) {
      throw new Error('Failed to generate mnemonic');
    }

    return generatedMnemonic;
  }, [providers]);

  const importWallet = useCallback(async (
    mnemonic: string,
    options?: ImportWalletOptions
  ) => {
    if (!providers) throw new Error('Providers not initialized');

    const { sphere: instance } = await Sphere.init({
      ...providers,
      mnemonic,
      nametag: options?.nametag,
    });

    setSphere(instance);
    setWalletExists(true);
  }, [providers]);

  const deleteWallet = useCallback(async () => {
    if (sphere) {
      await sphere.destroy();
    }
    if (providers) {
      await Sphere.clear(providers.storage);
    }
    setSphere(null);
    setWalletExists(false);
  }, [sphere, providers]);

  const value: SphereContextValue = {
    sphere,
    providers,
    isLoading,
    isInitialized: !!sphere,
    walletExists,
    error,
    createWallet,
    importWallet,
    deleteWallet,
    reinitialize: initialize,
  };

  return (
    <SphereContext.Provider value={value}>
      {children}
    </SphereContext.Provider>
  );
}

export { SphereContext };
```

---

## Phase 5: Hook Exports

```typescript
// src/sdk/hooks/index.ts

// Core
export { useSphereContext, useSphere } from './core/useSphere';
export { useWalletStatus } from './core/useWalletStatus';
export { useIdentity } from './core/useIdentity';
export { useNametag } from './core/useNametag';
export { useSphereEvents } from './core/useSphereEvents';

// Payments (L3)
export { useTokens } from './payments/useTokens';
export { useBalance } from './payments/useBalance';
export { useAssets } from './payments/useAssets';
export { useTransfer } from './payments/useTransfer';
export { useTransactionHistory } from './payments/useTransactionHistory';

// L1
export { useL1Balance } from './l1/useL1Balance';
export { useL1Utxos } from './l1/useL1Utxos';
export { useL1Send } from './l1/useL1Send';
export { useL1Transactions } from './l1/useL1Transactions';
```

```typescript
// src/sdk/index.ts

// Provider
export { SphereProvider, SphereContext } from './SphereProvider';
export type { SphereContextValue } from './SphereProvider';

// Query keys
export { SPHERE_KEYS } from './queryKeys';

// All hooks
export * from './hooks';

// Re-export SDK types for convenience
export type {
  Identity,
  FullIdentity,
  Token,
  TokenBalance,
  Asset,
  TransferRequest,
  TransferResult,
  NetworkType,
} from '@unicitylabs/sphere-sdk';
```

---

## Phase 6: Component Migration

### Updated App Structure

```typescript
// src/App.tsx (simplified)

import { SphereProvider } from '@/sdk';
import { useSphereEvents } from '@/sdk';

function AppContent() {
  // Subscribe to SDK events for query invalidation
  useSphereEvents();

  return <RouterProvider router={router} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SphereProvider network="testnet">
        <AppContent />
      </SphereProvider>
    </QueryClientProvider>
  );
}
```

### Component Hook Mapping

| Component | Old Hook | New Hook |
|-----------|----------|----------|
| WalletGate | custom check | `useWalletStatus()` |
| Header | useWallet | `useIdentity()` |
| L3WalletView | useWallet | `useBalance()`, `useAssets()` |
| TokenList | useWallet.tokens | `useTokens()` |
| SendModal | useWallet.sendAmount | `useTransfer()` |
| ReceiveModal | useWallet.identity | `useIdentity()` |
| L1WalletView | useL1Wallet | `useL1Balance()` |
| L1SendModal | useL1Wallet.send | `useL1Send()` |
| TransactionHistory | useTransactionHistory | `useTransactionHistory()` |

---

## Execution Order

### Step 1: Setup
- [ ] Add `@unicitylabs/sphere-sdk": "file:../sphere-sdk"` to package.json
- [ ] `npm install`
- [ ] Remove IPFS dependencies from package.json
- [ ] Create `src/sdk/` directory structure

### Step 2: Core Adapter Layer
- [ ] Create `src/sdk/queryKeys.ts`
- [ ] Create `src/sdk/SphereProvider.tsx`
- [ ] Create `src/sdk/hooks/core/useSphere.ts`
- [ ] Create `src/sdk/hooks/core/useWalletStatus.ts`
- [ ] Create `src/sdk/hooks/core/useIdentity.ts`
- [ ] Create `src/sdk/hooks/core/useNametag.ts`
- [ ] Create `src/sdk/hooks/core/useSphereEvents.ts`

### Step 3: Payments Hooks (L3)
- [ ] Create `src/sdk/hooks/payments/useTokens.ts`
- [ ] Create `src/sdk/hooks/payments/useBalance.ts`
- [ ] Create `src/sdk/hooks/payments/useAssets.ts`
- [ ] Create `src/sdk/hooks/payments/useTransfer.ts`
- [ ] Create `src/sdk/hooks/payments/useTransactionHistory.ts`

### Step 4: L1 Hooks
- [ ] Create `src/sdk/hooks/l1/useL1Balance.ts`
- [ ] Create `src/sdk/hooks/l1/useL1Utxos.ts`
- [ ] Create `src/sdk/hooks/l1/useL1Send.ts`
- [ ] Create `src/sdk/hooks/l1/useL1Transactions.ts`

### Step 5: Exports
- [ ] Create `src/sdk/hooks/index.ts`
- [ ] Create `src/sdk/index.ts`

### Step 6: Cleanup Legacy Code
- [ ] Remove IPFS files (11 files)
- [ ] Remove L3 services (~20 files)
- [ ] Remove L1 SDK (16 files)
- [ ] Remove legacy hooks (4 files)
- [ ] Remove repositories (2 files)
- [ ] Remove UnifiedKeyManager

### Step 7: Component Migration
- [ ] Update `App.tsx` with SphereProvider
- [ ] Update `WalletGate`
- [ ] Simplify onboarding flow
- [ ] Update wallet views
- [ ] Update modals

### Step 8: Testing
- [ ] Create wallet flow
- [ ] Import wallet flow
- [ ] Token display
- [ ] Send L3 flow
- [ ] L1 operations

---

## Notes

### localStorage Cleanup for MVP

```typescript
// In SphereProvider initialization
const SDK_VERSION = '2.0.0';
const stored = localStorage.getItem('sphere_sdk_version');
if (stored !== SDK_VERSION) {
  Object.keys(localStorage)
    .filter(k => k.startsWith('sphere_'))
    .forEach(k => localStorage.removeItem(k));
  localStorage.setItem('sphere_sdk_version', SDK_VERSION);
}
```

### Dependencies to Remove After Cleanup

```
- @unicitylabs/nostr-js-sdk     → SDK includes
- @unicitylabs/state-transition-sdk → SDK includes
- bip39                          → SDK includes
- elliptic                       → SDK includes
- crypto-js                      → SDK includes
- buffer                         → SDK includes
```
