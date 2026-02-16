import { motion } from 'framer-motion';
import { type Conversation, getAvatar, getDisplayName } from '../data/chatTypes';
import { getColorFromPubkey } from '../utils/avatarColors';

interface MiniChatBubbleProps {
  conversation: Conversation;
  onClick: () => void;
  index: number;
}

export function MiniChatBubble({ conversation, onClick, index }: MiniChatBubbleProps) {
  const avatarColor = getColorFromPubkey(conversation.peerPubkey);

  return (
    <motion.button
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className="relative group"
    >
      {/* Bubble */}
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={`w-14 h-14 rounded-xl bg-linear-to-br ${avatarColor.gradient} flex items-center justify-center text-white font-semibold text-base shadow-lg cursor-pointer`}
      >
        {getAvatar(conversation.peerPubkey, conversation.peerNametag)}
      </motion.div>

      {/* Unread dot */}
      {conversation.unreadCount > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-500 border-2 border-white dark:border-neutral-800 shadow-md"
        />
      )}

      {/* Tooltip on hover */}
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-neutral-900 dark:bg-neutral-800 text-white text-sm rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
        {getDisplayName(conversation.peerPubkey, conversation.peerNametag)}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-neutral-900 dark:border-r-neutral-800" />
      </div>
    </motion.button>
  );
}
