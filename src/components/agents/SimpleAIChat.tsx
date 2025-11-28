import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Gamepad2, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { parseMarkdown } from '../../utils/markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  games?: GameInfo[];
}

interface GameInfo {
  id: string;
  name: string;
  description: string;
  image: string;
  url: string;
}

const mockGames: GameInfo[] = [
  {
    id: '1',
    name: 'Quake',
    description: 'Classic arena shooter - fast-paced multiplayer action!',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=200&fit=crop',
    url: 'https://quake.com',
  },
  {
    id: '2',
    name: 'Crypto Poker',
    description: 'Play poker with crypto stakes against real players',
    image: 'https://images.unsplash.com/photo-1511193311914-0346f16efe90?w=400&h=200&fit=crop',
    url: '#',
  },
];

interface SimpleAIChatProps {
  agent: AgentConfig;
}

export function SimpleAIChat({ agent }: SimpleAIChatProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);

  useEffect(() => {
    if (!hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      addAssistantMessage("Hey! 🎮 Looking for some games?\n\nI can help you find something fun to play. We have:\n• **Quake** - Classic arena shooter\n• **Crypto Poker** - Play with crypto stakes\n\nJust ask me about any game or say \"show games\"!");
    }
  }, []);

  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const addAssistantMessage = (content: string, games?: GameInfo[]) => {
    const msg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      games,
    };
    setMessages(prev => [...prev, msg]);
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userText = input.toLowerCase();
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    await new Promise(resolve => setTimeout(resolve, 800));

    if (userText.includes('quake')) {
      addAssistantMessage(
        "🎯 **Quake** - The legendary arena shooter!\n\nFast-paced multiplayer combat with rocket launchers, railguns, and lightning guns. Test your reflexes against players worldwide!\n\nClick the link below to start playing:",
        [mockGames[0]]
      );
    } else if (userText.includes('poker')) {
      addAssistantMessage(
        "🃏 **Crypto Poker** - High stakes, real crypto!\n\nPlay Texas Hold'em with cryptocurrency. Win big or just have fun - it's up to you!\n\nClick below to join a table:",
        [mockGames[1]]
      );
    } else if (userText.includes('game') || userText.includes('play') || userText.includes('show')) {
      addAssistantMessage(
        "Here are the games available right now:\n\nPick one to get started! 🎮",
        mockGames
      );
    } else {
      addAssistantMessage(
        "I can help you find games! Try asking:\n\n• \"Show me games\"\n• \"Tell me about Quake\"\n• \"I want to play poker\"\n\nWhat sounds fun? 🎮"
      );
    }

    setIsTyping(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex flex-col relative shadow-2xl h-full">
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-pink-500/5 rounded-full blur-3xl" />

      {/* Header */}
      <div className="p-4 border-b border-neutral-800/50 relative z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
            <Gamepad2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg text-white font-medium">{agent.name}</h2>
            <p className="text-sm text-neutral-400">{agent.description}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
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

                <div className="leading-relaxed">{parseMarkdown(message.content)}</div>

                {/* Game Cards */}
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
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-neutral-800/50 relative z-10">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about games..."
            className="flex-1 bg-neutral-800/50 text-white placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-700/50"
            rows={1}
            disabled={isTyping}
          />
          <motion.button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className={`px-5 py-2 rounded-xl bg-linear-to-r ${agent.color} text-white disabled:opacity-50`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
