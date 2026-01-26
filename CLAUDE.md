# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unicity AgentSphere is a React-based cryptocurrency wallet application for the Unicity network. It provides a dual-layer wallet interface supporting both Layer 1 (ALPHA blockchain) and Layer 3 (Unicity state transition network) operations. The app integrates with multiple Unicity SDKs for token management, state transitions, and peer-to-peer transfers via Nostr.

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
npx vitest run tests/unit/components/wallet/L3/services/TokenValidationService.test.ts

# Preview production build
npm run preview

# Type check only (without building)
npx tsc --noEmit
```

## Architecture

### Tech Stack
- React 19 + TypeScript with Vite 7
- TanStack Query v5 for server state management
- Tailwind CSS 4 for styling
- Framer Motion for animations
- React Router DOM v7 for routing
- Vitest + jsdom for testing
- Helia for IPFS/IPNS browser integration

### Application Structure

The app uses a single-page architecture with dynamic agent routing:
- `/` - Intro/splash screen
- `/agents/:agentId` - Dynamic agent pages (chat, ai, trivia, games, sport, p2p, merch, etc.)
- `/home` - Redirects to `/agents/chat`
- `/ai` - Redirects to `/agents/ai`

All routes except intro are wrapped in `WalletGate` and use `DashboardLayout` which provides header, navigation, and handles incoming transfers.

### Wallet Architecture (Two-Layer System)

**Layer 1 (L1) - ALPHA Blockchain:**
- Location: `src/components/wallet/L1/`
- Custom HD wallet implementation with BIP32-style derivation
- Uses Fulcrum WebSocket for blockchain data (Electrum-style protocol)
- Supports vesting classification (coins from blocks ≤280,000 are "vested")
- SDK in `src/components/wallet/L1/sdk/` handles crypto, transactions, network calls

**Layer 3 (L3) - Unicity Network:**
- Location: `src/components/wallet/L3/`
- Uses `@unicitylabs/state-transition-sdk` for token operations
- Nostr integration for P2P messaging and token transfers
- Nametag system for human-readable addresses
- IPFS/IPNS for decentralized token storage and sync
- ServiceProvider singleton manages SDK clients

### Agent Configuration

Agents are defined in `src/config/activities.ts`:
```typescript
interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;  // 'chat' | 'simple-ai' | 'ai-with-sidebar' | 'trivia' | 'unified'
  backendActivityId?: string;  // Maps to agentic-chatbot backend API
  contentType?: ContentType;   // 'none' | 'game' | 'match' | 'product' | 'merch'
  hasSidebar?: boolean;
  quickActions?: QuickAction[];
}
```

### NIP-29 Group Chat

The app implements [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md) for relay-based group messaging:
- Dedicated Zooid relay at `wss://sphere-relay.unicity.network`
- `GroupChatService` (`src/components/chat/services/`) - manages relay connection, subscriptions, message sending
- `GroupChatRepository` (`src/components/chat/data/`) - local storage for groups, messages, members
- `useGroupChat` hook - React Query integration

**Event Kinds (NIP-29):**
- Kind 9: Group chat message
- Kind 9021: Join request
- Kind 9022: Leave request
- Kind 39000: Group metadata (relay-signed)
- Kind 39002: Group members (relay-signed)

### Key Patterns

**State Management:**
- TanStack Query manages all async state (wallet, balance, transactions)
- Custom events (`wallet-updated`) trigger cross-component refreshes
- localStorage persists wallet data; IndexedDB for vesting cache

**Query Key Structure:**
- L1: `["l1", "wallet"]`, `["l1", "balance", address]`, `["l1", "vesting", address]`
- L3: `["wallet", "identity"]`, `["wallet", "tokens"]`, `["wallet", "aggregated"]`

**Services Pattern (L3):**
- `ServiceProvider` - singleton for SDK clients (aggregator, state transition)
- `IdentityManager` - handles wallet identity and key management
- `NostrService` - P2P messaging and token transfer via Nostr protocol
- `NametagService` - human-readable address resolution (@username lookup)
- `IpfsStorageService` - IPFS/IPNS storage with Helia, supports bidirectional sync
- `IpfsPublisher` - handles IPFS content publishing with dual HTTP/DHT strategy
- `IpfsHttpResolver` - HTTP-based IPFS/IPNS resolution via gateway
- `IpfsCache` / `IpfsMetrics` - caching layer and metrics for IPFS operations
- `SyncCoordinator` - tab coordination for IPFS sync with tombstone support
- `SyncQueue` - queue management for serializing sync operations
- `TokenValidationService` - validates tokens against aggregator
- `ConflictResolutionService` - handles token conflicts during sync
- `TokenBackupService` / `TokenRecoveryService` - backup and recovery operations
- `OutboxRecoveryService` - recovers failed outbound transfers
- `FaucetService` - obtains test tokens from faucet
- `NostrPinPublisher` - broadcasts token pins for discovery
- `TxfSerializer` - serializes token transfer files (.txf format)
- `IpnsNametagFetcher` - resolves nametags via IPNS during wallet import
- `RegistryService` - nametag registry operations
- `IpnsUtils` - IPNS utility functions for key derivation and name resolution

**Shared Services:**
- `UnifiedKeyManager` - cross-layer key management (L1/L3 key derivation)

### SDK Layer (L1)

