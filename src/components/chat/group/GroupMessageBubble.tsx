import { motion } from 'framer-motion';
import { GroupMessage } from '../data/groupModels';
import { MarkdownContent } from '../../../utils/markdown';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwnMessage: boolean;
  delay?: number;
}

/**
 * Generate a consistent color based on a string (pubkey)
 */
function getColorFromPubkey(pubkey: string): string {
  const colors = [
    'from-blue-500 to-blue-600',
    'from-purple-500 to-purple-600',
    'from-green-500 to-green-600',
    'from-pink-500 to-pink-600',
    'from-indigo-500 to-indigo-600',
    'from-teal-500 to-teal-600',
    'from-cyan-500 to-cyan-600',
    'from-rose-500 to-rose-600',
  ];

  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = pubkey.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export function GroupMessageBubble({ message, isOwnMessage, delay = 0 }: GroupMessageBubbleProps) {
  const senderColor = getColorFromPubkey(message.senderPubkey);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
    >
      {/* Sender Avatar */}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg bg-linear-to-br ${senderColor} text-white text-xs font-medium flex items-center justify-center shadow-md`}
      >
        {message.getSenderAvatar()}
      </div>

      {/* Message Content */}
      <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} max-w-[75%]`}>
        {/* Sender name */}
        <span className={`text-xs font-medium mb-1 ${
          isOwnMessage
            ? 'text-orange-500'
            : 'text-neutral-500 dark:text-neutral-400'
        }`}>
          {message.getSenderDisplayName()}
        </span>

        {/* Message bubble */}
        <motion.div
          whileHover={{ scale: 1.01 }}
          className={`rounded-2xl px-4 py-3 relative overflow-hidden ${
            isOwnMessage
              ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
              : 'bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-sm text-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700/50'
          }`}
        >
          {isOwnMessage && (
            <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/10 to-white/0" />
          )}

          <div className="text-sm leading-relaxed relative z-10 wrap-break-word whitespace-pre-wrap">
            <MarkdownContent text={message.content} />
          </div>
        </motion.div>

        {/* Timestamp */}
        <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 px-1">
          {message.getFormattedTime()}
        </span>
      </div>
    </motion.div>
  );
}
