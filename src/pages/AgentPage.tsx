import { useEffect, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { MessageSquare, Wallet } from 'lucide-react';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatSection } from '../components/chat/ChatSection';
import { SportChat } from '../components/agents/SportChat';
import { P2PChat } from '../components/agents/P2PChat';
import { MerchChat } from '../components/agents/MerchChat';
import { TriviaChat } from '../components/agents/TriviaChat';
import { GamesChat } from '../components/agents/GamesChat';
import { AIChat } from '../components/agents/AIChat';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { agents, getAgentConfig } from '../config/activities';
import { useVisualViewport } from '../hooks/useVisualViewport';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'wallet'>('chat');

  // Track visual viewport for mobile keyboard handling
  useVisualViewport();

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

  // Scroll to chat on mobile when agent changes
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile && chatContainerRef.current) {
      chatContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [agentId]);

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
      default:
        return <ChatSection />;
    }
  };

  return (
    <>
      {/* Desktop agent grid - always visible */}
      <div className="hidden lg:block mb-8 relative">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="relative">
          <div className="relative p-8 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/50">
            <div className="grid grid-cols-7 gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  id={agent.id}
                  name={agent.name}
                  Icon={agent.Icon}
                  category={agent.category}
                  color={agent.color}
                  isSelected={agentId === agent.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Mobile tab switcher with sliding indicator */}
      <div className="lg:hidden relative flex p-1 mb-3 bg-neutral-800/50 rounded-2xl backdrop-blur-sm border border-neutral-700/30">
        {/* Sliding background indicator - CSS transition for smoothness */}
        <div
          className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-linear-to-r from-orange-500 to-orange-600 rounded-xl shadow-lg shadow-orange-500/20 transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(${activePanel === 'chat' ? '0' : 'calc(100% + 8px)'})`,
          }}
        />

        {/* Chat tab */}
        <button
          onClick={() => scrollToPanel('chat')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors duration-200 ${
            activePanel === 'chat' ? 'text-white' : 'text-neutral-400'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat</span>
        </button>

        {/* Wallet tab */}
        <button
          onClick={() => scrollToPanel('wallet')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors duration-200 ${
            activePanel === 'wallet' ? 'text-white' : 'text-neutral-400'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
      </div>

      {/* Mobile swipeable container - fullscreen, fixed height with overlays-content */}
      <div
        ref={sliderRef}
        onScroll={handleScroll}
        className="lg:hidden flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{
          height: 'calc(100dvh - 180px)',
          minHeight: '300px'
        }}
      >
        <div ref={chatContainerRef} className="w-full shrink-0 snap-center h-full">
          {renderChatComponent()}
        </div>
        <div className="w-full shrink-0 snap-center h-full">
          <WalletPanel />
        </div>
      </div>

      {/* Desktop grid layout */}
      <div className="hidden lg:grid lg:grid-cols-3 lg:gap-8 lg:h-[650px]">
        <div className="lg:col-span-2 h-full min-h-0">
          {renderChatComponent()}
        </div>
        <div className="h-full min-h-0 overflow-hidden">
          <WalletPanel />
        </div>
      </div>
    </>
  );
}
