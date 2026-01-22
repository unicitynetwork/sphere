import { useEffect, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { MessageSquare, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentCard } from '../components/agents/AgentCard';
import { ActivityTicker } from '../components/activity';
import { ChatSection } from '../components/chat/ChatSection';
import { SportChat } from '../components/agents/SportChat';
import { P2PChat } from '../components/agents/P2PChat';
import { MerchChat } from '../components/agents/MerchChat';
import { TriviaChat } from '../components/agents/TriviaChat';
import { GamesChat } from '../components/agents/GamesChat';
import { AIChat } from '../components/agents/AIChat';
import { SellAnythingChat } from '../components/agents/SellAnythingChat';
import { PokemonChat } from '../components/agents/PokemonChat';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { agents, getAgentConfig } from '../config/activities';

const DEFAULT_VISIBLE_AGENTS = 7;

type AnimationPhase = 'idle' | 'exiting' | 'entering';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const sliderRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'wallet'>('chat');
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [recentAgentIds, setRecentAgentIds] = useState<string[]>([]);
  const [animatingAgentId, setAnimatingAgentId] = useState<string | null>(null);
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>('idle');
  const prevAgentIdRef = useRef<string | undefined>(undefined);
  const recentAgentIdsRef = useRef<string[]>([]);

  // Keep ref in sync with state
  recentAgentIdsRef.current = recentAgentIds;

  const hasMoreAgents = agents.length > DEFAULT_VISIBLE_AGENTS;

  // Track recently selected agents with animation
  useEffect(() => {
    if (!agentId) return;

    // Check if this is a new agent selection (not just a re-render)
    const isNewSelection = prevAgentIdRef.current !== agentId;
    prevAgentIdRef.current = agentId;

    const currentRecentIds = recentAgentIdsRef.current;

    // If already first, no animation needed
    if (currentRecentIds[0] === agentId) return;

    if (isNewSelection && currentRecentIds.includes(agentId)) {
      // Agent exists in visible list - animate the reorder
      setAnimatingAgentId(agentId);
      setAnimationPhase('exiting');

      // Phase 1: Exit animation (card disappears)
      setTimeout(() => {
        // Phase 2: Update order (others slide)
        setRecentAgentIds(prev => {
          const filtered = prev.filter(id => id !== agentId);
          return [agentId, ...filtered].slice(0, DEFAULT_VISIBLE_AGENTS);
        });
        setAnimationPhase('entering');

        // Phase 3: Enter animation (card appears at new position)
        setTimeout(() => {
          setAnimationPhase('idle');
          setAnimatingAgentId(null);
        }, 450);
      }, 350);
    } else {
      // New agent not in list - just add to front without fancy animation
      setRecentAgentIds(prev => {
        const filtered = prev.filter(id => id !== agentId);
        return [agentId, ...filtered].slice(0, DEFAULT_VISIBLE_AGENTS);
      });
    }
  }, [agentId]);

  // Calculate visible agents - prioritize recently selected agents
  const visibleAgents = (() => {
    if (showAllAgents) return agents;

    // Get recent agents that exist in the agents list
    const recentAgents = recentAgentIds
      .map(id => agents.find(a => a.id === id))
      .filter((a): a is typeof agents[0] => a !== undefined);

    // Get remaining agents (not in recent list)
    const remainingAgents = agents.filter(a => !recentAgentIds.includes(a.id));

    // Combine: recent first, then fill with remaining up to DEFAULT_VISIBLE_AGENTS
    const combined = [...recentAgents, ...remainingAgents];
    return combined.slice(0, DEFAULT_VISIBLE_AGENTS);
  })();

  const currentAgent = agentId ? getAgentConfig(agentId) : undefined;

  // Handle scroll end to detect active panel (debounced)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = () => {
    if (!sliderRef.current || window.innerWidth >= 1024) return;

    // Debounce scroll end detection
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      if (!sliderRef.current) return;
      const scrollLeft = sliderRef.current.scrollLeft;
      const width = sliderRef.current.offsetWidth;
      setActivePanel(scrollLeft > width / 2 ? 'wallet' : 'chat');
    }, 50);
  };

  // Scroll to panel on tab click
  const scrollToPanel = (panel: 'chat' | 'wallet') => {
    if (!sliderRef.current) return;
    const width = sliderRef.current.offsetWidth;
    sliderRef.current.scrollTo({
      left: panel === 'wallet' ? width : 0,
      behavior: 'smooth'
    });
    setActivePanel(panel);
  };

  // Reset to chat panel on mobile when agent changes
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile && sliderRef.current) {
      // Instant scroll to chat panel (no animation)
      sliderRef.current.scrollTo({ left: 0, behavior: 'instant' });
      setActivePanel('chat');
    }
  }, [agentId]);

  // Auto-switch to wallet panel when payment request is received (mobile only)
  useEffect(() => {
    const handlePaymentRequest = () => {
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        console.log("💰 Payment request received, switching to wallet panel...");
        scrollToPanel('wallet');
      }
    };

    window.addEventListener('payment-requests-updated', handlePaymentRequest);

    return () => {
      window.removeEventListener('payment-requests-updated', handlePaymentRequest);
    };
  }, []);

  // Redirect to chat if invalid agent
  if (!currentAgent) {
    return <Navigate to="/agents/chat" replace />;
  }

  const renderChatComponent = () => {
    switch (currentAgent.id) {
      case 'chat':
        return <ChatSection />;
      case 'ai':
        return <AIChat agent={currentAgent} />;
      case 'trivia':
        return <TriviaChat agent={currentAgent} />;
      case 'games':
        return <GamesChat agent={currentAgent} />;
      case 'sport':
        return <SportChat agent={currentAgent} />;
      case 'p2p':
        return <P2PChat agent={currentAgent} />;
      case 'merch':
        return <MerchChat agent={currentAgent} />;
      case 'sell-anything':
        return <SellAnythingChat agent={currentAgent} />;
      case 'pokemon':
        return <PokemonChat agent={currentAgent} />;
      default:
        return <ChatSection />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Desktop agent grid - always visible */}
      <div className="hidden lg:block mb-8 relative px-8 pt-8 pb-5 rounded-2xl dark:bg-linear-to-br dark:from-neutral-900/40 dark:to-neutral-800/20 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800/50">
        <div className="absolute top-0 left-0 w-32 h-32 border-l-2 border-t-2 border-orange-500/50 rounded-tl-2xl" />
        <div className="absolute bottom-0 right-0 w-32 h-32 border-r-2 border-b-2 border-orange-500/50 rounded-br-2xl" />

        <div className="relative">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.min(visibleAgents.length, DEFAULT_VISIBLE_AGENTS)}, 1fr)` }}
          >
            {/* First N agents - with layout animation for reordering */}
            {visibleAgents.slice(0, DEFAULT_VISIBLE_AGENTS).map((agent, index) => {
              const isAnimatingAgent = animatingAgentId === agent.id;
              const isFirstPosition = index === 0;
              const isExiting = isAnimatingAgent && animationPhase === 'exiting' && !isFirstPosition;
              const isEntering = isAnimatingAgent && animationPhase === 'entering' && isFirstPosition;

              return (
                <motion.div
                  key={agent.id}
                  layout
                  initial={false}
                  animate={{
                    opacity: isExiting ? 0 : 1,
                    scale: isExiting ? 0.75 : 1,
                    y: isExiting ? -15 : 0,
                  }}
                  transition={{
                    layout: {
                      type: "spring",
                      stiffness: 250,
                      damping: 30,
                    },
                    opacity: {
                      duration: 0.35,
                      ease: "easeOut",
                    },
                    scale: {
                      duration: 0.35,
                      ease: "easeOut",
                    },
                    y: {
                      duration: 0.35,
                      ease: "easeOut",
                    },
                  }}
                >
                  {/* Inner wrapper for enter animation */}
                  <motion.div
                    initial={isEntering ? { opacity: 0, scale: 0.8, y: 15 } : false}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{
                      duration: 0.4,
                      ease: [0.34, 1.56, 0.64, 1], // Custom spring-like ease
                    }}
                  >
                    <AgentCard
                      id={agent.id}
                      name={agent.name}
                      Icon={agent.Icon}
                      category={agent.category}
                      color={agent.color}
                      isSelected={agentId === agent.id}
                    />
                  </motion.div>
                </motion.div>
              );
            })}
            {/* Extra agents - with animation */}
            <AnimatePresence initial={false} mode="sync">
              {showAllAgents && visibleAgents.slice(DEFAULT_VISIBLE_AGENTS).map((agent, index) => (
                <motion.div
                  key={agent.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                  transition={{
                    layout: {
                      type: "spring",
                      stiffness: 400,
                      damping: 35,
                    },
                    duration: 0.15,
                    delay: index * 0.02,
                  }}
                >
                  <AgentCard
                    id={agent.id}
                    name={agent.name}
                    Icon={agent.Icon}
                    category={agent.category}
                    color={agent.color}
                    isSelected={agentId === agent.id}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* View all / Hide all button */}
          {hasMoreAgents && (
            <div className="flex justify-center mt-2">
              <button
                onClick={() => setShowAllAgents(!showAllAgents)}
                className="flex items-center gap-1.5 px-4 pt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors duration-200"
              >
                {showAllAgents ? (
                  <>
                    <span>Hide all</span>
                    <ChevronUp className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>View all</span>
                    <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Activity Ticker - desktop only */}
      <div className="hidden lg:block mb-6">
        <ActivityTicker agentId={agentId} />
      </div>

      {/* Mobile tab switcher with sliding indicator */}
      <div className="lg:hidden shrink-0 relative flex p-1 mb-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-2xl backdrop-blur-sm border border-neutral-200 dark:border-neutral-700/30 overflow-hidden">
        {/* Sliding background indicator */}
        <motion.div
          className="absolute top-1 bottom-1 left-1 bg-linear-to-r from-orange-500 to-orange-600 rounded-xl shadow-lg shadow-orange-500/20"
          initial={false}
          animate={{
            x: activePanel === 'chat' ? '0%' : '100%',
            width: 'calc(50% - 0.25rem)',
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />

        {/* Chat tab */}
        <button
          onClick={() => scrollToPanel('chat')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors duration-200 ${
            activePanel === 'chat' ? 'text-white' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Agents</span>
        </button>

        {/* Wallet tab */}
        <button
          onClick={() => scrollToPanel('wallet')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors duration-200 ${
            activePanel === 'wallet' ? 'text-white' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
      </div>

      {/* Mobile swipeable container - takes remaining height */}
      <div
        ref={sliderRef}
        onScroll={handleScroll}
        className="lg:hidden flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide py-1"
      >
        <div className="w-full shrink-0 snap-center h-full">
          {renderChatComponent()}
        </div>
        <div className="w-full shrink-0 snap-center h-full">
          <WalletPanel />
        </div>
      </div>

      {/* Desktop grid layout */}
      <div className="hidden lg:grid lg:grid-cols-3 lg:gap-8 lg:flex-1 lg:min-h-[650px] lg:py-2">
        <div className="lg:col-span-2 h-full min-h-0">
          {renderChatComponent()}
        </div>
        <div className="h-full min-h-0">
          <WalletPanel />
        </div>
      </div>
    </div>
  );
}
