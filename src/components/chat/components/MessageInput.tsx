// src/components/chat/components/MessageInput.tsx
import { Send } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatState } from '../../../hooks/useChatState';

type InputProps = Pick<ChatState, 'chatMode' | 'selectedUser' | 'message' | 'setMessage' | 'handleSend'>;

export function MessageInput({ chatMode, selectedUser, message, setMessage, handleSend }: InputProps) {

  const placeholderText = `Message ${chatMode === 'global' ? 'global channel' : selectedUser?.name || 'user'}...`;

  return (
    <div
      className="p-4 border-t border-neutral-200 dark:border-neutral-800/50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm theme-transition"
      style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))' }}
    >
      <div className="flex gap-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholderText}
          className="flex-1 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-200 dark:border-neutral-700/50 text-base theme-transition"
          rows={1}
          enterKeyHint="send"
        />
        <motion.button
          onClick={handleSend}
          disabled={!message.trim()}
          className="px-5 py-2 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white disabled:opacity-50"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Send className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
}
