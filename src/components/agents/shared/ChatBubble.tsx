import { Sparkles, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { MarkdownContent } from '../../../utils/markdown';

function AnimatedDots({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-1.5 h-1.5 ${color} rounded-full animate-bounce`} />
      <div
        className={`w-1.5 h-1.5 ${color} rounded-full animate-bounce`}
        style={{ animationDelay: '0.1s' }}
      />
      <div
        className={`w-1.5 h-1.5 ${color} rounded-full animate-bounce`}
        style={{ animationDelay: '0.2s' }}
      />
    </div>
  );
}

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
  // Streaming state
  isStreaming?: boolean;
  currentStatus?: string | null;
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
  isStreaming = false,
  currentStatus = null,
}: ChatBubbleProps) {
  // Helper to determine dots color from agent color
  const getDotsColor = (agentColor: string): string => {
    if (agentColor.includes('indigo')) return 'bg-indigo-500';
    if (agentColor.includes('emerald') || agentColor.includes('teal')) return 'bg-emerald-500';
    if (agentColor.includes('orange') || agentColor.includes('red')) return 'bg-orange-500';
    if (agentColor.includes('purple') || agentColor.includes('pink')) return 'bg-purple-500';
    return 'bg-indigo-500';
  };

  // Helper to determine mention text color from agent color (for assistant messages)
  const getMentionTextColor = (agentColor: string): string => {
    if (agentColor.includes('yellow')) return 'text-yellow-500';
    if (agentColor.includes('indigo')) return 'text-indigo-500';
    if (agentColor.includes('emerald')) return 'text-emerald-500';
    if (agentColor.includes('teal')) return 'text-teal-500';
    if (agentColor.includes('orange')) return 'text-orange-500';
    if (agentColor.includes('red')) return 'text-red-500';
    if (agentColor.includes('purple')) return 'text-purple-500';
    if (agentColor.includes('pink')) return 'text-pink-500';
    if (agentColor.includes('blue')) return 'text-blue-500';
    if (agentColor.includes('green')) return 'text-green-500';
    return 'text-blue-500';
  };

  // Mention color: white for user (colored bubble), agent color for assistant (gray bubble)
  const mentionClassName = role === 'user' ? 'text-white' : getMentionTextColor(agentColor);

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
            : 'bg-neutral-100 dark:bg-neutral-800/80 backdrop-blur-xl border border-neutral-200 dark:border-neutral-700/50 text-neutral-800 dark:text-neutral-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {role === 'assistant' && (
            <div className={`w-5 h-5 rounded-full bg-linear-to-br ${agentColor} flex items-center justify-center`}>
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          )}
          <span className={`text-xs ${role === 'user' ? 'text-white/80' : 'text-neutral-500 dark:text-neutral-400'}`}>
            {role === 'user' ? 'You' : agentName}
          </span>
        </div>

        {/* Thinking/Status section with streaming support */}
        {role === 'assistant' && (isStreaming || thinking) && (
          <div className="mb-2">
            <details className="group">
              <summary className="flex items-center gap-2 text-xs text-neutral-400 dark:text-neutral-500 cursor-pointer list-none">
                {isStreaming && <AnimatedDots color={getDotsColor(agentColor)} />}
                <span>{currentStatus || 'Thinking...'}</span>
                {thinking && (
                  <span className="text-neutral-300 dark:text-neutral-600 ml-1">
                    ▸
                  </span>
                )}
              </summary>
              {thinking && (
                <div className="mt-2 pl-1">
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 italic leading-relaxed">
                    {thinking}
                  </p>
                </div>
              )}
            </details>
          </div>
        )}

        {/* Main content - only show if there's actual content */}
        {content && content.trim() && (
          <div className="leading-relaxed"><MarkdownContent text={content} mentionClassName={mentionClassName} /></div>
        )}

        {/* Custom content (cards, buttons, etc.) */}
        {children}

        {/* Copy button */}
        {showCopy && role === 'assistant' && content && onCopy && (
          <button
            onClick={onCopy}
            className="mt-3 flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-green-500 dark:text-green-400" />
                <span className="text-green-500 dark:text-green-400">Copied!</span>
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