The `src/components/wallet/L1/sdk/` directory contains:
- `wallet.ts` - wallet creation/management
- `address.ts` - HD key derivation and address generation
- `network.ts` - Fulcrum WebSocket connection and RPC calls
- `tx.ts` - transaction creation and signing
- `vesting.ts` - coinbase tracing for vesting classification
- `vestingState.ts` - vesting mode state management

### Important Types

```typescript
// L1 Wallet (sdk/types.ts)
interface Wallet {
  masterPrivateKey: string;
  chainCode?: string;
  addresses: WalletAddress[];
  isBIP32?: boolean;
}

// L3 Token (L3/data/model)
class Token {
  id: string;
  symbol: string;
  amount: string;
  jsonData: string; // Serialized SDK token
  status: TokenStatus;
}
```

### Vite Configuration

- Base path: configurable via `BASE_PATH` env var (default `/`)
- Node polyfills enabled for crypto libraries
- Proxy `/rpc` to `https://goggregator-test.unicity.network` for L3 aggregator
- Proxy `/dev-rpc` to `https://dev-aggregator.dyndns.org` for dev aggregator
- Optional HTTPS support via `SSL_CERT_PATH` env var
- Remote HMR support via `HMR_HOST` env var

### Component Hierarchy

```
App
└── WalletGate
    └── DashboardLayout
        ├── Header
        └── AgentPage (route: /agents/:agentId)
            ├── AgentCard[] (agent picker)
            ├── ChatSection / AIChat / TriviaChat / etc. (based on agentId)
            └── WalletPanel
                ├── L1WalletView (when Layer 1 selected)
                └── L3WalletView (when Layer 3 selected)
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
VITE_AGENT_API_URL=http://localhost:3000  # Agentic chatbot backend
VITE_AGENT_API_KEY=...                     # Required for SSE streaming
VITE_USE_MOCK_AGENTS=true                  # Use mock agents (for local dev without backend)
VITE_AGGREGATOR_URL=/rpc                   # Unicity aggregator (proxied in dev)
VITE_ENABLE_IPFS=true                      # Enable IPFS storage for wallet backup (default: true)

# Nostr configuration
VITE_NOSTR_RELAYS=wss://nostr-relay.testnet.unicity.network  # DMs and token transfers
VITE_GROUP_CHAT_RELAYS=wss://sphere-relay.unicity.network    # NIP-29 group chat (Zooid)

# Activity service (for recent activity panel)
VITE_ACTIVITY_API_URL=http://localhost:3001/activities
VITE_ACTIVITY_API_KEY=...

# Optional: HTTPS for dev server (e.g., for WebCrypto APIs)
SSL_CERT_PATH=/path/to/certs              # Path to SSL certificate directory
HMR_HOST=your-dev-server.example.com      # Custom HMR host for remote dev
BASE_PATH=/                                # Base path for deployment (default: /)
```

## Testing

Tests are located in `tests/` directory and run with Vitest:
- Test files: `tests/**/*.test.ts`, `tests/**/*.test.tsx`
- Environment: jsdom
- Path alias: `@` maps to `/src` (only available in tests via vitest.config.ts)
- Globals enabled: `describe`, `it`, `expect`, `vi` are available without imports

## TypeScript Configuration

- Strict mode enabled with `noUnusedLocals` and `noUnusedParameters`
- Target: ES2022, Module: ESNext with bundler resolution
- Type checking: `npx tsc --noEmit` (build runs tsc before vite build)

## Developer Notes

### Crypto Libraries
The project uses node polyfills (`vite-plugin-node-polyfills`) for browser compatibility with crypto libraries like `elliptic`, `bip39`, and `crypto-js`. The `/rpc` endpoint is proxied to the Unicity aggregator in development.

### BIP32 Implementation
The L1 wallet uses a custom derivation that differs from standard BIP32. Standard path would be `m/44'/0'/0'/0/{index}`.

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

### Embedded Wallet (guiwallet-main)
A standalone single-file HTML wallet exists at `src/components/wallet/L1/guiwallet-main/`. This is a separate 888KB self-contained wallet application, not integrated into the React app.

### localStorage Keys
All keys use `sphere_` prefix (centralized in `src/config/storageKeys.ts`):
- `sphere_wallet_mnemonic` - AES-256 encrypted BIP39 mnemonic
- `sphere_wallet_master` - AES-256 encrypted master private key
- `sphere_wallet_chaincode` - Chain code for BIP32 derivation
- `sphere_wallet_${address}` - Per-address wallet data
- `sphere_transaction_history` - L1 transaction history
- `sphere_chat_*` - Chat conversations and messages
- `sphere_wallet_active_layer` - Currently selected layer (L1/L3)
- `sphere_theme` - UI theme preference
- `sphere_l3_selected_address_path` - Selected address BIP32 path for L3 identity

### Custom Events
The app uses custom events for cross-component communication:
- `wallet-updated` - Triggers TanStack Query refetch for wallet data
- Dispatch via `window.dispatchEvent(new Event('wallet-updated'))`

### Key External Dependencies
- `@unicitylabs/state-transition-sdk` (v1.6.0) - L3 token operations and state transitions
- `@unicitylabs/nostr-js-sdk` - P2P messaging and token transfers
- `helia` / `@helia/ipns` / `@helia/json` - Browser-based IPFS/IPNS for decentralized storage
- `elliptic` - secp256k1 cryptography for L1 wallet
- `bip39` - Seed phrase generation and validation
