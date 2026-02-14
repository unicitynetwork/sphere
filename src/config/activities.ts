import { MessageSquare, Trophy, ShoppingBag, Sparkles, Tag, Zap, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Agent types for different UI layouts
export type AgentType = 'chat' | 'simple-ai' | 'ai-with-sidebar' | 'trivia' | 'unified' | 'iframe';

// Content types for message cards
export type ContentType = 'none' | 'game' | 'match' | 'product' | 'merch';

// Quick action configuration
export interface QuickAction {
  label: string;
  message: string;
}

// Agent configuration
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  Icon: LucideIcon;
  category: string;
  color: string;
  type: AgentType;
  greetingMessage?: string;
  // Placeholder for input
  placeholder?: string;
  // Backend activity ID (for real mode API calls)
  backendActivityId?: string;
  // Quick action buttons
  quickActions?: QuickAction[];
  // Content card type
  contentType?: ContentType;
  // Has sidebar (for orders/bets history)
  hasSidebar?: boolean;
  // Whether this agent requires a wallet to function
  requiresWallet?: boolean;
  // URL for iframe-type agents (external web apps embedded in the chat area)
  iframeUrl?: string;
}

// All agents configuration
export const agents: AgentConfig[] = [
  {
    id: 'chat',
    name: 'Chat',
    description: 'DM and group messaging',
    Icon: MessageSquare,
    category: 'Social',
    color: 'from-blue-500 to-cyan-500',
    type: 'chat',
    requiresWallet: true,
  },
  {
    id: 'ai',
    name: 'Uncensored AI',
    description: 'Viktor can assist with anything',
    Icon: Sparkles,
    category: 'Assistant',
    color: 'from-orange-500 to-amber-500',
    type: 'simple-ai',
    greetingMessage: "Hi! I'm Viktor, your personal assistant.\nI care a great deal about privacy. I don't know you, I don't log you, I don't even know your IP address. You are invisible here and nothing will be recorded about our conversation.\nHow can I help?",
    backendActivityId: 'ama',
    quickActions: [
      { label: 'Research', message: 'Research the latest news' },
      { label: 'Explain', message: 'Explain how something works' },
      { label: 'Help', message: 'Help me with a task' },
    ],
  },
  // {
  //   id: 'trivia',
  //   name: 'Unicity Trivia',
  //   description: 'Test your knowledge!',
  //   Icon: Brain,
  //   category: 'Entertainment',
  //   color: 'from-indigo-500 to-cyan-500',
  //   type: 'unified',
  //   greetingMessage: "Welcome to Trivia Challenge! I can quiz you on various topics. Say 'start' to begin, or ask for available categories!",
  //   backendActivityId: 'trivia',
  //   quickActions: [
  //     { label: 'Start game', message: 'Start game' },
  //     { label: 'Categories', message: 'Show categories' },
  //     { label: 'My score', message: 'Show my score' },
  //     { label: 'A', message: 'A' },
  //     { label: 'B', message: 'B' },
  //     { label: 'C', message: 'C' },
  //     { label: 'D', message: 'D' },
  //   ],
  //   contentType: 'none',
  // },
  // {
  //   id: 'games',
  //   name: 'P2P Gaming',
  //   description: 'Discover and play games',
  //   Icon: Gamepad2,
  //   category: 'Entertainment',
  //   color: 'from-purple-500 to-pink-500',
  //   type: 'unified',
  //   greetingMessage: "Welcome to Unicity Gaming! 🎮 I can help you access our games. Ask me what games are available!",
  //   backendActivityId: 'gaming',
  //   quickActions: [
  //     { label: 'All games', message: 'Show me all games' },
  //     { label: 'Quake', message: 'Tell me about Quake' },
  //   ],
  //   contentType: 'game',
  // },
  {
    id: 'sport',
    name: 'P2P Predict',
    description: 'Sports prediction markets',
    Icon: Trophy,
    category: 'Prediction',
    color: 'from-emerald-500 to-teal-500',
    type: 'ai-with-sidebar',
    requiresWallet: true,
    greetingMessage: "Welcome to the P2P Prediction Marketplace! 🏟️ Right now I'm only able to help you make predictions on sports games. I can help you check odds, make a prediction and show you what your active predictions are. What are we looking at ? English Premier League ? IPL ? Let me know and we can have some fun.",
    backendActivityId: 'sports',
    quickActions: [
      { label: 'Basketball', message: 'Show me basketball' },
      { label: 'Soccer', message: 'Show me soccer' },
      { label: 'Tennis', message: 'Show me tennis' },
      { label: 'Cricket', message: 'Show me cricket' },
      { label: 'My bets', message: 'Show my bets' },
    ],
    contentType: 'match',
    hasSidebar: true,
  },
  {
    id: 'p2p',
    name: 'OTC Crypto',
    description: 'Peer-to-peer trading',
    Icon: ShoppingBag,
    category: 'Trading',
    color: 'from-orange-500 to-red-500',
    type: 'ai-with-sidebar',
    requiresWallet: true,
    greetingMessage: "Welcome to OTC Madness! I'll help you navigate the world of over-the-counter crypto trading. Ready to post an offer or browse available deals?",
    backendActivityId: 'p2p',
    quickActions: [
      { label: 'Buy 20 ALPHA', message: 'Buy 20 ALPHA' },
      { label: 'Buy 100 ALPHA', message: 'Buy 100 ALPHA' },
    ],
    contentType: 'product',
    hasSidebar: true,
  },
  
  // {
  //   id: 'merch',
  //   name: 'Unicity Merch',
  //   description: 'Merchandise store',
  //   Icon: Shirt,
  //   category: 'Shopping',
  //   color: 'from-yellow-500 to-orange-500',
  //   type: 'ai-with-sidebar',
  //   greetingMessage: "Welcome to the Merch Store! Check out our exclusive merchandise. What are you looking for today?",
  //   backendActivityId: 'merch',
  //   quickActions: [
  //     { label: 'All items', message: 'Show all merch' },
  //     { label: 'Mugs', message: 'Show mugs' },
  //     { label: 'T-Shirts', message: 'Show t-shirts' },
  //   ],
  //   contentType: 'merch',
  //   hasSidebar: true,
  // },
  {
    id: 'sell-anything',
    name: 'Buy / Sell Anything',
    description: 'Get a quote',
    Icon: Tag,
    category: 'Trading',
    color: 'from-teal-500 to-cyan-500',
    type: 'simple-ai',
    requiresWallet: true,
    greetingMessage: "Welcome to the P2P Marketplace! Tell me what you want to buy or sell and I'll help you find the best deals.",
    quickActions: [
      { label: 'Gold', message: 'Show me gold listings' },
      { label: 'Tickets', message: 'Show me event tickets' },
      { label: 'ASICs', message: 'Show me mining hardware' },
      { label: 'Browse all', message: 'Show me what\'s available' },
    ],
  },
  {
    id: 'pokemon',
    name: 'Pokémon Cards',
    description: 'Catch em all',
    Icon: Zap,
    category: 'Entertainment',
    color: 'from-yellow-500 to-red-500',
    type: 'ai-with-sidebar',
    requiresWallet: true,
    backendActivityId: 'pokemon',
    greetingMessage: "Welcome to the Pokémon Card marketplace! I can help you browse Pokémon cards, manage your cart, and complete purchases using Unicity tokens. You can also sell cards! Tell me your Unicity ID to get started, or ask me what cards are available.",
    placeholder: 'Search for cards, check cart, or ask about selling...',
    quickActions: [
      { label: 'Browse cards', message: 'Show me available Pokémon cards' },
      { label: 'My cart', message: 'Show my cart' },
      { label: 'Sell cards', message: 'I want to sell some cards' },
      { label: 'Check order', message: 'Check my order status' },
    ],
    contentType: 'product',
    hasSidebar: true,
  },
  {
    id: 'marketplace',
    name: 'Marketplace',
    description: 'Unicity Marketplace',
    Icon: Store,
    category: 'Trading',
    color: 'from-violet-500 to-purple-500',
    type: 'iframe',
    iframeUrl: 'https://market.unicity.network/',
  },
];

// Get agent by ID
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId);
}

// Check if an agent requires a wallet to function
export function agentRequiresWallet(agentId: string): boolean {
  const agent = getAgentConfig(agentId);
  return agent?.requiresWallet ?? false;
}
