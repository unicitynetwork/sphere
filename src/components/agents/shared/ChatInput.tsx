import { forwardRef, useRef, useImperativeHandle } from 'react';
import { Send, Square } from 'lucide-react';
import { motion } from 'framer-motion';
import { useKeyboardScrollIntoView } from '../../../hooks/useKeyboardScrollIntoView';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  agentColor: string;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      value,
      onChange,
      onSend,
      onKeyDown,
      placeholder = 'Type a message...',
      disabled = false,
      isStreaming = false,
      onStop,
      agentColor,
    },
    ref
  ) {
    const internalRef = useRef<HTMLTextAreaElement>(null);

    // Expose the internal ref to parent components
    useImperativeHandle(ref, () => internalRef.current!, []);

    // Use Visual Viewport API to scroll input into view when keyboard opens
    useKeyboardScrollIntoView(internalRef);

    return (
      <div
        className="p-4 border-t border-neutral-200 dark:border-neutral-800/50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm theme-transition"
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))' }}
      >
        <div className="flex gap-3">
          <textarea
            ref={internalRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-200 dark:border-neutral-700/50 text-base theme-transition"
            rows={1}
            disabled={disabled || isStreaming}
            enterKeyHint="send"
          />
          {isStreaming && onStop ? (
            <motion.button
              onClick={onStop}
              className={`px-5 py-2 rounded-xl bg-linear-to-r ${agentColor} text-white`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Square className="w-4 h-4" />
            </motion.button>
          ) : (
            <motion.button
              onClick={onSend}
              disabled={!value.trim() || disabled}
              className={`px-5 py-2 rounded-xl bg-linear-to-r ${agentColor} text-white disabled:opacity-50`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Send className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>
    );
  }
);
