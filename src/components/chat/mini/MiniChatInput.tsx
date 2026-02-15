import { useState, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface MiniChatInputProps {
  onSend: (content: string) => Promise<boolean>;
  isSending: boolean;
  placeholder?: string;
}

export function MiniChatInput({ onSend, isSending, placeholder = 'Aa' }: MiniChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (!value.trim() || isSending) return;
    const content = value;
    setValue('');
    const success = await onSend(content);
    if (!success) {
      setValue(content); // Restore on failure
    }
    // Refocus input after re-render completes
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  return (
    <div className="p-2 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isSending}
          className="flex-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 outline-none rounded-full px-4 py-2 text-sm border border-neutral-200 dark:border-neutral-700 focus:border-orange-500 transition-colors disabled:opacity-50"
        />
        <motion.button
          onClick={handleSend}
          disabled={!value.trim() || isSending}
          className="w-8 h-8 rounded-full bg-linear-to-r from-orange-500 to-orange-600 text-white disabled:opacity-50 flex items-center justify-center shrink-0"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </motion.button>
      </div>
    </div>
  );
}
