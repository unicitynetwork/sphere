import { MessageSquare, Gamepad2, Trophy, ShoppingBag, Shirt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Agent types for different UI layouts
export type AgentType = 'chat' | 'simple-ai' | 'ai-with-sidebar';

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
    id: 'games',
    name: 'Games',
    description: 'Discover and play games',
    Icon: Gamepad2,
    category: 'Entertainment',
    color: 'from-purple-500 to-pink-500',
    type: 'simple-ai',
    greetingMessage: "Hey! Looking for some games? I can help you find something fun to play. We have Quake and other exciting games available. What are you in the mood for?",
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
  },
];

// Get agent by ID
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agents.find((a) => a.id === agentId);
}
