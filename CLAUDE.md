# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unicity AgentSphere is a React-based cryptocurrency wallet application for the Unicity network. It provides a dual-layer wallet interface supporting both Layer 1 (ALPHA blockchain) and Layer 3 (Unicity state transition network) operations. All wallet operations are handled through `@unicitylabs/sphere-sdk`, with a thin React adapter layer in `src/sdk/`.

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
- `@unicitylabs/sphere-sdk` for all wallet operations (L1, L3, Nostr, IPFS)

### Application Structure

The app uses a single-page architecture with dynamic agent routing:
- `/` - Intro/splash screen
- `/agents/:agentId` - Dynamic agent pages (chat, ai, trivia, games, sport, p2p, merch, etc.)
- `/home` - Redirects to `/agents/chat`
- `/ai` - Redirects to `/agents/ai`

All routes except intro are wrapped in `WalletGate` and use `DashboardLayout` which provides header, navigation, and handles incoming transfers.

### SDK Adapter Layer (`src/sdk/`)

The React adapter layer over `@unicitylabs/sphere-sdk` (21 files):

**Core:**
- `SphereProvider.tsx` — React wrapper, manages Sphere instance lifecycle
- `SphereContext.ts` — Context definition (separate file for react-refresh)
- `types.ts` — Re-exports types from sphere-sdk
- `queryKeys.ts` — TanStack Query key factory (SPHERE_KEYS)

**Hooks by domain:**

| Domain | Hooks | Purpose |
|--------|-------|---------|
| Core | `useSphere`, `useWalletStatus`, `useIdentity`, `useNametag`, `useSphereEvents` | Instance access, wallet state, identity |
| Payments (L3) | `useTokens`, `useBalance`, `useAssets`, `useTransfer`, `useTransactionHistory` | Token operations |
| L1 | `useL1Balance`, `useL1Utxos`, `useL1Send`, `useL1Transactions` | ALPHA blockchain |
| Communications | `useSendDM`, `usePaymentRequests` | Messaging |

**Event bridging** (`useSphereEvents`):
- SDK events → TanStack Query invalidations
- `message:dm` → ChatRepository + `dm-received` custom event
- `payment_request:incoming` → `payment-requests-updated` custom event

### Key Patterns

**State Management:**
- TanStack Query manages all async state (wallet, balance, transactions)
- Custom events trigger cross-component refreshes
- SDK handles wallet storage internally

**Query Key Structure (SPHERE_KEYS):**
- `wallet: { exists, status }`
- `identity: { current, nametag, addresses }`
- `payments: { tokens, balance, assets, transactions }`
- `l1: { balance, utxos, transactions, vesting, blockHeight }`
- `communications: { conversations }`
- `market: { prices, registry }`

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
                ├── L1WalletModal (when Layer 1 selected)
                └── L3WalletView (when Layer 3 selected)
```

**Provider tree** (main.tsx):
```
QueryClientProvider → SphereProvider → ServicesProvider → ThemeInitializer → HashRouter → App
```

### Vite Configuration

- Base path: configurable via `BASE_PATH` env var (default `/`)
- Node polyfills enabled for crypto libraries (`elliptic`, `crypto-js`)
- Proxy `/rpc` to `https://goggregator-test.unicity.network` for L3 aggregator
- Proxy `/dev-rpc` to `https://dev-aggregator.dyndns.org` for dev aggregator
- Proxy `/coingecko` to `https://api.coingecko.com/api/v3` for price data
- Optional HTTPS support via `SSL_CERT_PATH` env var
- Remote HMR support via `HMR_HOST` env var

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
VITE_AGENT_API_URL=http://localhost:3000  # Agentic chatbot backend
VITE_USE_MOCK_AGENTS=true                  # Use mock agents (for local dev without backend)
VITE_AGGREGATOR_URL=/rpc                   # Unicity aggregator (proxied in dev)

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
The project uses node polyfills (`vite-plugin-node-polyfills`) for browser compatibility with `elliptic` and `crypto-js` (used only in `BridgeModal.tsx` for L1 bridge signing).

### localStorage Keys
All keys use `sphere_` prefix (centralized in `src/config/storageKeys.ts`):
- `sphere_theme` - UI theme preference
- `sphere_welcome_accepted` - Welcome screen flag
- `sphere_transaction_history` - Transaction history
- `sphere_chat_*` - Chat conversations, messages, UI state
- `sphere_agent_chat_*` - Agent chat sessions and messages
- `sphere_dev_*` - Dev settings (aggregator URL, skip trust base)

Wallet encryption/storage is handled internally by the SDK.

### Custom Events
- `dm-received` - Bridged from SDK `message:dm` event
- `payment-requests-updated` - Bridged from SDK `payment_request:incoming` event
- Query invalidations handled automatically by `useSphereEvents()` hook

### Legacy Code
- `BridgeModal.tsx` — uses `elliptic` and `crypto-js` for L1→L3 bridge signing
- `walletFileParser.ts` — inlined `isJSONWalletFormat()` for wallet import format detection

### Key External Dependencies
- `@unicitylabs/sphere-sdk` - Core SDK wrapping L1/L3 operations, Nostr, IPFS, and state transitions
- `elliptic` - secp256k1 cryptography for L1 bridge signing (BridgeModal)
