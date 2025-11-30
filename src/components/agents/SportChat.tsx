import { useState } from 'react';
import { Trophy, X, Wallet, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { mockMatches, type Match } from '../../data/agentsMockData';
import { AgentChat, type SidebarItem } from './shared';

// Bet item for sidebar
interface BetItem extends SidebarItem {
  status: 'pending' | 'won' | 'lost';
}

// Match card data
interface MatchCardData {
  match: Match;
}

interface SportChatProps {
  agent: AgentConfig;
}

export function SportChat({ agent }: SportChatProps) {
  const [bets, setBets] = useState<BetItem[]>(() => {
    const stored = localStorage.getItem('sphere_sport_bets');
    return stored ? JSON.parse(stored) : [];
  });

  // Custom bet modal state
  const [showBetModal, setShowBetModal] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<Match | null>(null);
  const [betChoice, setBetChoice] = useState<{ choice: string; odds: number } | null>(null);
  const [betAmount, setBetAmount] = useState('10');
  const [betStep, setBetStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

  const getMockResponse = async (
    userInput: string,
    addMessage: (content: string, cardData?: MatchCardData, showActionButton?: boolean) => void
  ) => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (userInput.includes('match') || userInput.includes('football') || userInput.includes('bet') || userInput.includes('game')) {
      const match = mockMatches[Math.floor(Math.random() * mockMatches.length)];
      addMessage(
        `Great choice! Here's an upcoming match:\n\n${match.team1Flag} **${match.team1}** vs **${match.team2}** ${match.team2Flag}\n\n**Date:** ${match.date} at ${match.time}\n\n**Odds:**\n- ${match.team1} wins: ${match.odds1}\n- Draw: ${match.oddsDraw}\n- ${match.team2} wins: ${match.odds2}\n\nWould you like to place a bet on this match?`,
        { match },
        true
      );
    } else if (userInput.includes('hello') || userInput.includes('hi')) {
      addMessage("Hey there! Ready to place some bets? Tell me what sport or match you're interested in!");
    } else {
      const match = mockMatches[0];
      addMessage(
        `I found a great match for you!\n\n${match.team1Flag} **${match.team1}** vs **${match.team2}** ${match.team2Flag}\n\n**Date:** ${match.date} at ${match.time}\n\n**Odds:**\n- ${match.team1} wins: ${match.odds1}\n- Draw: ${match.oddsDraw}\n- ${match.team2} wins: ${match.odds2}\n\nClick the button below to place your bet!`,
        { match },
        true
      );
    }
  };

  const handlePlaceBet = (cardData: MatchCardData) => {
    setPendingMatch(cardData.match);
    setBetChoice({ choice: cardData.match.team1, odds: cardData.match.odds1 });
    setBetAmount('10');
    setBetStep('confirm');
    setShowBetModal(true);
  };

  const handleConfirmBet = async () => {
    if (!pendingMatch || !betChoice) return;

    setBetStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const newBet: BetItem = {
      id: uuidv4(),
      title: `${pendingMatch.team1} vs ${pendingMatch.team2}`,
      image: pendingMatch.image,
      timestamp: Date.now(),
      status: 'pending',
      amount: parseFloat(betAmount),
    };
    setBets(prev => [newBet, ...prev]);

    setBetStep('success');
    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowBetModal(false);
    setPendingMatch(null);
    setBetChoice(null);
  };

  const selectBetChoice = (choice: string, odds: number) => {
    setBetChoice({ choice, odds });
  };

  return (
    <AgentChat<MatchCardData, BetItem>
      agent={agent}
      sidebarConfig={{
        title: 'My Bets',
        emptyText: 'No bets yet',
        emptyIcon: <Trophy className="w-8 h-8 mx-auto opacity-50" />,
        items: bets,
        setItems: setBets,
        storageKey: 'sphere_sport_bets',
        renderItem: (bet) => (
          <>
            <img src={bet.image} alt="" className="w-12 h-12 rounded-lg object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{bet.title}</p>
              <p className="text-emerald-400 text-xs">{bet.amount} USDT</p>
              <p className="text-neutral-500 text-xs">{new Date(bet.timestamp).toLocaleDateString()}</p>
            </div>
          </>
        ),
      }}
      getMockResponse={getMockResponse}
      renderMessageCard={(cardData) => (
        <div className="mt-4 rounded-xl overflow-hidden border border-neutral-600/50">
          <img src={cardData.match.image} alt="Match" className="w-full h-32 object-cover" />
          <div className="p-3 bg-neutral-900/80">
            <div className="flex items-center justify-between text-lg font-medium">
              <span>{cardData.match.team1Flag} {cardData.match.team1}</span>
              <span className="text-neutral-500">vs</span>
              <span>{cardData.match.team2} {cardData.match.team2Flag}</span>
            </div>
            <p className="text-center text-neutral-400 text-sm mt-1">
              {cardData.match.date} - {cardData.match.time}
            </p>
          </div>
        </div>
      )}
      actionConfig={{
        label: 'Place Bet',
        onAction: handlePlaceBet,
      }}
      detailsConfig={{
        title: 'Bet Details',
        renderContent: (bet) => (
          <div className="rounded-xl overflow-hidden border border-neutral-700">
            <img src={bet.image} alt="" className="w-full h-40 object-cover" />
            <div className="p-4 bg-neutral-800">
              <p className="text-white font-medium text-lg">{bet.title}</p>
              <div className="flex items-center justify-between mt-4">
                <p className="text-emerald-400 text-xl font-bold">{bet.amount} USDT</p>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  bet.status === 'won' ? 'bg-green-500/20 text-green-400' :
                  bet.status === 'lost' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {bet.status.charAt(0).toUpperCase() + bet.status.slice(1)}
                </span>
              </div>
              <p className="text-neutral-500 text-sm mt-3">
                {new Date(bet.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        ),
      }}
      bgGradient={{ from: 'bg-emerald-500/5', to: 'bg-teal-500/5' }}
      additionalContent={
        <AnimatePresence>
          {showBetModal && pendingMatch && betChoice && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={() => betStep === 'confirm' && setShowBetModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                {betStep === 'confirm' && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-white">Confirm Bet</h3>
                      <button onClick={() => setShowBetModal(false)} className="text-neutral-400 hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Match Info */}
                    <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
                      <img src={pendingMatch.image} alt="" className="w-full h-24 object-cover" />
                      <div className="p-3 bg-neutral-800">
                        <div className="flex items-center justify-between font-medium">
                          <span>{pendingMatch.team1Flag} {pendingMatch.team1}</span>
                          <span className="text-neutral-500">vs</span>
                          <span>{pendingMatch.team2} {pendingMatch.team2Flag}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bet Choice */}
                    <div className="mb-4">
                      <label className="text-neutral-400 text-sm mb-2 block">Select your bet:</label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => selectBetChoice(pendingMatch.team1, pendingMatch.odds1)}
                          className={`p-3 rounded-lg border text-center transition-all ${
                            betChoice.choice === pendingMatch.team1
                              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                          }`}
                        >
                          <div className="text-sm">{pendingMatch.team1}</div>
                          <div className="text-lg font-bold">{pendingMatch.odds1}</div>
                        </button>
                        <button
                          onClick={() => selectBetChoice('Draw', pendingMatch.oddsDraw)}
                          className={`p-3 rounded-lg border text-center transition-all ${
                            betChoice.choice === 'Draw'
                              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                          }`}
                        >
                          <div className="text-sm">Draw</div>
                          <div className="text-lg font-bold">{pendingMatch.oddsDraw}</div>
                        </button>
                        <button
                          onClick={() => selectBetChoice(pendingMatch.team2, pendingMatch.odds2)}
                          className={`p-3 rounded-lg border text-center transition-all ${
                            betChoice.choice === pendingMatch.team2
                              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                              : 'border-neutral-700 text-neutral-300 hover:border-neutral-600'
                          }`}
                        >
                          <div className="text-sm">{pendingMatch.team2}</div>
                          <div className="text-lg font-bold">{pendingMatch.odds2}</div>
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
                          {(parseFloat(betAmount) * betChoice.odds).toFixed(2)} USDT
                        </span>
                      </div>
                    </div>

                    {/* Confirm Button */}
                    <motion.button
                      onClick={handleConfirmBet}
                      className="w-full py-4 rounded-xl bg-linear-to-r from-emerald-500 to-teal-500 text-white font-bold flex items-center justify-center gap-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Wallet className="w-5 h-5" />
                      Confirm & Pay
                    </motion.button>
                  </>
                )}

                {betStep === 'processing' && (
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

                {betStep === 'success' && (
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
      }
    />
  );
}
