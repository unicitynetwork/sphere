import { motion } from 'framer-motion';

interface TypingIndicatorProps {
  color?: string;
  status?: string | null;
}

export function TypingIndicator({ color = 'bg-indigo-500', status }: TypingIndicatorProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 ${color} rounded-full animate-bounce`} />
          <div
            className={`w-2 h-2 ${color} rounded-full animate-bounce`}
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className={`w-2 h-2 ${color} rounded-full animate-bounce`}
            style={{ animationDelay: '0.2s' }}
          />
          {status && <span className="text-xs text-neutral-400 ml-2">{status}</span>}
        </div>
      </div>
    </motion.div>
  );
}
