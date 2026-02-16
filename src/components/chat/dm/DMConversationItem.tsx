import { motion } from 'framer-motion';
import { type Conversation, getAvatar, getDisplayName, formatRelativeTime } from '../data/chatTypes';
import { getColorFromPubkey } from '../utils/avatarColors';

interface DMConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export function DMConversationItem({
  conversation,
  isSelected,
  onClick,
}: DMConversationItemProps) {
  const avatarColor = getColorFromPubkey(conversation.peerPubkey);

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`p-3 rounded-xl cursor-pointer transition-all relative overflow-hidden ${
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
        <div className="relative shrink-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium bg-linear-to-br ${avatarColor.gradient} text-white shadow-md`}
          >
            {getAvatar(conversation.peerPubkey, conversation.peerNametag)}
          </div>
          {conversation.unreadCount > 0 && !isSelected && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white dark:border-neutral-800" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-medium truncate ${
                isSelected ? 'text-white' : 'text-neutral-900 dark:text-white'
              }`}
            >
              {getDisplayName(conversation.peerPubkey, conversation.peerNametag)}
            </span>
            <span
              className={`text-xs shrink-0 ${
                isSelected ? 'text-white/70' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              {formatRelativeTime(conversation.lastMessageTime)}
            </span>
          </div>
          <p
            className={`text-sm truncate mt-0.5 ${
              isSelected ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {conversation.lastMessageText || 'No messages yet'}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
