import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Plus, Trophy, X, Wallet, CheckCircle, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { parseMarkdown } from '../../utils/markdown';

// Bet item for sidebar
interface BetItem {
  id: string;
  title: string;
  image: string;
  timestamp: number;
  status: 'pending' | 'won' | 'lost';
  amount: number;
}

// Match data
interface Match {
  id: string;
  team1: string;
  team2: string;
  team1Flag: string;
  team2Flag: string;
  date: string;
  time: string;
  odds1: number;
  oddsDraw: number;
  odds2: number;
  image: string;
}

// Message types
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  match?: Match;
  showBetButton?: boolean;
}

// Mock matches data
const mockMatches: Match[] = [
  {
    id: '1',
    team1: 'Finland',
    team2: 'Estonia',
    team1Flag: '🇫🇮',
    team2Flag: '🇪🇪',
    date: '28.12.25',
    time: '19:00',
    odds1: 1.85,
    oddsDraw: 3.40,
    odds2: 4.20,
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&h=200&fit=crop',
  },
  {
    id: '2',
    team1: 'Germany',
    team2: 'France',
    team1Flag: '🇩🇪',
    team2Flag: '🇫🇷',
    date: '29.12.25',
    time: '21:00',
    odds1: 2.10,
    oddsDraw: 3.20,
    odds2: 2.90,
    image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=400&h=200&fit=crop',
  },
];

interface SportChatProps {
  agent: AgentConfig;
}

