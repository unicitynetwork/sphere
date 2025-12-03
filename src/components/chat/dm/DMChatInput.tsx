import { forwardRef, useRef, useImperativeHandle } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useKeyboardScrollIntoView } from '../../../hooks/useKeyboardScrollIntoView';

interface DMChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isSending?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export const DMChatInput = forwardRef<HTMLTextAreaElement, DMChatInputProps>(
  function DMChatInput(
    {
      value,
      onChange,
      onSend,
      isSending = false,
      placeholder = 'Type a message...',
      disabled = false,
    },
    ref
  ) {
    const internalRef = useRef<HTMLTextAreaElement>(null);

    // Expose the internal ref to parent components
    useImperativeHandle(ref, () => internalRef.current!, []);

    // Use Visual Viewport API to scroll input into view when keyboard opens
    useKeyboardScrollIntoView(internalRef);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !isSending && !disabled) {
          onSend();
        }
      }
    };

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
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSending}
            className="flex-1 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-200 dark:border-neutral-700/50 text-base theme-transition disabled:opacity-50"
            rows={1}
            enterKeyHint="send"
          />
          <motion.button
            onClick={onSend}
            disabled={!value.trim() || isSending || disabled}
            className="px-5 py-2 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white disabled:opacity-50 flex items-center justify-center min-w-[60px]"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </motion.button>
        </div>
      </div>
    );
  }
);
