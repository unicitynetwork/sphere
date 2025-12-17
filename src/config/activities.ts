import { MessageSquare, Gamepad2, Trophy, ShoppingBag, Shirt, Brain, Sparkles } from 'lucide-react';
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
    name: 'Chat',
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
    greetingMessage: "Hi! I'm Viktor, your personal assistant.\nShort intro on me. I care a great deal about privacy. I don't know you, I don't log you, I don't even know your IP address. You are invisible here and nothing will be recorded about our conversation.\nHow can I help?",
    backendActivityId: 'ama',
    quickActions: [
      { label: 'Research', message: 'Research the latest news' },
      { label: 'Explain', message: 'Explain how something works' },
      { label: 'Help', message: 'Help me with a task' },
    ],
  },
  {
    id: 'trivia',
    name: 'Unicity Trivia',
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
      { label: 'A', message: 'A' },
      { label: 'B', message: 'B' },
      { label: 'C', message: 'C' },
      { label: 'D', message: 'D' },
    ],
    contentType: 'none',
  },
  {
    id: 'games',
    name: 'P2P Gaming',
    description: 'Discover and play games',
    Icon: Gamepad2,
    category: 'Entertainment',
    color: 'from-purple-500 to-pink-500',
    type: 'unified',
    greetingMessage: "Welcome to Unicity Gaming! 🎮 I can help you access our games. Ask me what games are available!",
    backendActivityId: 'gaming',
    quickActions: [
      { label: 'All games', message: 'Show me all games' },
      { label: 'Quake', message: 'Tell me about Quake' },
    ],
    contentType: 'game',
  },
  {
    id: 'sport',
    name: 'P2P Prediction',
    description: 'Sports prediction markets',
    Icon: Trophy,
    category: 'Prediction',
    color: 'from-emerald-500 to-teal-500',
    type: 'ai-with-sidebar',
    greetingMessage: "Welcome to the P2P Prediction Marketplace! 🏟️ Right now I'm only able to help you make predictions on sports games. I can help you check odds, make a prediction and show you what your active predictions are. What are we looking at ? English Premier League ? IPL ? Let me know and we can have some fun.",
    backendActivityId: 'sports',
    quickActions: [
      { label: 'Live odds', message: 'Show me live odds' },
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
  {
    id: 'merch',
    name: 'Unicity Merch',
    description: 'Merchandise store',
    Icon: Shirt,
    category: 'Shopping',
    color: 'from-yellow-500 to-orange-500',
    type: 'ai-with-sidebar',
    greetingMessage: "Welcome to the Merch Store! Check out our exclusive merchandise. What are you looking for today?",
    backendActivityId: 'merch',
    quickActions: [
      { label: 'All items', message: 'Show all merch' },
      { label: 'Mugs', message: 'Show mugs' },
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
