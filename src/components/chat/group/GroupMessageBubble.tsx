import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Loader2 } from 'lucide-react';
import { GroupMessage } from '../data/groupModels';
import { MarkdownContent } from '../../../utils/markdown';
import { getMentionClickHandler } from '../../../utils/mentionHandler';
import { getColorFromPubkey } from '../utils/avatarColors';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwnMessage: boolean;
  delay?: number;
  canDelete?: boolean;
  onDelete?: (messageId: string) => Promise<boolean>;
  isDeleting?: boolean;
}

export function GroupMessageBubble({
  message,
  isOwnMessage,
  delay = 0,
  canDelete = false,
  onDelete,
  isDeleting = false,
}: GroupMessageBubbleProps) {
  const senderColor = getColorFromPubkey(message.senderPubkey);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const handleNametagClick = () => {
    const handler = getMentionClickHandler();
    if (handler) {
      // Get nametag from message (convert display name to nametag format)
      const displayName = message.getSenderDisplayName();
      const nametag = displayName.toLowerCase().replace(/\s+/g, '-');
      handler(nametag);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (onDelete) {
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

        {/* Message bubble with delete button */}
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

          {/* Delete button - absolutely positioned on the right */}
          <AnimatePresence>
            {canDelete && isHovering && !showDeleteConfirm && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className="absolute -right-10 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
                title="Delete message"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </motion.button>
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
          {message.getFormattedTime()}
        </span>
      </div>
    </motion.div>
  );
}
