import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { ChatConversation } from '../data/models';

interface DMConversationItemProps {
  conversation: ChatConversation;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export function DMConversationItem({
  conversation,
  isSelected,
  onClick,
  onDelete,
}: DMConversationItemProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`p-3 rounded-xl cursor-pointer transition-all relative overflow-hidden group ${
        isSelected
          ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
          : 'bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-700/50'
      }`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/10 to-white/0" />
      )}

      <div className="flex items-center gap-3 relative z-10">
        {/* Avatar */}
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium shrink-0 ${
            isSelected
              ? 'bg-white/20 text-white'
              : 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-md'
          }`}
        >
          {conversation.getAvatar()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-medium truncate ${
                isSelected ? 'text-white' : 'text-neutral-900 dark:text-white'
              }`}
            >
              {conversation.getDisplayName()}
            </span>
            <span
              className={`text-xs shrink-0 ${
                isSelected ? 'text-white/70' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              {conversation.getFormattedLastMessageTime()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p
              className={`text-sm truncate ${
                isSelected ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              {conversation.lastMessageText || 'No messages yet'}
            </p>
            {conversation.unreadCount > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : 'bg-orange-500 text-white'
                }`}
              >
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>

        {/* Delete button (visible on hover) */}
        <motion.button
          onClick={handleDelete}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${
            isSelected
              ? 'hover:bg-white/20 text-white'
              : 'hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500'
          }`}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <Trash2 className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
}
