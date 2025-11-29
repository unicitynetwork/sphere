import { MessageSquare, Gamepad2, Trophy, ShoppingBag, Shirt, Brain } from 'lucide-react';
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
    name: 'Chat',
    description: 'DM and group messaging',
    Icon: MessageSquare,
    category: 'Social',
    color: 'from-blue-500 to-cyan-500',
    type: 'chat',
  },
  {
    id: 'trivia',
    name: 'Trivia',
    description: 'Test your knowledge!',
    Icon: Brain,
    category: 'Entertainment',
    color: 'from-indigo-500 to-cyan-500',
    type: 'unified',
    greetingMessage: "Welcome to Trivia Challenge! I can quiz you on various topics. Say 'start' to begin, or ask for available categories!",
    backendActivityId: 'trivia',
    quickActions: [
      { label: 'Start game', message: 'Start game' },
      { label: 'Categories', message: 'Show categories' },
      { label: 'My score', message: 'Show my score' },
    ],
    contentType: 'none',
  },
  {
    id: 'games',
    name: 'Games',
    description: 'Discover and play games',
    Icon: Gamepad2,
    category: 'Entertainment',
    color: 'from-purple-500 to-pink-500',
    type: 'unified',
    greetingMessage: "Hey! Looking for some games? I can help you find something fun to play. We have Quake and other exciting games available. What are you in the mood for?",
    backendActivityId: 'games',
    quickActions: [
      { label: 'Show games', message: 'Show me games' },
      { label: 'Quake', message: 'Tell me about Quake' },
      { label: 'Poker', message: 'Tell me about poker' },
    ],
    contentType: 'game',
  },
  {
    id: 'sport',
    name: 'Sport',
    description: 'Sports betting',
    Icon: Trophy,
    category: 'Betting',
    color: 'from-emerald-500 to-teal-500',
    type: 'ai-with-sidebar',
    greetingMessage: "Welcome to Sports Betting! I can help you place bets on football, basketball, and other sports. What match are you interested in?",
    backendActivityId: 'sport',
    quickActions: [
      { label: 'Show matches', message: 'Show me matches' },
      { label: 'Football', message: 'Football matches' },
      { label: 'My bets', message: 'Show my bets' },
    ],
    contentType: 'match',
    hasSidebar: true,
  },
  {
    id: 'p2p',
    name: 'P2P',
    description: 'Peer-to-peer trading',
    Icon: ShoppingBag,
    category: 'Trading',
    color: 'from-orange-500 to-red-500',
    type: 'ai-with-sidebar',
    greetingMessage: "Welcome to P2P Trading! I can help you buy and sell crypto directly with other users. What would you like to trade?",
    backendActivityId: 'p2p',
    quickActions: [
      { label: 'Browse', message: "What's available?" },
      { label: 'Electronics', message: 'Show electronics' },
      { label: 'Furniture', message: 'Show furniture' },
    ],
    contentType: 'product',
    hasSidebar: true,
  },
  {
    id: 'merch',
    name: 'Merch',
    description: 'Merchandise store',
    Icon: Shirt,
    category: 'Shopping',
    color: 'from-yellow-500 to-orange-500',
    type: 'ai-with-sidebar',
    greetingMessage: "Welcome to the Merch Store! Check out our exclusive merchandise. What are you looking for today?",
    backendActivityId: 'merch',
    quickActions: [
      { label: 'All items', message: 'Show all merch' },
      { label: 'Hoodies', message: 'Show hoodies' },
      { label: 'T-Shirts', message: 'Show t-shirts' },
    ],
    contentType: 'merch',
    hasSidebar: true,
  },
];

// Get agent by ID
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId);
}
