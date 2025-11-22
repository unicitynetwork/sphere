import { type LucideIcon } from "lucide-react";

export type ChatMode = 'global' | 'dm';

export interface IAgent {
  id: string;
  name: string;
  Icon: LucideIcon;
  category: string;
  color: string;
  isSelected?: boolean;
  onClick?: () => void;
}

export interface IAsset {
  id: string;
  name: string;
  ticker: string;
  amount: number;
  value: number;
  change: number;
  color: string;
}

export interface IMessage {
  id: string;
  sender: string;
  avatar: string;
  content: string;
  timestamp: string;
  isOwn: boolean;
}

export interface IUserContact {
  id: string;
  name: string;
  avatar: string;
  status: 'online' | 'offline';
  lastMessage?: string;
  unread?: number;
}