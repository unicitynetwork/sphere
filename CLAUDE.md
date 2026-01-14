# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unicity AgentSphere is a React-based cryptocurrency wallet application for the Unicity network. It provides a dual-layer wallet interface supporting both Layer 1 (ALPHA blockchain) and Layer 3 (Unicity state transition network) operations. The app integrates with multiple Unicity SDKs for token management, state transitions, and peer-to-peer transfers via Nostr.

**Stats**: ~205 TypeScript/TSX files, ~49,500 LOC, 24 test files

## Development Commands

```bash
# Start development server
npm run dev

# Build for production (runs TypeScript compiler then Vite build)
npm run build

# Lint the codebase
npm run lint

# Run all tests (watch mode)
npm run test

# Run tests once (no watch mode)
npm run test:run

# Run a single test file
npx vitest run tests/sdk/core/wallet.test.ts

# Preview production build
npm run preview

# Type check only (without building)
npx tsc --noEmit
```

## Architecture

### Tech Stack
- React 19 + TypeScript 5.9 with Vite 7
- TanStack Query v5 for server state management
- Tailwind CSS 4 for styling
- Framer Motion for animations
- React Router DOM v7 for routing
- Vitest + jsdom for testing
- Helia for IPFS/IPNS browser integration
- Zod for schema validation

### Directory Structure

```
src/
├── components/              # React components
│   ├── wallet/              # Wallet system (main feature)
│   │   ├── L1/              # Layer 1 ALPHA blockchain
│   │   ├── L3/              # Layer 3 Unicity network
│   │   ├── sdk/             # Portable wallet SDK (framework-agnostic)
│   │   ├── shared/          # Shared wallet components
│   │   └── onboarding/      # Wallet creation/restore flows
│   ├── agents/              # AI agent chat interfaces
│   ├── chat/                # Chat system components
│   ├── auth/                # Authentication (WalletGate)
│   ├── layout/              # DashboardLayout, Header
│   ├── splash/              # Splash screen, welcome modal
│   └── theme/               # Theme management
├── pages/                   # Route pages (IntroPage, AgentPage)
├── hooks/                   # Global custom hooks
├── contexts/                # React contexts (ServicesContext)
├── repositories/            # Data access (WalletRepository, OutboxRepository)
├── config/                  # Configuration files
├── utils/                   # Helper functions
├── types/                   # TypeScript type definitions
└── assets/                  # Static resources

tests/
├── sdk/                     # SDK unit tests (16 files)
│   ├── address/             # Address generation tests
│   ├── core/                # Wallet, derivation, crypto tests
│   ├── transaction/         # TX and vesting tests
│   ├── wallets/             # Unified wallet class tests
│   └── nostr/               # Nostr service tests
└── unit/                    # Component/service tests (8 files)
    ├── components/          # Service tests
    ├── config/              # Config tests
    └── hooks/               # Hook tests
```

### Application Routes

- `/` - Intro/splash screen
- `/agents/:agentId` - Agent chat pages (within DashboardLayout)
- `/home` - Redirects to `/agents/chat`
- `/ai` - Redirects to `/agents/ai`

All routes except intro use `DashboardLayout` which provides header, navigation, and handles incoming transfers.

### Wallet Architecture (Two-Layer System)

**Layer 1 (L1) - ALPHA Blockchain:**
- Location: `src/components/wallet/L1/`
- Custom HD wallet implementation with BIP32-style derivation
- Uses Fulcrum WebSocket for blockchain data (Electrum-style protocol)
- Supports vesting classification (coins from blocks ≤280,000 are "vested")
- Components: `views/`, `components/`, `hooks/`, `modals/`
- L1-specific SDK functions in `L1/sdk/` (wallet ops, network, tx, vesting)

**Layer 3 (L3) - Unicity Network:**
- Location: `src/components/wallet/L3/`
- Uses `@unicitylabs/state-transition-sdk` for token operations
- Nostr integration for P2P messaging and token transfers
- Nametag system for human-readable addresses
- IPFS/IPNS for decentralized token storage and sync
- Services: `services/` (19 files), views, hooks, modals

