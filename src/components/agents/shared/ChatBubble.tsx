import { Sparkles, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { parseMarkdown } from '../../../utils/markdown';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  agentName: string;
  agentColor: string;
  thinking?: string;
  // Copy functionality
  showCopy?: boolean;
  isCopied?: boolean;
  onCopy?: () => void;
  // Custom content after message
  children?: React.ReactNode;
}

export function ChatBubble({
  role,
  content,
  agentName,
  agentColor,
  thinking,
  showCopy = false,
  isCopied = false,
  onCopy,
  children,
}: ChatBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl p-4 ${
          role === 'user'
            ? `bg-linear-to-br ${agentColor} text-white shadow-lg`
            : 'bg-neutral-800/80 backdrop-blur-xl border border-neutral-700/50 text-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {role === 'assistant' && (
            <div className={`w-5 h-5 rounded-full bg-linear-to-br ${agentColor} flex items-center justify-center`}>
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          )}
          <span className={`text-xs ${role === 'user' ? 'text-white/80' : 'text-neutral-400'}`}>
            {role === 'user' ? 'You' : agentName}
          </span>
        </div>

        {/* Thinking indicator */}
        {thinking && (
          <details className="mb-2">
            <summary className="text-xs text-neutral-500 cursor-pointer">Thinking...</summary>
            <p className="text-xs text-neutral-500 mt-1 italic">{thinking}</p>
          </details>
        )}

        <div className="leading-relaxed">{parseMarkdown(content)}</div>

        {/* Custom content (cards, buttons, etc.) */}
        {children}

        {/* Copy button */}
        {showCopy && role === 'assistant' && content && onCopy && (
          <button
            onClick={onCopy}
            className="mt-3 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-green-400" />
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}
