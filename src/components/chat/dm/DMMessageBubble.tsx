import { motion } from 'framer-motion';
import { Check, CheckCheck } from 'lucide-react';
import { type DisplayMessage, formatMessageTime } from '../data/chatTypes';
import { MarkdownContent } from '../../../utils/markdown';

interface DMMessageBubbleProps {
  message: DisplayMessage;
  delay?: number;
}

export function DMMessageBubble({ message, delay = 0 }: DMMessageBubbleProps) {
  const isOwn = message.isFromMe;

  const StatusIcon = () => {
    switch (message.status) {
      case 'SENT':
        return <Check className="w-3 h-3 text-white/60" />;
      case 'DELIVERED':
        return <CheckCheck className="w-3 h-3 text-white/60" />;
      case 'READ':
        return <CheckCheck className="w-3 h-3 text-blue-300" />;
      default:
        return <Check className="w-3 h-3 text-white/60" />;
    }
  };

  // Get avatar initials from sender
  const getAvatar = () => {
    if (message.senderNametag) {
      const name = message.senderNametag.replace('@', '');
      return name.slice(0, 2).toUpperCase();
    }
    return message.senderPubkey?.slice(0, 2).toUpperCase() || '??';
  };

  // Get display name
  const getDisplayName = () => {
    if (message.senderNametag) {
      return `@${message.senderNametag.replace('@', '')}`;
    }
    return message.senderPubkey?.slice(0, 8) || 'Unknown';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl p-4 ${
          isOwn
            ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
            : 'bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-xl border border-neutral-200 dark:border-neutral-700/50 text-neutral-800 dark:text-neutral-200'
        }`}
      >
        {/* Header with avatar and name - inside bubble */}
        {!isOwn && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-full bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-medium">
              {getAvatar()}
            </div>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {getDisplayName()}
            </span>
          </div>
        )}

        {/* Message content */}
        <div className="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
          <MarkdownContent
            text={message.content}
            mentionClassName={isOwn ? 'text-white' : 'text-orange-500'}
          />
        </div>
      </div>

      {/* Timestamp and status - below bubble */}
      <div className={`flex items-center gap-1.5 mt-1 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {formatMessageTime(message.timestamp)}
        </span>
        {isOwn && <StatusIcon />}
      </div>
    </motion.div>
  );
}