**Portable SDK:**
- Location: `src/components/wallet/sdk/` (31 files)
- Framework-agnostic, works in browser, Node.js, React Native
- Organized into: `core/`, `address/`, `transaction/`, `network/`, `serialization/`, `wallets/`, `nostr/`, `browser/`
- Browser adapters: `BrowserWSAdapter.ts`, `IndexedDBVestingCache.ts`

### Key Patterns

**State Management:**
- TanStack Query manages all async state (wallet, balance, transactions)
- Custom events (`wallet-updated`) trigger cross-component refreshes
- localStorage persists wallet data; IndexedDB for vesting cache
- React Context for service injection (`ServicesContext`)

**Query Key Structure:**
- L1: `["l1", "wallet"]`, `["l1", "balance", address]`, `["l1", "vesting", address]`
- L3: `["wallet", "identity"]`, `["wallet", "tokens"]`, `["wallet", "aggregated"]`

**Services Pattern (L3):**
- `ServiceProvider` - singleton for SDK clients (aggregator, state transition)
- `IdentityManager` - handles wallet identity and key management
- `NostrService` - P2P messaging and token transfer via Nostr protocol
- `NametagService` - human-readable address resolution (@username lookup)
- `IpfsStorageService` - IPFS/IPNS storage with Helia, supports bidirectional sync
- `SyncCoordinator` - tab coordination for IPFS sync with tombstone support
- `TokenValidationService` - validates tokens against aggregator
- `ConflictResolutionService` - handles token conflicts during sync
- `FaucetService` - obtains test tokens from faucet
- `NostrPinPublisher` - broadcasts token pins for discovery
- `TxfSerializer` - serializes token transfer files (.txf format)
- `IpnsNametagFetcher` - resolves nametags via IPNS during wallet import
- `TokenBackupService` - token backup management
- `OutboxRecoveryService` - pending transaction recovery
- `RegistryService` - token registry

**Shared Services:**
- `UnifiedKeyManager` - cross-layer key management (L1/L3 key derivation)

### Portable SDK Structure

The `src/components/wallet/sdk/` directory is organized into logical modules:

```
sdk/
├── index.ts                 # Main exports
├── types.ts                 # Core type definitions
├── core/                    # Cryptography & wallet creation
│   ├── wallet.ts            # Wallet creation/restoration
│   ├── derivation.ts        # Key derivation (BIP32 & legacy)
│   ├── crypto.ts            # Cryptographic primitives
│   └── utils.ts             # Utility functions
├── address/                 # Address generation
│   ├── address.ts           # HD address generation
│   ├── addressHelpers.ts    # Address helpers
│   ├── bech32.ts            # Bech32 encoding
│   ├── script.ts            # Script operations
│   └── unified.ts           # Unified L1+L3 derivation
├── transaction/             # Transaction handling
│   ├── transaction.ts       # TX creation & signing
│   └── vesting.ts           # Vesting coin tracing
├── network/                 # Network communication
│   ├── network.ts           # RPC calls
│   └── websocket.ts         # WebSocket connection
├── serialization/           # Import/export formats
│   ├── import-export.ts     # Universal import/export
│   ├── wallet-dat.ts        # Bitcoin wallet.dat format
│   ├── wallet-json.ts       # JSON wallet format
│   ├── wallet-text.ts       # Text-based format
│   └── scan.ts              # Wallet scanning
├── browser/                 # Browser-specific implementations
│   ├── BrowserWSAdapter.ts  # WebSocket adapter
│   ├── IndexedDBVestingCache.ts # IndexedDB cache
│   └── index.ts
├── wallets/                 # Unified wallet classes
│   ├── L1Wallet.ts          # L1 wallet class
│   ├── L3Wallet.ts          # L3 wallet class
│   └── UnityWallet.ts       # Combined L1+L3 wallet
└── nostr/                   # Nostr integration
    ├── NametagService.ts    # Nametag operations
    ├── TokenTransferService.ts # Token transfers
    ├── NostrClientWrapper.ts # Client wrapper
    ├── types.ts
    └── index.ts
```

### Important Types

