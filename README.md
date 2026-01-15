# Unicity AgentSphere

A multifunctional Web3 platform with integrated crypto wallet, specialized AI agents, and P2P functionality.

## Overview

**Unicity AgentSphere** is a modern decentralized application built on the concept of "agents" — specialized AI interfaces for various activities: sports betting, gaming, merchandise shopping, P2P crypto trading, trivia, direct messaging, and AI assistance.

## Key Features

### 🤖 Agent System

**Core Agents:**
- **Chat** — direct and group messaging via Nostr protocol
- **Uncensored AI (Viktor)** — uncensored LLM with internet access
- **Unicity Trivia** — quiz games with score tracking
- **P2P Gaming** — gaming platform (Quake arena, crypto poker)
- **P2P Prediction** — sports prediction markets with history tracking
- **OTC** — peer-to-peer cryptocurrency trading
- **Unicity Merch** — merchandise store with order management

**Additional Agents:**
- **Agent Casino** — verifiably fair casino games
- **P2P Sports** — private betting pools
- **P2P Derivatives** — leveraged trading
- **P2P Payday Loans** — instant approval loans
- **P2P Crypto Offramp** — convert crypto to cash
- **P2P Fiat Onramp** — convert cash to crypto
- **Friendly Miners** — buy hash rate
- **Buy Anything** — product purchasing
- **Sell Anything** — get quotes for items
- **Get UCT** — acquire Unicity tokens

### 💰 Multi-Layer Wallet

**Layer 1 (L1)** — base blockchain layer:
- Wallet creation and management
- Transaction history
- Vesting selector
- Password protection
- Bridge between layers

**Layer 3 (L3)** — application-specific rollup:
- Fast, low-cost transactions
- Token management
- Direct transfers
- Incoming payment notifications

**Additional Features:**
- Nametag system (@username identification)
- Wallet switching
- QR codes for receiving payments
- Seed phrase management
- Real-time market data

### 🔐 Security

- Cryptographic identification
- Transaction signing via elliptic curve cryptography
- PIN-based session protection
- Decentralized messaging (Nostr protocol)
- Secure seed phrase storage

## Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite 7** — build tool and HMR
- **Tailwind CSS 4** — styling
- **Framer Motion** — animations
- **React Router DOM v7** — routing
- **TanStack React Query v5** — server state management

### Web3 / Crypto
- **Unicity Labs State Transition SDK** — blockchain interaction
- **Nostr JS SDK** — decentralized messaging
- **BIP39** — seed phrase generation
- **Elliptic** — cryptography
- **CryptoJS** — encryption

### Utilities
- **Axios** — HTTP client
- **Lucide React** — icons
- **UUID** — identifier generation
- **QR Code Styling** — QR code generation

## Installation and Setup

### Requirements
- Node.js 18+
- npm or yarn

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Lint Code

```bash
npm run lint
```

## Environment Variables

Create a `.env` file in the project root:

```env
# Agent mode (mock/real)
VITE_USE_MOCK_AGENTS=true

# Backend API URL
VITE_AGENT_API_URL=https://api.example.com

# Base path for deployment
BASE_PATH=/
```

## Project Structure

```
src/
├── components/          # React components
│   ├── agents/         # Agent components
│   │   ├── shared/     # Reusable chat components
│   │   └── [specific]  # AIChat, SportChat, P2PChat, etc.
│   ├── wallet/         # Multi-layer wallet
│   │   ├── L1/         # Layer 1 components
│   │   ├── L3/         # Layer 3 components
│   │   └── shared/     # Shared utilities
│   ├── chat/           # Messaging system
│   ├── auth/           # Authentication
│   ├── layout/         # Page layouts
│   ├── theme/          # Theme management
│   └── splash/         # Loading screen
├── pages/              # Application pages
├── hooks/              # Custom React hooks
├── config/             # Configuration (agent definitions)
├── types/              # TypeScript types
├── data/               # Mock data
├── repositories/       # Data access layer
├── utils/              # Helper functions
└── assets/             # Static resources
```

## Responsive Design

### Mobile (< 1024px)
- Swipeable tab interface (chat/wallet)
- Optimized keyboard handling
- Touch-friendly elements

### Desktop (≥ 1024px)
- Grid layout with agent picker, chat, and wallet
- Sidebars with additional information
- Extended navigation capabilities

## Core Components

### Agent Architecture

Each agent is configured in `src/config/activities.ts`:

```typescript
// For rendering agent cards (src/types/index.ts)
interface IAgent {
  id: string;
  name: string;
  Icon: LucideIcon;  // Lucide React icon component
  category: string;
  color: string;
  isSelected?: boolean;
}

// Full agent configuration (src/config/activities.ts)
interface AgentConfig {
  id: string;
  name: string;
  description: string;
  Icon: LucideIcon;
  category: string;
  color: string;
  type: AgentType;  // 'chat' | 'simple-ai' | 'ai-with-sidebar' | 'trivia' | 'unified'
  greetingMessage?: string;
  placeholder?: string;
  backendActivityId?: string;  // For real mode API calls
  quickActions?: QuickAction[];
  contentType?: ContentType;  // 'none' | 'game' | 'match' | 'product' | 'merch'
  hasSidebar?: boolean;
}
```

### State Management

- **Server State:** TanStack Query
- **UI State:** React hooks (useState, useRef)
- **Theme State:** Context API
- **Persistent State:** localStorage

### Real-time Features

- WebSocket via Nostr for chat
- Automatic wallet balance updates
- Market data refresh (60 sec intervals)
- Automatic incoming transfer detection

## User Flow

1. **Splash Screen** → IntroPage
2. **Authentication** → WalletGate (create/import wallet)
3. **Dashboard** → Agent selection
4. **Interaction** → Chat interface with optional sidebar
5. **Wallet** → L1/L3 management, transfers
6. **Direct Messages** → Real-time communication
7. **Marketplace** → Shopping, trading, betting, gaming

## Development Features

### Performance Optimization
- Query caching via React Query
- Debounced scroll detection
- Memoization with Framer Motion
- Lazy component mounting
- LocalStorage for offline access

### Security
- Cryptographic key management
- Transaction signing
- PIN session authentication
- Identity verification via Unicity SDK

## License

Private project

## Contact

For questions and suggestions, please contact the Unicity Labs development team.

---

**Built with React, TypeScript, Vite, and Unicity SDKs**
