import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Loader2, Reply, CornerDownRight } from 'lucide-react';
import type { GroupMessageData } from '@unicitylabs/sphere-sdk';
import { MarkdownContent } from '../../../utils/markdown';
import { getMentionClickHandler } from '../../../utils/mentionHandler';
import { getColorFromPubkey } from '../utils/avatarColors';
import { getMessageSenderDisplayName, getMessageSenderAvatar, getMessageFormattedTime } from '../utils/groupChatHelpers';

interface GroupMessageBubbleProps {
  message: GroupMessageData;
  isOwnMessage: boolean;
  delay?: number;
  canDelete?: boolean;
  onDelete?: (messageId: string) => Promise<boolean>;
  isDeleting?: boolean;
  onReply?: (message: GroupMessageData) => void;
  replyToMessage?: GroupMessageData | null;
}

export function GroupMessageBubble({
  message,
  isOwnMessage,
  delay = 0,
  canDelete = false,
  onDelete,
  isDeleting = false,
  onReply,
  replyToMessage,
}: GroupMessageBubbleProps) {
  const senderColor = getColorFromPubkey(message.senderPubkey);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const handleNametagClick = () => {
    const handler = getMentionClickHandler();
    if (handler && message.senderNametag) {
      handler(message.senderNametag.replace('@', ''));
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (onDelete && message.id) {
      await onDelete(message.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''} group`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Sender Avatar */}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg bg-linear-to-br ${senderColor.gradient} text-white text-xs font-medium flex items-center justify-center shadow-md`}
      >
        {getMessageSenderAvatar(message)}
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
          {getMessageSenderDisplayName(message)}
        </button>

        {/* Reply-to preview */}
        {replyToMessage && (
          <div className={`flex items-start gap-2 mb-1 text-xs ${isOwnMessage ? 'flex-row-reverse' : ''}`}>
            <CornerDownRight className="w-3 h-3 text-neutral-400 shrink-0 mt-0.5" />
            <div className="px-2 py-1 rounded-lg bg-neutral-200/50 dark:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400 max-w-[200px] truncate">
              <span className="font-medium">{getMessageSenderDisplayName(replyToMessage)}: </span>
              {replyToMessage.content.slice(0, 50)}{replyToMessage.content.length > 50 ? '...' : ''}
            </div>
          </div>
        )}

        {/* Message bubble with delete/reply buttons */}
        <div className="relative">
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

          {/* Action buttons - absolutely positioned */}
          <AnimatePresence>
            {isHovering && !showDeleteConfirm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 ${
                  isOwnMessage ? '-left-16' : '-right-16'
                }`}
              >
                {/* Reply button */}
                {onReply && (
                  <button
                    onClick={() => onReply(message)}
                    className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 transition-colors"
                    title="Reply"
                  >
                    <Reply className="w-4 h-4" />
                  </button>
                )}
                {/* Delete button */}
                {canDelete && (
                  <button
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
                    title="Delete message"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delete confirmation */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute -right-24 top-1/2 -translate-y-1/2 flex items-center gap-1"
              >
                <button
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                >
                  {isDeleting ? '...' : 'Delete'}
                </button>
                <button
                  onClick={handleCancelDelete}
                  disabled={isDeleting}
                  className="px-2 py-1 text-xs font-medium rounded-lg bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 transition-colors"
                >
                  Cancel
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Timestamp */}
        <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 px-1">
          {getMessageFormattedTime(message)}
        </span>
      </div>
    </motion.div>
  );
}
