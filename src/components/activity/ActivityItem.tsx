import { motion } from 'framer-motion';
import { ActivityIcon } from './ActivityIcon';
import type { Activity, ActivityKind } from '../../types/activity';

interface ActivityItemProps {
  activity: Activity;
  isNew?: boolean;
}

function getActivityTitle(kind: ActivityKind): string {
  switch (kind) {
    case 'marketplace_post':
      return 'New Listing';
    case 'token_transfer':
      return 'Token Transfer';
    case 'wallet_created':
      return 'New Wallet';
    default:
      return 'Activity';
  }
}

function getActivityDescription(activity: Activity): string {
  const data = activity.data || {};

  switch (activity.kind) {
    case 'marketplace_post':
      if (data.title) {
        return `"${data.title}" posted for ${data.price} ${data.currency || 'ALPHA'}`;
      }
      return 'A new item was listed';
    case 'token_transfer':
      if (data.amount && data.symbol) {
        return `${data.amount} ${data.symbol} transferred`;
      }
      return 'Tokens were transferred';
    case 'wallet_created':
      return 'A new wallet joined the network';
    default:
      return 'Network activity';
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function ActivityItem({ activity, isNew = false }: ActivityItemProps) {
  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: -20, scale: 0.95 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`
        flex items-center gap-3 p-3 rounded-xl
        bg-white/50 dark:bg-neutral-800/50
        border border-neutral-200/50 dark:border-neutral-700/50
        hover:bg-neutral-50 dark:hover:bg-neutral-800/70
        transition-colors cursor-default
        ${isNew ? 'ring-2 ring-orange-500/30 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900' : ''}
      `}
    >
      <ActivityIcon kind={activity.kind} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">
            {getActivityTitle(activity.kind)}
          </span>
          {isNew && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded-full"
            >
              new
            </motion.span>
          )}
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {getActivityDescription(activity)}
        </p>
      </div>

      <span className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
        {formatTimeAgo(activity.createdAt)}
      </span>
    </motion.div>
  );
}
