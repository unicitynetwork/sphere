import { type LucideIcon } from "lucide-react";

export type ChatMode = 'global' | 'dm';
export type ChatModeChangeHandler = (mode: ChatMode, dmRecipient?: string) => void;

/**
 * Memory state stored in browser localStorage
 * Used for persistent user preferences and context across sessions
 */
export interface MemoryState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface IAgent {
  id: string;
  name: string;
  Icon: LucideIcon;
  category: string;
  color: string;
  isSelected?: boolean;
}

export interface ICryptoPriceData {
  priceUsd: number;
  priceEur: number;
  change24h: number;
  timestamp: number;
}