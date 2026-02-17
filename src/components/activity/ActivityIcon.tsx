import { ShoppingBag, ArrowRightLeft, Wallet, Gamepad2, ShoppingCart, Tag } from 'lucide-react';
import type { ActivityKind } from '../../types/activity';

interface ActivityIconProps {
  kind: ActivityKind;
  className?: string;
  size?: 'sm' | 'md';
}

const iconConfig: Record<ActivityKind, { icon: typeof ShoppingBag; bgColor: string; iconColor: string }> = {
  marketplace_post: {
    icon: ShoppingBag,
    bgColor: 'from-purple-500 to-purple-600',
    iconColor: 'text-white',
  },
  marketplace_offer: {
    icon: Tag,
    bgColor: 'from-indigo-500 to-indigo-600',
    iconColor: 'text-white',
  },
  token_transfer: {
    icon: ArrowRightLeft,
    bgColor: 'from-blue-500 to-blue-600',
    iconColor: 'text-white',
  },
  wallet_created: {
    icon: Wallet,
    bgColor: 'from-emerald-500 to-emerald-600',
    iconColor: 'text-white',
  },
  game_started: {
    icon: Gamepad2,
    bgColor: 'from-red-500 to-orange-500',
    iconColor: 'text-white',
  },
  merch_order: {
    icon: ShoppingCart,
    bgColor: 'from-pink-500 to-rose-500',
    iconColor: 'text-white',
  },
};

// Intent type icon config for market feed listings
const intentIconConfig: Record<string, { icon: typeof ShoppingBag; bgColor: string; iconColor: string }> = {
  sell: {
    icon: Tag,
    bgColor: 'from-purple-500 to-purple-600',
    iconColor: 'text-white',
  },
  buy: {
    icon: ShoppingCart,
    bgColor: 'from-indigo-500 to-indigo-600',
    iconColor: 'text-white',
  },
  service: {
    icon: Wrench,
    bgColor: 'from-cyan-500 to-teal-500',
    iconColor: 'text-white',
  },
  announcement: {
    icon: Megaphone,
    bgColor: 'from-amber-500 to-orange-500',
    iconColor: 'text-white',
  },
  other: {
    icon: Sparkles,
    bgColor: 'from-emerald-500 to-emerald-600',
    iconColor: 'text-white',
  },
};

const defaultIntentIcon = intentIconConfig.other;

export function ActivityIcon({ kind, className = '', size = 'md' }: ActivityIconProps) {
  const config = iconConfig[kind] || iconConfig.wallet_created;
  const Icon = config.icon;

  const sizeClasses = size === 'sm'
    ? 'w-5 h-5 rounded-md'
    : 'w-8 h-8 rounded-lg';

  const iconSizeClasses = size === 'sm'
    ? 'w-3 h-3'
    : 'w-4 h-4';

  return (
    <div className={`${sizeClasses} bg-linear-to-br ${config.bgColor} flex items-center justify-center shadow-lg ${className}`}>
      <Icon className={`${iconSizeClasses} ${config.iconColor}`} />
    </div>
  );
}

interface IntentIconProps {
  intentType: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function IntentIcon({ intentType, className = '', size = 'md' }: IntentIconProps) {
  const config = intentIconConfig[intentType] || defaultIntentIcon;
  const Icon = config.icon;

  const sizeClasses = size === 'sm'
    ? 'w-5 h-5 rounded-md'
    : 'w-8 h-8 rounded-lg';

  const iconSizeClasses = size === 'sm'
    ? 'w-3 h-3'
    : 'w-4 h-4';

  return (
    <div className={`${sizeClasses} bg-linear-to-br ${config.bgColor} flex items-center justify-center shadow-lg ${className}`}>
      <Icon className={`${iconSizeClasses} ${config.iconColor}`} />
    </div>
  );
}