```typescript
// Base Wallet (sdk/types.ts)
interface BaseWallet {
  masterPrivateKey: string;
  chainCode?: string;
  masterChainCode?: string;
  addresses: BaseWalletAddress[];
  childPrivateKey?: string | null;
  isBIP32?: boolean;
  descriptorPath?: string | null;
  isImportedAlphaWallet?: boolean;
}

interface BaseWalletAddress {
  address: string;
  publicKey?: string;
  privateKey?: string;
  path: string | null;
  index: number;
  isChange?: boolean;
}

// Unified Address (both L1 + L3)
interface UnifiedAddress {
  path: string;
  index: number;
  isChange: boolean;
  l1Address: string;    // bech32 (alpha1...)
  l3Address: string;    // DirectAddress
  privateKey: string;
  publicKey: string;
}

// L1 Network Provider Interface
interface L1NetworkProvider {
  getBalance(address: string): Promise<number>;
  getUtxos(address: string): Promise<L1UTXO[]>;
  broadcast(rawTxHex: string): Promise<string>;
  getTransaction?(txid: string): Promise<unknown>;
  getHistory?(address: string): Promise<Array<{ tx_hash: string; height: number }>>;
}

// Vesting Cache Provider Interface
interface VestingCacheProvider {
  init(): Promise<void>;
  get(txHash: string): Promise<VestingCacheEntry | null>;
  set(txHash: string, entry: VestingCacheEntry): Promise<void>;
  clear(): Promise<void>;
}

// L3 Token (L3/data/model)
class Token {
  id: string;
  name: string;
  type: string;
  timestamp: number;
  unicityAddress?: string;
  jsonData?: string;           // Serialized SDK token
  status: TokenStatus;         // PENDING | SUBMITTED | TRANSFERRED | CONFIRMED | BURNED | FAILED
  amount?: string;             // BigInt as string
  coinId?: string;
  symbol?: string;
  senderPubkey?: string;
}

// L3 User Identity
interface UserIdentity {
  privateKey: string;
  publicKey: string;
  address: string;             // DirectAddress (derived via UnmaskedPredicateReference)
  nametag?: string;
}

// Aggregated Asset (for portfolio view)
class AggregatedAsset {
  coinId: string;
  symbol: string;
  totalAmount: string;         // BigInt as string
  decimals: number;
  tokenCount: number;
  priceUsd: number;
  priceEur: number;
}
```

### Vite Configuration

- Base path: configurable via `BASE_PATH` env var (default `/`)
- Node polyfills enabled for crypto libraries (`vite-plugin-node-polyfills`)
- Proxy `/rpc` to `https://goggregator-test.unicity.network` for L3 aggregator
- Optional HTTPS support via `SSL_CERT_PATH` env var (fullchain.pem, privkey.pem)
- Remote HMR support via `HMR_HOST` env var
- Path alias: `@` → `src/`
- Server host: `0.0.0.0` (allows external connections)

### Component Hierarchy

```
App (React Router)
├── IntroPage (/)
└── WalletGate (auth wrapper)
    └── DashboardLayout
        ├── Header
        └── Outlet → AgentPage (/agents/:agentId)
            ├── AgentCard[] (grid of 7+ agents, expandable)
            ├── Mobile: Tab switcher (Agents / Wallet) with swipe
            ├── Chat component (based on agentId):
            │   ├── ChatSection (chat)
            │   ├── AIChat (ai)
            │   ├── P2PChat (p2p)
            │   ├── SportChat (sport)
            │   ├── MerchChat (merch)
            │   ├── TriviaChat (trivia)
            │   └── GamesChat (games)
            └── WalletPanel
                ├── L1WalletView (Layer 1 selected)
                └── L3WalletView (Layer 3 selected)
```

**Layout notes:**
- Desktop: 3-column grid (chat 2/3, wallet 1/3)
- Mobile: Horizontal swipe between Agents and Wallet panels
- `WalletGate` protects routes requiring wallet authentication

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
VITE_AGENT_API_URL=http://localhost:3000  # Agentic chatbot backend
VITE_USE_MOCK_AGENTS=true                  # Use mock agents (for local dev without backend)
VITE_AGGREGATOR_URL=/rpc                   # Unicity aggregator (proxied in dev)
VITE_ENABLE_IPFS=true                      # Enable IPFS storage for wallet backup

