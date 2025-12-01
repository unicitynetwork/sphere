import { motion } from 'framer-motion';
import type { IUserContact } from '../../../types';

interface UserContactProps {
  user: IUserContact;
  isSelected: boolean;
  onClick: () => void;
}

export function UserContact({ user, isSelected, onClick }: UserContactProps) {
  const statusColor = user.status === 'online' ? 'bg-emerald-400' : 'bg-neutral-400 dark:bg-neutral-600';
  const isOnline = user.status === 'online';

  return (
    <motion.button
      key={user.id}
      whileHover={{ scale: 1.02, x: 4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full p-3 rounded-xl text-left transition-all relative overflow-hidden group ${
        isSelected
          ? 'bg-neutral-100 dark:bg-neutral-800/80 border border-orange-500/50 shadow-lg shadow-orange-500/10'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/50 border border-transparent'
      }`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-linear-to-r from-orange-500/10 to-transparent" />
      )}

      <div className="flex items-center gap-3 relative z-10">
        <div className="relative">
          {/* Avatar */}
          <div className="relative w-10 h-10 rounded-lg bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-sm shadow-lg">
            {user.avatar}
          </div>
          {/* Status dot */}
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900 ${statusColor}`}>
            {isOnline && (
              <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {/* Name and Unread count */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-neutral-900 dark:text-white text-sm truncate">{user.name}</span>
            {user.unread && user.unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs shadow-lg shadow-orange-500/30"
              >
                {user.unread}
              </motion.span>
            )}
          </div>
          <p className="text-xs text-neutral-500 truncate">{user.lastMessage}</p>
        </div>
      </div>
    </motion.button>
  );
}
