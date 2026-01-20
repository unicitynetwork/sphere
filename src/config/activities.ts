import { MessageSquare, Gamepad2, Trophy, ShoppingBag, Shirt, Brain, Sparkles, Dices, TrendingUp, Banknote, CreditCard, ArrowRightLeft, Cpu, Package, Tag, Coins, Repeat, Pill, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Agent types for different UI layouts
export type AgentType = 'chat' | 'simple-ai' | 'ai-with-sidebar' | 'trivia' | 'unified';

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
}

// All agents configuration
export const agents: AgentConfig[] = [
  {
    id: 'chat',
    name: 'Discord',
    description: 'DM and group messaging',
    Icon: MessageSquare,
    category: 'Social',
    color: 'from-blue-500 to-cyan-500',
    type: 'chat',
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
    name: 'OTC',
    description: 'Peer-to-peer trading',
    Icon: ShoppingBag,
    category: 'Trading',
    color: 'from-orange-500 to-red-500',
    type: 'ai-with-sidebar',
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
    id: 'casino',
    name: 'Agent Casino',
    description: 'Verifiably Fair',
    Icon: Dices,
    category: 'Entertainment',
    color: 'from-red-500 to-pink-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Agent Casino! Our games are verifiably fair using cryptographic proofs. Ready to try your luck?",
  },
  {
    id: 'p2p-sports',
    name: 'P2P Sports',
    description: 'Private Betting',
    Icon: Trophy,
    category: 'Prediction',
    color: 'from-green-500 to-emerald-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Sports! Create private betting pools with friends. What sport interests you?",
  },
  {
    id: 'p2p-derivatives',
    name: 'P2P Derivatives',
    description: 'Get Leverage',
    Icon: TrendingUp,
    category: 'Trading',
    color: 'from-blue-500 to-indigo-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Derivatives! Trade with leverage in a peer-to-peer marketplace. What would you like to trade?",
  },
  {
    id: 'payday-loans',
    name: 'P2P Payday Loans',
    description: 'Instant approval',
    Icon: Banknote,
    category: 'Finance',
    color: 'from-lime-500 to-green-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Payday Loans! Get instant approval for short-term loans. How can I help you today?",
  },
  {
    id: 'crypto-offramp',
    name: 'P2P Crypto Offramp',
    description: 'Convert to cash',
    Icon: CreditCard,
    category: 'Trading',
    color: 'from-cyan-500 to-blue-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Crypto Offramp! Convert your crypto to cash easily. What would you like to sell?",
  },
  {
    id: 'fiat-onramp',
    name: 'P2P Fiat Onramp',
    description: 'Convert your cash',
    Icon: ArrowRightLeft,
    category: 'Trading',
    color: 'from-violet-500 to-purple-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Fiat Onramp! Convert your cash to crypto. What currency do you want to buy?",
  },
  {
    id: 'friendly-miners',
    name: 'Friendly Miners',
    description: 'Buy hash rate',
    Icon: Cpu,
    category: 'Mining',
    color: 'from-amber-500 to-orange-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Friendly Miners! Purchase hash rate from our network of miners. What are you looking for?",
  },
  {
    id: 'buy-anything',
    name: 'Buy Anything',
    description: 'Get product now',
    Icon: Package,
    category: 'Shopping',
    color: 'from-rose-500 to-red-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Buy Anything! Tell me what you're looking for and I'll help you find it.",
  },
  {
    id: 'sell-anything',
    name: 'Sell Anything',
    description: 'Get a quote',
    Icon: Tag,
    category: 'Shopping',
    color: 'from-teal-500 to-cyan-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Sell Anything! Describe what you want to sell and I'll get you a quote.",
  },
  {
    id: 'get-uct',
    name: 'Get UCT',
    description: 'Get unicity tokens',
    Icon: Coins,
    category: 'Tokens',
    color: 'from-yellow-400 to-amber-500',
    type: 'simple-ai',
    greetingMessage: "Welcome! I can help you acquire UCT (Unicity Tokens). How would you like to proceed?",
  },
  {
    id: 'p2p-swaps',
    name: 'P2P Swaps',
    description: 'Swap tokens directly',
    Icon: Repeat,
    category: 'Trading',
    color: 'from-purple-500 to-fuchsia-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to P2P Swaps! Exchange tokens directly with other users.",
  },
  {
    id: 'medication',
    name: 'Medication',
    description: 'Health & wellness',
    Icon: Pill,
    category: 'Health',
    color: 'from-red-500 to-rose-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Medication! I can help you with health and wellness information.",
  },
  {
    id: 'pokemon',
    name: 'Pokemon',
    description: 'Catch em all',
    Icon: Zap,
    category: 'Entertainment',
    color: 'from-yellow-500 to-red-500',
    type: 'simple-ai',
    greetingMessage: "Welcome to Pokemon! Ready to start your adventure?",
  },
];

// Get agent by ID
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId);
}