# Optional: HTTPS for dev server (e.g., for WebCrypto APIs)
SSL_CERT_PATH=/path/to/certs              # Path to SSL certificate directory
HMR_HOST=your-dev-server.example.com      # Custom HMR host for remote dev
BASE_PATH=/                                # Base path for deployment (default: /)
```

## Testing

Tests are located in `tests/` directory and run with Vitest:

**Test Structure:**
- `tests/sdk/` - SDK unit tests (address, core, transaction, wallets, nostr)
- `tests/unit/` - Component and service tests

**Test Commands:**
```bash
npm run test          # Watch mode
npm run test:run      # Single run
npx vitest run tests/sdk/core/wallet.test.ts  # Specific file
```

**Environment:** jsdom with globals enabled (`describe`, `it`, `expect`, `vi`)

## Developer Notes

### Crypto Libraries
The project uses node polyfills (`vite-plugin-node-polyfills`) for browser compatibility with crypto libraries like `elliptic`, `bip39`, and `crypto-js`. The `/rpc` endpoint is proxied to the Unicity aggregator in development.

### BIP32 Implementation
The L1 wallet uses a custom derivation that differs from standard BIP32 (see `SPHERE_DEVELOPER_GUIDE.md` for migration details). Standard path would be `m/44'/0'/0'/0/{index}`.

### Vesting System
ALPHA coins are classified as "vested" or "unvested" based on coinbase block height (threshold: 280,000). The classifier traces each UTXO back to its coinbase origin and caches results in IndexedDB.

### Token Transfer Flow (L3)
1. Calculate optimal token split via `TokenSplitCalculator`
2. Create transfer commitment with SDK
3. Submit to aggregator and wait for inclusion proof
4. Send token + proof to recipient via Nostr
5. Broadcast pin to Nostr for discovery
6. Update local storage and IPFS, trigger query refresh

### IPFS Storage (L3)
Tokens are synced to IPFS with IPNS for consistent addressing:
- Dual publishing: HTTP API to backend + browser DHT
- Bidirectional sync with conflict resolution
- Tombstones track deleted tokens across devices
- Tab coordination prevents concurrent writes

**Unicity IPFS Bootstrap Peers:**
| Host | Peer ID |
|------|---------|
| unicity-ipfs2.dyndns.org | 12D3KooWLNi5NDPPHbrfJakAQqwBqymYTTwMQXQKEWuCrJNDdmfh |
| unicity-ipfs3.dyndns.org | 12D3KooWQ4aujVE4ShLjdusNZBdffq3TbzrwT2DuWZY9H1Gxhwn6 |
| unicity-ipfs4.dyndns.org | 12D3KooWJ1ByPfUzUrpYvgxKU8NZrR8i6PU1tUgMEbQX9Hh2DEn1 |
| unicity-ipfs5.dyndns.org | 12D3KooWB1MdZZGHN5B8TvWXntbycfe7Cjcz7n6eZ9eykZadvmDv |

### localStorage Keys
Key persistence patterns:
- `unified_wallet_*` - Encrypted wallet credentials (mnemonic, master key, chain code)
- `unicity_wallet_{address}` - Per-address wallet data
- `unicity_transaction_history` - L1 transaction history
- `unicity_chat_*` - Chat conversations and messages
- `wallet-active-layer` - Currently selected layer (L1/L3)
- `sphere-theme` - UI theme preference
- `l3_selected_address_path` - Selected address BIP32 path for L3 identity (e.g., "m/84'/1'/0'/0/0"); determines which derived key is used for IPFS/IPNS publishing and token ownership

### Custom Events
The app uses custom events for cross-component communication:
- `wallet-updated` - Triggers TanStack Query refetch for wallet data
- Dispatch via `window.dispatchEvent(new Event('wallet-updated'))`

### Key External Dependencies
- `@unicitylabs/state-transition-sdk` (v1.6.0) - L3 token operations and state transitions
- `@unicitylabs/nostr-js-sdk` (v0.2.5) - P2P messaging and token transfers
- `helia` (v6.0.11) / `@helia/ipns` / `@helia/json` - Browser-based IPFS/IPNS
- `elliptic` (v6.6.1) - secp256k1 cryptography for L1 wallet
- `bip39` (v3.1.0) - Seed phrase generation and validation
- `zod` (v4.1.13) - Schema validation
