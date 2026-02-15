import { Repeat, TrendingUp, Zap, ShoppingBag, Shield, CheckCircle } from 'lucide-react';
import type { IAgent, IAsset, IMessage, IUserContact } from '../types';

export const publicAgents: IAgent[] = [
  { id: '1', name: 'OTC Swap Deck', Icon: Repeat, category: 'DeFi', color: 'from-orange-500 to-red-500' },
  { id: '2', name: 'Mining', Icon: TrendingUp, category: 'Mining', color: 'from-emerald-500 to-teal-500' },
  { id: '3', name: 'Quake', Icon: Zap, category: 'Trading', color: 'from-yellow-500 to-orange-500' },
  { id: '4', name: 'P2P Marketplace', Icon: ShoppingBag, category: 'Trading', color: 'from-blue-500 to-cyan-500' },
  { id: '5', name: 'DeepFake Detector', Icon: Shield, category: 'Security', color: 'from-purple-500 to-pink-500' },
  { id: '6', name: 'Background Check', Icon: CheckCircle, category: 'Verification', color: 'from-indigo-500 to-purple-500' },
];

export const mockAssets: IAsset[] = [
  { id: '1', name: 'Unicity', ticker: 'UCT', amount: 151.23, value: 400523.45, change: 5.2, color: 'from-gray-400 to-gray-500' },
  { id: '2', name: 'Ethereum', ticker: 'ETH', amount: 0.51, value: 1876.32, change: 2.8, color: 'from-blue-400 to-blue-600' },
  { id: '3', name: 'Bitcoin', ticker: 'BTC', amount: 0.0041, value: 412.45, change: -1.2, color: 'from-orange-400 to-orange-600' },
  { id: '4', name: 'Solana', ticker: 'SOL', amount: 101.54, value: 8234.56, change: 8.4, color: 'from-purple-400 to-purple-600' },
  { id: '5', name: 'USDT', ticker: 'USDT', amount: 10412.12, value: 10412.12, change: 0.0, color: 'from-emerald-400 to-emerald-600' },
];

export const mockUsers: IUserContact[] = [
  { id: '1', name: 'Sarah Williams', avatar: 'SW', status: 'online', lastMessage: 'Hey! Thanks for connecting...', unread: 2 },
  { id: '2', name: 'Mike Johnson', avatar: 'MJ', status: 'online', lastMessage: 'Sounds good!', unread: 0 },
  { id: '3', name: 'Alex Chen', avatar: 'AC', status: 'offline', lastMessage: 'See you tomorrow', unread: 0 },
  { id: '4', name: 'Emma Davis', avatar: 'ED', status: 'online', lastMessage: 'Perfect, thanks!', unread: 1 },
];

export const globalMessages: IMessage[] = [
  { id: '1', sender: 'Alex Chen', avatar: 'AC', content: 'Hey everyone! Just completed a successful swap using the OTC agent 🚀', timestamp: '10:24 AM', isOwn: false },
  { id: '2', sender: 'Sarah Williams', avatar: 'SW', content: 'That\'s awesome! How was the experience?', timestamp: '10:25 AM', isOwn: false },
  { id: '3', sender: 'You', avatar: 'ME', content: 'Welcome to the platform! The agents are really powerful.', timestamp: '10:26 AM', isOwn: true },
  { id: '4', sender: 'Mike Johnson', avatar: 'MJ', content: 'Anyone tried the Mining agent yet? Looking for recommendations.', timestamp: '10:28 AM', isOwn: false },
  { id: '5', sender: 'Alex Chen', avatar: 'AC', content: 'Hey @sarah-williams check out this trade! Also cc @mike_johnson', timestamp: '10:30 AM', isOwn: false },
];

export const dmMessages: IMessage[] = [
  { id: '1', sender: 'Sarah Williams', avatar: 'SW', content: 'Hey! Thanks for connecting. I wanted to ask about your experience with the platform.', timestamp: '11:30 AM', isOwn: false },
  { id: '2', sender: 'You', avatar: 'ME', content: 'Hi! Sure, I\'d be happy to help. What would you like to know?', timestamp: '11:32 AM', isOwn: true },
];

export const l1Assets: IAsset[] = [
  { id: '1', name: 'Ethereum', ticker: 'ETH', amount: 0.85, value: 2150.50, change: 2.8, color: 'from-blue-400 to-blue-600' },
  { id: '2', name: 'Bitcoin', ticker: 'BTC', amount: 0.041, value: 1650.20, change: -1.2, color: 'from-orange-400 to-orange-600' },
  { id: '3', name: 'USDT', ticker: 'USDT', amount: 5000.00, value: 5000.00, change: 0.0, color: 'from-emerald-400 to-emerald-600' },
];

export const l2Assets: IAsset[] = [
  { id: '4', name: 'Unicity', ticker: 'UCT', amount: 1510.23, value: 4520.45, change: 12.5, color: 'from-orange-500 to-red-500' },
  { id: '5', name: 'Optimism', ticker: 'OP', amount: 450.00, value: 1250.00, change: 5.4, color: 'from-red-400 to-red-600' },
  { id: '6', name: 'Arbitrum', ticker: 'ARB', amount: 800.00, value: 1600.00, change: 3.2, color: 'from-cyan-400 to-blue-500' },
  { id: '7', name: 'Base', ticker: 'BASE', amount: 120.50, value: 340.20, change: 8.1, color: 'from-blue-500 to-indigo-600' },
];