export function SportChat({ agent }: SportChatProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bets, setBets] = useState<BetItem[]>(() => {
    const stored = localStorage.getItem('sphere_sport_bets');
    return stored ? JSON.parse(stored) : [];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [pendingBet, setPendingBet] = useState<{ match: Match; choice: string; odds: number } | null>(null);
  const [transactionStep, setTransactionStep] = useState<'confirm' | 'processing' | 'success'>('confirm');
  const [betAmount, setBetAmount] = useState('10');
  const [showBetDetails, setShowBetDetails] = useState(false);
  const [selectedBet, setSelectedBet] = useState<BetItem | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);

  // Save bets to localStorage
  useEffect(() => {
    localStorage.setItem('sphere_sport_bets', JSON.stringify(bets));
  }, [bets]);

  // Add greeting on mount
  useEffect(() => {
    if (!hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      addAssistantMessage("Welcome to Sports Betting! 🏆\n\nI can help you place bets on football matches. Just tell me what you're interested in - for example:\n\n• \"Show me football matches\"\n• \"I want to bet on a match\"\n• \"What games are available?\"");
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

  const addAssistantMessage = (content: string, match?: Match, showBetButton?: boolean) => {
    const msg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      match,
      showBetButton,
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

    // Simulate AI response delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock AI responses based on user input
    if (userText.includes('матч') || userText.includes('match') || userText.includes('football') || userText.includes('bet') || userText.includes('ставк') || userText.includes('игр') || userText.includes('game')) {
      const match = mockMatches[Math.floor(Math.random() * mockMatches.length)];
      addAssistantMessage(
        `Great choice! Here's an upcoming match:\n\n${match.team1Flag} **${match.team1}** vs **${match.team2}** ${match.team2Flag}\n\n📅 ${match.date} at ${match.time}\n\n**Odds:**\n• ${match.team1} wins: ${match.odds1}\n• Draw: ${match.oddsDraw}\n• ${match.team2} wins: ${match.odds2}\n\nWould you like to place a bet on this match?`,
        match,
        true
      );
    } else if (userText.includes('hello') || userText.includes('hi') || userText.includes('привет')) {
      addAssistantMessage("Hey there! 👋 Ready to place some bets? Tell me what sport or match you're interested in!");
    } else {
      // Default response - show a match
      const match = mockMatches[0];
      addAssistantMessage(
        `I found a great match for you!\n\n${match.team1Flag} **${match.team1}** vs **${match.team2}** ${match.team2Flag}\n\n📅 ${match.date} at ${match.time}\n\n**Odds:**\n• ${match.team1} wins: ${match.odds1}\n• Draw: ${match.oddsDraw}\n• ${match.team2} wins: ${match.odds2}\n\nClick the button below to place your bet!`,
        match,
        true
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

  const handlePlaceBet = (match: Match) => {
    setPendingBet({ match, choice: match.team1, odds: match.odds1 });
    setTransactionStep('confirm');
    setShowTransactionModal(true);
  };

  const handleConfirmTransaction = async () => {
    setTransactionStep('processing');

    // Simulate transaction processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    setTransactionStep('success');

    // Add bet to sidebar
    if (pendingBet) {
      const newBet: BetItem = {
        id: uuidv4(),
        title: `${pendingBet.match.team1} vs ${pendingBet.match.team2}`,
        image: pendingBet.match.image,
        timestamp: Date.now(),
        status: 'pending',
        amount: parseFloat(betAmount),
      };
      setBets(prev => [newBet, ...prev]);
    }

    // Wait a bit then close modal and show success message
    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowTransactionModal(false);

    if (pendingBet) {
      addAssistantMessage(
        `✅ **Bet placed successfully!**\n\nYour bet of **${betAmount} USDT** on **${pendingBet.choice}** (odds: ${pendingBet.odds}) has been confirmed.\n\n🎯 Good luck! We'll notify you when the match ends.\n\n_Want to place another bet? Click "New Chat" in the sidebar or just tell me what match you're interested in!_`
      );
    }

    setPendingBet(null);
    setBetAmount('10');
  };

  const handleNewChat = () => {
    setMessages([]);
    hasGreeted.current = false;
  };

  const selectBetChoice = (choice: string, odds: number) => {
    if (pendingBet) {
      setPendingBet({ ...pendingBet, choice, odds });
    }
  };

  const handleBetClick = (bet: BetItem) => {
    setSelectedBet(bet);
    setShowBetDetails(true);
  };

  return (
    <>
      <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex relative shadow-2xl h-full">
        {/* Background */}
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-teal-500/5 rounded-full blur-3xl" />

        {/* Left Sidebar - Bets History */}
        <div className="w-72 border-r border-neutral-800/50 flex flex-col relative z-10">
          <div className="p-4 border-b border-neutral-800/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-medium">My Bets</h3>
              <motion.button
                onClick={handleNewChat}
                className="p-2 rounded-lg bg-linear-to-br from-emerald-500 to-teal-500 text-white"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="New bet"
              >
                <Plus className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {bets.length === 0 ? (
              <div className="text-center text-neutral-500 py-8">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No bets yet</p>
              </div>
            ) : (
              bets.map((bet) => (
                <motion.div
                  key={bet.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => handleBetClick(bet)}
                  className="p-3 rounded-xl bg-neutral-800/50 border border-neutral-700/30 hover:bg-neutral-700/50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <img src={bet.image} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{bet.title}</p>
                      <p className="text-emerald-400 text-xs">{bet.amount} USDT</p>
                      <p className="text-neutral-500 text-xs">
                        {new Date(bet.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <Eye className="w-4 h-4 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col relative z-10">
          {/* Header */}
          <div className="p-4 border-b border-neutral-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-linear-to-br from-emerald-500 to-teal-500">
                <Trophy className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg text-white font-medium">{agent.name}</h2>
                <p className="text-sm text-neutral-400">{agent.description}</p>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                        ? 'bg-linear-to-br from-emerald-500 to-teal-500 text-white shadow-lg'
                        : 'bg-neutral-800/80 backdrop-blur-xl border border-neutral-700/50 text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {message.role === 'assistant' && (
                        <div className="w-5 h-5 rounded-full bg-linear-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                          <Sparkles className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                      <span className={`text-xs ${message.role === 'user' ? 'text-white/80' : 'text-neutral-400'}`}>
                        {message.role === 'user' ? 'You' : 'Sport Agent'}
                      </span>
                    </div>

                    <div className="leading-relaxed">{parseMarkdown(message.content)}</div>

                    {/* Match Card */}
                    {message.match && (
                      <div className="mt-4 rounded-xl overflow-hidden border border-neutral-600/50">
                        <img
                          src={message.match.image}
                          alt="Match"
                          className="w-full h-32 object-cover"
                        />
                        <div className="p-3 bg-neutral-900/80">
                          <div className="flex items-center justify-between text-lg font-medium">
                            <span>{message.match.team1Flag} {message.match.team1}</span>
                            <span className="text-neutral-500">vs</span>
                            <span>{message.match.team2} {message.match.team2Flag}</span>
                          </div>
                          <p className="text-center text-neutral-400 text-sm mt-1">
                            {message.match.date} • {message.match.time}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Bet Button */}
                    {message.showBetButton && message.match && (
                      <motion.button
                        onClick={() => handlePlaceBet(message.match!)}
                        className="mt-4 w-full py-3 rounded-xl bg-linear-to-r from-emerald-500 to-teal-500 text-white font-medium shadow-lg"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        🎯 Place Bet
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-neutral-800/50">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask about matches or place a bet..."
                className="flex-1 bg-neutral-800/50 text-white placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-700/50"
                rows={1}
                disabled={isTyping}
              />
              <motion.button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="px-5 py-2 rounded-xl bg-linear-to-r from-emerald-500 to-teal-500 text-white disabled:opacity-50"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Send className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showTransactionModal && pendingBet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => transactionStep === 'confirm' && setShowTransactionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {transactionStep === 'confirm' && (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-white">Confirm Bet</h3>
                    <button onClick={() => setShowTransactionModal(false)} className="text-neutral-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Match Info */}
                  <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
                    <img src={pendingBet.match.image} alt="" className="w-full h-24 object-cover" />
                    <div className="p-3 bg-neutral-800">
                      <div className="flex items-center justify-between font-medium">
                        <span>{pendingBet.match.team1Flag} {pendingBet.match.team1}</span>
                        <span className="text-neutral-500">vs</span>
                        <span>{pendingBet.match.team2} {pendingBet.match.team2Flag}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bet Choice */}
                  <div className="mb-4">
                    <label className="text-neutral-400 text-sm mb-2 block">Select your bet:</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => selectBetChoice(pendingBet.match.team1, pendingBet.match.odds1)}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          pendingBet.choice === pendingBet.match.team1
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                        }`}
                      >
                        <div className="text-sm">{pendingBet.match.team1}</div>
                        <div className="text-lg font-bold">{pendingBet.match.odds1}</div>
                      </button>
                      <button
                        onClick={() => selectBetChoice('Draw', pendingBet.match.oddsDraw)}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          pendingBet.choice === 'Draw'
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                        }`}
                      >
                        <div className="text-sm">Draw</div>
                        <div className="text-lg font-bold">{pendingBet.match.oddsDraw}</div>
                      </button>
                      <button
                        onClick={() => selectBetChoice(pendingBet.match.team2, pendingBet.match.odds2)}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          pendingBet.choice === pendingBet.match.team2
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                        }`}
                      >
                        <div className="text-sm">{pendingBet.match.team2}</div>
                        <div className="text-lg font-bold">{pendingBet.match.odds2}</div>
                      </button>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="mb-6">
                    <label className="text-neutral-400 text-sm mb-2 block">Bet amount (USDT):</label>
                    <div className="flex gap-2">
                      {['5', '10', '25', '50', '100'].map((amount) => (
                        <button
                          key={amount}
                          onClick={() => setBetAmount(amount)}
                          className={`flex-1 py-2 rounded-lg border transition-all ${
                            betAmount === amount
                              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                          }`}
                        >
                          {amount}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Potential Win */}
                  <div className="bg-neutral-800 rounded-xl p-4 mb-6">
                    <div className="flex justify-between text-neutral-400 mb-2">
                      <span>Your bet:</span>
                      <span className="text-white">{betAmount} USDT</span>
                    </div>
                    <div className="flex justify-between text-neutral-400">
                      <span>Potential win:</span>
                      <span className="text-emerald-400 font-bold">
                        {(parseFloat(betAmount) * pendingBet.odds).toFixed(2)} USDT
                      </span>
                    </div>
                  </div>

                  {/* Confirm Button */}
                  <motion.button
                    onClick={handleConfirmTransaction}
                    className="w-full py-4 rounded-xl bg-linear-to-r from-emerald-500 to-teal-500 text-white font-bold flex items-center justify-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Wallet className="w-5 h-5" />
                    Confirm & Pay
                  </motion.button>
                </>
              )}

              {transactionStep === 'processing' && (
                <div className="py-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <Wallet className="w-8 h-8 text-emerald-500" />
                    </motion.div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Processing Transaction</h3>
                  <p className="text-neutral-400">Please wait while we confirm your bet...</p>
                </div>
              )}

              {transactionStep === 'success' && (
                <div className="py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500 flex items-center justify-center"
                  >
                    <CheckCircle className="w-8 h-8 text-white" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-white mb-2">Bet Placed!</h3>
                  <p className="text-neutral-400">Good luck with your bet!</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bet Details Modal */}
      <AnimatePresence>
        {showBetDetails && selectedBet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowBetDetails(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">Bet Details</h3>
                <button onClick={() => setShowBetDetails(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
                <img src={selectedBet.image} alt="" className="w-full h-40 object-cover" />
                <div className="p-4 bg-neutral-800">
                  <p className="text-white font-medium text-lg">{selectedBet.title}</p>
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-emerald-400 text-xl font-bold">{selectedBet.amount} USDT</p>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      selectedBet.status === 'won' ? 'bg-green-500/20 text-green-400' :
                      selectedBet.status === 'lost' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {selectedBet.status.charAt(0).toUpperCase() + selectedBet.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-neutral-500 text-sm mt-3">
                    {new Date(selectedBet.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>

              <motion.button
                onClick={() => setShowBetDetails(false)}
                className="w-full py-3 rounded-xl bg-neutral-800 text-white font-medium border border-neutral-700"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Close
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
