import { motion } from 'framer-motion';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

const roundedClasses = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};

export function Skeleton({ className = '', width, height, rounded = 'md' }: SkeletonProps) {
  return (
    <div
      className={`bg-neutral-200 dark:bg-neutral-800 skeleton-shimmer ${roundedClasses[rounded]} ${className}`}
      style={{ width, height }}
    />
  );
}

// Message skeleton for chat
function MessageSkeleton({ isOwn = false }: { isOwn?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}
    >
      <div className={`flex items-end gap-2 max-w-[75%] ${isOwn ? 'flex-row-reverse' : ''}`}>
        <Skeleton width={32} height={32} rounded="full" />
        <div className={`${isOwn ? 'bg-orange-500/20' : 'bg-neutral-100 dark:bg-neutral-800/50'} rounded-2xl p-3 space-y-2 min-w-[150px]`}>
          <Skeleton height={12} className="w-full" rounded="md" />
          <Skeleton height={12} className="w-3/4" rounded="md" />
          <Skeleton height={10} className="w-1/4 mt-2" rounded="md" />
        </div>
      </div>
    </motion.div>
  );
}

// Multiple message skeletons
export function MessageListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} isOwn={i % 3 === 0} />
      ))}
    </div>
  );
}

// Asset row skeleton for L3 wallet
function AssetRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="p-3 rounded-xl"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton width={40} height={40} rounded="xl" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton width={60} height={14} rounded="md" />
              <Skeleton width={80} height={12} rounded="md" />
            </div>
            <Skeleton width={100} height={12} rounded="md" />
          </div>
        </div>
        <div className="text-right space-y-2">
          <Skeleton width={70} height={14} rounded="md" />
          <Skeleton width={50} height={12} rounded="md" className="ml-auto" />
        </div>
      </div>
    </motion.div>
  );
}

// Multiple asset row skeletons
export function AssetListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <AssetRowSkeleton key={i} delay={i * 0.05} />
      ))}
    </div>
  );
}

// Transaction row skeleton for history
function TransactionRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <Skeleton width={60} height={16} rounded="md" />
          <Skeleton width={100} height={14} rounded="md" />
        </div>
        <Skeleton width={120} height={16} rounded="md" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Skeleton width={80} height={12} rounded="md" />
        <Skeleton width={60} height={12} rounded="md" />
        <Skeleton width={100} height={12} rounded="md" />
      </div>
      <div className="space-y-1">
        <Skeleton width="70%" height={12} rounded="md" />
        <Skeleton width="60%" height={12} rounded="md" />
      </div>
    </motion.div>
  );
}

// Multiple transaction row skeletons
export function TransactionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <TransactionRowSkeleton key={i} delay={i * 0.05} />
      ))}
    </div>
  );
}

// Conversation item skeleton
function ConversationItemSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="flex items-center gap-3 p-3 rounded-xl"
    >
      <Skeleton width={48} height={48} rounded="xl" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton width={100} height={14} rounded="md" />
          <Skeleton width={40} height={10} rounded="md" />
        </div>
        <Skeleton width="80%" height={12} rounded="md" />
      </div>
    </motion.div>
  );
}

// Multiple conversation skeletons
export function ConversationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <ConversationItemSkeleton key={i} delay={i * 0.05} />
      ))}
    </div>
  );
}

// Wallet loading skeleton for L3WalletView
export function WalletLoadingSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full p-6"
    >
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton width={100} height={12} rounded="md" />
          <Skeleton width={8} height={8} rounded="full" />
        </div>
        <Skeleton width={200} height={36} rounded="lg" className="mb-4" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton height={48} rounded="xl" />
          <Skeleton height={48} rounded="xl" />
        </div>
      </div>
      <div className="mb-4">
        <div className="flex p-1 bg-neutral-100 dark:bg-neutral-900/50 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <Skeleton className="flex-1" height={32} rounded="lg" />
          <Skeleton className="flex-1" height={32} rounded="lg" />
        </div>
      </div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Skeleton width={16} height={16} rounded="md" />
          <Skeleton width={100} height={14} rounded="md" />
        </div>
        <Skeleton width={50} height={12} rounded="md" />
      </div>
      <AssetListSkeleton count={4} />
    </motion.div>
  );
}
