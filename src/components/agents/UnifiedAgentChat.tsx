import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, ExternalLink, Copy, Check, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { useAgentChat } from '../../hooks/useAgentChat';
import { parseMarkdown } from '../../utils/markdown';
import { mockGames, type GameInfo } from '../../data/agentsMockData';

interface UnifiedAgentChatProps {
  agent: AgentConfig;
}

// Extended message type with optional content data
interface ExtendedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  thinking?: string;
  // Content cards
  games?: GameInfo[];
}

export function UnifiedAgentChat({ agent }: UnifiedAgentChatProps) {
  const [input, setInput] = useState('');
  const [extendedMessages, setExtendedMessages] = useState<ExtendedMessage[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasGreeted = useRef(false);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const {
    messages,
    setMessages,
    isStreaming,
    currentStatus,
    sendMessage,
    stopGeneration,
    agentMode,
  } = useAgentChat({
    activityId: agent.backendActivityId || agent.id,
  });

  // Sync messages with extended data
  useEffect(() => {
    setExtendedMessages(prev => {
      const newExtended: ExtendedMessage[] = messages.map(msg => {
        const existing = prev.find(e => e.id === msg.id);
        return {
          ...msg,
          games: existing?.games,
        };
      });
      return newExtended;
    });
  }, [messages]);

  // Greeting message
  useEffect(() => {
    if (!hasGreeted.current && messages.length === 0 && agent.greetingMessage) {
      hasGreeted.current = true;
      setMessages([{
        id: 'greeting',
        role: 'assistant',
        content: agent.greetingMessage,
        timestamp: Date.now(),
      }]);
    }
  }, [agent.greetingMessage, messages.length, setMessages]);

  // Mock response handler for games content type
  useEffect(() => {
    if (agentMode !== 'mock' || agent.contentType !== 'game') return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    // Check if we should attach game cards
    const content = lastMsg.content.toLowerCase();
    if (content.includes('quake') || content.includes('poker') || content.includes('game')) {
      setExtendedMessages(prev => prev.map(msg => {
        if (msg.id === lastMsg.id && !msg.games) {
          if (content.includes('quake')) {
            return { ...msg, games: [mockGames[0]] };
          } else if (content.includes('poker')) {
            return { ...msg, games: [mockGames[1]] };
          } else {
            return { ...msg, games: mockGames };
          }
        }
        return msg;
      }));
    }
  }, [messages, agentMode, agent.contentType]);

  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [extendedMessages, isStreaming]);

  // Focus input when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSend = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isStreaming) return;
    setInput('');
    // Focus immediately and keep focus
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
    await sendMessage(messageText);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (message: string) => {
    if (isStreaming) return;
    handleSend(message);
  };

  return (
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex flex-col relative shadow-2xl h-full">
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />

      {/* Header */}
      <div className="p-4 border-b border-neutral-800/50 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
              <agent.Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg text-white font-medium">{agent.name}</h2>
              <p className="text-sm text-neutral-400">{agent.description}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
        <AnimatePresence initial={false}>
          {extendedMessages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-4 ${
                  message.role === 'user'
                    ? `bg-linear-to-br ${agent.color} text-white shadow-lg`
                    : 'bg-neutral-800/80 backdrop-blur-xl border border-neutral-700/50 text-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {message.role === 'assistant' && (
                    <div className={`w-5 h-5 rounded-full bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                  <span className={`text-xs ${message.role === 'user' ? 'text-white/80' : 'text-neutral-400'}`}>
                    {message.role === 'user' ? 'You' : agent.name}
                  </span>
                </div>

                {/* Thinking indicator */}
                {message.thinking && (
                  <details className="mb-2">
                    <summary className="text-xs text-neutral-500 cursor-pointer">Thinking...</summary>
                    <p className="text-xs text-neutral-500 mt-1 italic">{message.thinking}</p>
                  </details>
                )}

                <div className="leading-relaxed">{parseMarkdown(message.content)}</div>

                {/* Game Cards (for games agent) */}
                {message.games && message.games.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {message.games.map((game) => (
                      <div key={game.id} className="rounded-xl overflow-hidden border border-neutral-600/50">
                        <img src={game.image} alt={game.name} className="w-full h-28 object-cover" />
                        <div className="p-3 bg-neutral-900/80">
                          <h4 className="font-medium text-white">{game.name}</h4>
                          <p className="text-sm text-neutral-400 mt-1">{game.description}</p>
                          <a
                            href={game.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-linear-to-r ${agent.color} text-white text-sm font-medium`}
                          >
                            Play Now <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Copy button for assistant messages */}
                {message.role === 'assistant' && message.content && (
                  <button
                    onClick={() => handleCopy(message.content, message.id)}
                    className="mt-3 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    {copiedId === message.id ? (
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
          ))}
        </AnimatePresence>

        {/* Typing indicator - only show while waiting for first content */}
        {isStreaming && (() => {
          const lastMsg = extendedMessages[extendedMessages.length - 1];
          const showIndicator = lastMsg?.role === 'assistant' && !lastMsg.content;
          return showIndicator ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  {currentStatus && (
                    <span className="text-xs text-neutral-400 ml-2">{currentStatus}</span>
                  )}
                </div>
              </div>
            </motion.div>
          ) : null;
        })()}
      </div>

      {/* Quick actions */}
      {agent.quickActions && agent.quickActions.length > 0 && (
        <div className="px-4 py-2 border-t border-neutral-800/30 relative z-10">
          <div className="flex gap-2 overflow-x-auto">
            {agent.quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.message)}
                disabled={isStreaming}
                className="px-3 py-1.5 rounded-lg bg-neutral-800/50 text-neutral-400 text-sm hover:bg-neutral-700/50 hover:text-white transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-neutral-800/50 relative z-10">
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={`Message ${agent.name}...`}
            className="flex-1 bg-neutral-800/50 text-white placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-700/50"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <motion.button
              onClick={stopGeneration}
              className={`px-5 py-2 rounded-xl bg-linear-to-r ${agent.color} text-white`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Square className="w-4 h-4" />
            </motion.button>
          ) : (
            <motion.button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className={`px-5 py-2 rounded-xl bg-linear-to-r ${agent.color} text-white disabled:opacity-50`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Send className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
