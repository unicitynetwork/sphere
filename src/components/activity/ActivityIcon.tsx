import { ShoppingBag, ArrowRightLeft, Wallet, Gamepad2, TrendingUp, Handshake, ShoppingCart } from 'lucide-react';
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
  bet_placed: {
    icon: TrendingUp,
    bgColor: 'from-yellow-500 to-amber-500',
    iconColor: 'text-white',
  },
  otc_purchase: {
    icon: Handshake,
    bgColor: 'from-cyan-500 to-teal-500',
    iconColor: 'text-white',
  },
  merch_order: {
    icon: ShoppingCart,
    bgColor: 'from-pink-500 to-rose-500',
    iconColor: 'text-white',
  },
};

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
