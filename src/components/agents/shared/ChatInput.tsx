import { forwardRef } from 'react';
import { Send, Square } from 'lucide-react';
import { motion } from 'framer-motion';

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
    return (
      <div className="p-4 border-t border-neutral-800/50 bg-neutral-900/80 backdrop-blur-sm">
        <div className="flex gap-3">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-neutral-800/50 text-white placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-700/50"
            rows={1}
            disabled={disabled || isStreaming}
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
