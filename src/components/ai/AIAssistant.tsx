import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2, Globe, Copy, Check, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentChat, getAgentMode } from '../../hooks/useAgentChat';
import { parseMarkdown } from '../../utils/markdown.tsx';

export function AIAssistant() {
  const [input, setInput] = useState('');
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
    activityId: 'ama', // Uses the AMA activity which has web_fetch tool
  });

  // Initial greeting
  useEffect(() => {
    if (!hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      setMessages([{
        id: 'greeting',
        role: 'assistant',
        content: agentMode === 'real'
          ? "Hi! I'm your AI Assistant with web access. I can fetch and analyze information from the web for you. What would you like to research today?"
          : "Hi! I'm your AI Assistant. Switch to real mode (VITE_AGENT_MODE=real) to enable web fetching capabilities. How can I help you?",
        timestamp: Date.now(),
      }]);
    }
  }, [agentMode, messages.length, setMessages]);

  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Focus input when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    // Focus immediately and keep focus
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
    await sendMessage(text);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="mb-6 p-6 rounded-2xl bg-linear-to-r from-neutral-900/80 to-neutral-800/50 backdrop-blur-xl border border-neutral-800/50 shadow-2xl relative overflow-hidden shrink-0">
        {/* Animated gradient orb */}
        <motion.div
          className="absolute -top-10 -right-10 w-32 h-32 bg-orange-500/20 rounded-full blur-2xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.3, 0.2],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-linear-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/30">
              <Sparkles className="w-6 h-6 text-orange-400" />
            </div>
            <div>
              <h2 className="text-2xl text-white">AI Assistant</h2>
              <p className="text-neutral-400">
                {agentMode === 'real' ? 'Web-enabled AI with research capabilities' : 'Powered by advanced AI technology'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agentMode === 'real' && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                <Globe className="w-3 h-3" />
                Web Access
              </div>
            )}
            <span className={`px-2 py-1 rounded-full text-xs ${
              agentMode === 'real'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {agentMode === 'real' ? 'Real AI' : 'Mock'}
            </span>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div ref={messagesContainerRef} className="flex flex-col h-[400px] overflow-y-auto mb-6 rounded-2xl bg-linear-to-br from-neutral-900/40 to-neutral-800/20 backdrop-blur-sm border border-neutral-800/50 p-6 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl p-4 ${
                  message.role === 'user'
                    ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
                    : 'bg-linear-to-br from-neutral-800/80 to-neutral-700/60 backdrop-blur-xl border border-neutral-700/50 text-neutral-200'
                }`}
              >
                {/* Role indicator */}
                <div className="flex items-center gap-2 mb-2">
                  {message.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-linear-to-br from-orange-500/30 to-orange-600/20 flex items-center justify-center">
                      <Sparkles className="w-3 h-3 text-orange-400" />
                    </div>
                  )}
                  <span className={`text-xs ${message.role === 'user' ? 'text-orange-100' : 'text-neutral-400'}`}>
                    {message.role === 'user' ? 'You' : 'AI Assistant'}
                  </span>
                </div>

                {/* Thinking indicator */}
                {message.thinking && (
                  <details className="mb-2">
                    <summary className="text-xs text-neutral-500 cursor-pointer">Thinking process...</summary>
                    <p className="text-xs text-neutral-500 mt-1 italic whitespace-pre-wrap">{message.thinking}</p>
                  </details>
                )}

                {/* Message content */}
                <div className="whitespace-pre-wrap leading-relaxed">
                  {parseMarkdown(message.content)}
                </div>

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

        {/* Loading indicator - only show while waiting for first content */}
        {isStreaming && (() => {
          const lastMsg = messages[messages.length - 1];
          const showIndicator = lastMsg?.role === 'assistant' && !lastMsg.content;
          return showIndicator ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="bg-linear-to-br from-neutral-800/80 to-neutral-700/60 backdrop-blur-xl border border-neutral-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-linear-to-br from-orange-500/30 to-orange-600/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-orange-400" />
                  </div>
                  <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
                  <span className="text-neutral-400">{currentStatus || 'Thinking...'}</span>
                </div>
              </div>
            </motion.div>
          ) : null;
        })()}
      </div>

      {/* Input Area */}
      <div className="relative">
        {/* Glow effect */}
        <motion.div
          className="absolute -inset-1 bg-linear-to-r from-orange-500/20 to-orange-600/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100"
          animate={{
            opacity: [0, 0.3, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <div className="relative flex gap-3 p-4 rounded-2xl bg-linear-to-br from-neutral-900/80 to-neutral-800/60 backdrop-blur-xl border border-neutral-800/50 shadow-2xl group">
          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={agentMode === 'real' ? "Ask me to research anything..." : "Ask me anything..."}
            className="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none resize-none min-h-12 max-h-[200px]"
            rows={1}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <motion.button
              onClick={stopGeneration}
              className="px-6 py-3 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Square className="w-5 h-5" />
            </motion.button>
          ) : (
            <motion.button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-6 py-3 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 relative overflow-hidden"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {/* Button shine effect */}
              <motion.div
                className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent"
                animate={{
                  x: ['-100%', '200%'],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  repeatDelay: 1,
                  ease: "easeInOut"
                }}
              />

              <Send className="w-5 h-5 relative z-10" />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
