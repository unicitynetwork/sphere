import { motion } from 'framer-motion';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { ChatMessage, MessageStatus } from '../data/models';

interface DMMessageBubbleProps {
  message: ChatMessage;
  delay?: number;
}

export function DMMessageBubble({ message, delay = 0 }: DMMessageBubbleProps) {
  const isOwn = message.isFromMe;

  const StatusIcon = () => {
    switch (message.status) {
      case MessageStatus.PENDING:
        return <Clock className="w-3 h-3 text-white/60" />;
      case MessageStatus.SENT:
        return <Check className="w-3 h-3 text-white/60" />;
      case MessageStatus.DELIVERED:
      case MessageStatus.READ:
        return <CheckCheck className="w-3 h-3 text-white/60" />;
      case MessageStatus.FAILED:
        return <AlertCircle className="w-3 h-3 text-red-300" />;
      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar for received messages */}
      {!isOwn && (
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-xs font-medium shadow-md">
            {message.senderNametag?.slice(0, 2).toUpperCase() ||
              message.senderPubkey?.slice(0, 2).toUpperCase() ||
              '??'}
          </div>
        </div>
      )}

      {/* Message content */}
      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[75%]`}>
        <motion.div
          whileHover={{ scale: 1.01 }}
          className={`rounded-2xl px-4 py-3 relative overflow-hidden ${
            isOwn
              ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
              : 'bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-sm text-neutral-800 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700/50'
          }`}
        >
          {isOwn && (
            <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/10 to-white/0" />
          )}

          <p className="text-sm leading-relaxed relative z-10 break-words whitespace-pre-wrap">
            {message.content}
          </p>
        </motion.div>

        {/* Timestamp and status */}
        <div
          className={`flex items-center gap-1.5 mt-1 px-1 ${
            isOwn ? 'flex-row-reverse' : ''
          }`}
        >
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {message.getFormattedTime()}
          </span>
          {isOwn && <StatusIcon />}
        </div>
      </div>
    </motion.div>
  );
}
