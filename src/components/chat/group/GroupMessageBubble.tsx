import { motion } from 'framer-motion';
import { GroupMessage } from '../data/groupModels';
import { MarkdownContent } from '../../../utils/markdown';
import { getMentionClickHandler } from '../../../utils/mentionHandler';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwnMessage: boolean;
  delay?: number;
}

/**
 * Color data for consistent user colors based on pubkey
 */
interface UserColor {
  gradient: string;
  text: string;
}

function getColorFromPubkey(pubkey: string): UserColor {
  const colors: UserColor[] = [
    { gradient: 'from-blue-500 to-blue-600', text: 'text-blue-500' },
    { gradient: 'from-purple-500 to-purple-600', text: 'text-purple-500' },
    { gradient: 'from-green-500 to-green-600', text: 'text-green-500' },
    { gradient: 'from-pink-500 to-pink-600', text: 'text-pink-500' },
    { gradient: 'from-indigo-500 to-indigo-600', text: 'text-indigo-500' },
    { gradient: 'from-teal-500 to-teal-600', text: 'text-teal-500' },
    { gradient: 'from-cyan-500 to-cyan-600', text: 'text-cyan-500' },
    { gradient: 'from-rose-500 to-rose-600', text: 'text-rose-500' },
  ];

  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = pubkey.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export function GroupMessageBubble({ message, isOwnMessage, delay = 0 }: GroupMessageBubbleProps) {
  const senderColor = getColorFromPubkey(message.senderPubkey);

  const handleNametagClick = () => {
    const handler = getMentionClickHandler();
    if (handler) {
      // Get nametag from message (convert display name to nametag format)
      const displayName = message.getSenderDisplayName();
      const nametag = displayName.toLowerCase().replace(/\s+/g, '-');
      handler(nametag);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
    >
      {/* Sender Avatar */}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg bg-linear-to-br ${senderColor.gradient} text-white text-xs font-medium flex items-center justify-center shadow-md`}
      >
        {message.getSenderAvatar()}
      </div>

      {/* Message Content */}
      <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'} max-w-[75%]`}>
        {/* Sender name - clickable to open DM */}
        <button
          onClick={handleNametagClick}
          className={`text-xs font-medium mb-1 hover:underline cursor-pointer transition-colors ${
            isOwnMessage
              ? 'text-white/90 hover:text-white'
              : senderColor.text
          }`}
        >
          {message.getSenderDisplayName()}
        </button>

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
