import { ShoppingBag, ArrowRightLeft, Wallet } from 'lucide-react';
import type { ActivityKind } from '../../types/activity';

interface ActivityIconProps {
  kind: ActivityKind;
  className?: string;
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
};

export function ActivityIcon({ kind, className = '' }: ActivityIconProps) {
  const config = iconConfig[kind] || iconConfig.wallet_created;
  const Icon = config.icon;

  return (
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${config.bgColor} flex items-center justify-center shadow-lg ${className}`}>
      <Icon className={`w-4 h-4 ${config.iconColor}`} />
    </div>
  );
}
