import { MessageSquare, Store, Globe, Bot, Cpu } from 'lucide-react';
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
  // Multiple URL options for iframe agents (shows a URL picker)
  iframeUrls?: { label: string; url: string }[];
}

// All agents configuration
const allAgents: AgentConfig[] = [
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
    id: 'astrid',
    name: 'Astrid',
    description: 'Astrid AI agent',
    Icon: Cpu,
    category: 'Agent',
    color: 'from-teal-500 to-cyan-600',
    type: 'iframe',
  },
  {
    id: 'unibot',
    name: 'Unibot',
    description: 'Unibot assistant',
    Icon: Bot,
    category: 'Agent',
    color: 'from-amber-500 to-orange-600',
    type: 'iframe',
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
  {
    id: 'custom',
    name: 'Sphere Agents',
    description: 'Load any URL (e.g. localhost)',
    Icon: Globe,
    category: 'Custom',
    color: 'from-indigo-500 to-violet-600',
    type: 'iframe',
  },
];

export const agents: AgentConfig[] = allAgents;

// Get agent by ID
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId);
}

// Check if an agent requires a wallet to function
export function agentRequiresWallet(agentId: string): boolean {
  const agent = getAgentConfig(agentId);
  return agent?.requiresWallet ?? false;
}
