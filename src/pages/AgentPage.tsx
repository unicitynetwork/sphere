import { useEffect, useRef, useState } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { MessageSquare, Wallet, ChevronDown, ChevronUp, X, Globe, Plus, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentCard } from '../components/agents/AgentCard';
import { ActivityTicker } from '../components/activity';
import { ChatSection } from '../components/chat/ChatSection';
import { MerchChat } from '../components/agents/MerchChat';
import { TriviaChat } from '../components/agents/TriviaChat';
import { GamesChat } from '../components/agents/GamesChat';
import { IframeAgent } from '../components/agents/IframeAgent';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { WalletRequiredBlocker } from '../components/agents/WalletRequiredBlocker';
import { agents, getAgentConfig, type AgentConfig } from '../config/activities';
import { useUIState } from '../hooks/useUIState';

const DEFAULT_VISIBLE_AGENTS = 7;
const CUSTOM_URL_PRESETS = [
  { label: 'Sphere Connect Example', url: 'https://unicitynetwork.github.io/sphere-sdk-connect-example/' },
];

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const sliderRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'wallet'>('chat');
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [visitedIframeIds, setVisitedIframeIds] = useState<string[]>([]);
  const [customTabs, setCustomTabs] = useState<Array<{ id: string; url: string; name: string }>>([]);
  const [activeCustomTabId, setActiveCustomTabId] = useState<string | null>(null);
  const [showCustomUrlPrompt, setShowCustomUrlPrompt] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const { isFullscreen, setFullscreen } = useUIState();

  const hasMoreAgents = agents.length > DEFAULT_VISIBLE_AGENTS;
  const visibleAgents = showAllAgents ? agents : agents.slice(0, DEFAULT_VISIBLE_AGENTS);

  const currentAgent = agentId ? getAgentConfig(agentId) : undefined;

  // Iframe agents with a URL get tracked for persistent background rendering
  // Iframe agents without a URL (custom, astrid, unibot) show the URL prompt
  const isUrlPromptAgent = currentAgent?.type === 'iframe' && !currentAgent.iframeUrl;
  const iframeFullscreen = isFullscreen && currentAgent?.type === 'iframe';

  // Escape key exits iframe fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, setFullscreen]);

  useEffect(() => {
    if (currentAgent?.type === 'iframe' && currentAgent.iframeUrl) {
      setVisitedIframeIds(prev =>
        prev.includes(currentAgent.id) ? prev : [...prev, currentAgent.id]
      );
    }
  }, [currentAgent]);

  // When navigating to a URL-prompt iframe agent, show prompt or last active tab
  useEffect(() => {
    if (isUrlPromptAgent) {
      if (customTabs.length === 0) {
        setShowCustomUrlPrompt(true);
      } else if (!activeCustomTabId || !customTabs.find(t => t.id === activeCustomTabId)) {
        setActiveCustomTabId(customTabs[customTabs.length - 1].id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

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

  // Create a synthetic AgentConfig for custom tabs
  const makeCustomAgentConfig = (tab: { id: string; url: string; name: string }): AgentConfig => ({
    id: tab.id,
    name: tab.name,
    description: tab.url,
    Icon: Globe,
    category: 'Custom',
    color: 'from-neutral-500 to-neutral-600',
    type: 'iframe',
    iframeUrl: tab.url,
  });

  // Open a URL as a new custom tab
  const openCustomUrl = (rawUrl: string) => {
    let url = rawUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    try {
      const parsed = new URL(url);
      const name = parsed.host;
      const id = `custom-${Date.now()}`;
      setCustomTabs(prev => [...prev, { id, url, name }]);
      setActiveCustomTabId(id);
      setShowCustomUrlPrompt(false);
      setCustomUrlInput('');
      if (!isUrlPromptAgent) {
        navigate('/agents/custom');
      }
    } catch {
      // Invalid URL
    }
  };

  // Add a custom tab from URL input
  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openCustomUrl(customUrlInput);
  };

  // Remove a custom tab
  const removeCustomTab = (id: string) => {
    const remaining = customTabs.filter(t => t.id !== id);
    setCustomTabs(remaining);
    if (activeCustomTabId === id) {
      if (remaining.length > 0) {
        setActiveCustomTabId(remaining[remaining.length - 1].id);
      } else {
        setActiveCustomTabId(null);
        if (isUrlPromptAgent) {
          setShowCustomUrlPrompt(true);
        }
      }
    }
  };

  // Remove an iframe agent from the active list (unload it)
  const removeIframeAgent = (id: string) => {
    const remaining = visitedIframeIds.filter(v => v !== id);
    setVisitedIframeIds(remaining);
    if (id === agentId) {
      navigate(`/agents/${remaining.length > 0 ? remaining[0] : 'chat'}`);
    }
  };

  // Render tab bar + all visited iframe agents persistently (hidden when not active)
  const renderIframeAgents = () => {
    const isIframeActive = currentAgent.type === 'iframe';
    const hasAnyTabs = visitedIframeIds.length > 0 || customTabs.length > 0;

    if (!isIframeActive && !hasAnyTabs) return null;

    return (
      <div className={`${isIframeActive ? 'h-full' : 'hidden'} flex flex-col ${iframeFullscreen ? 'bg-white dark:bg-neutral-900' : 'bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 lg:shadow-xl dark:lg:shadow-2xl'} overflow-hidden relative theme-transition`}>
        {/* Active iframe agents tab bar */}
        <div className="flex items-center gap-1 px-3 py-2 bg-neutral-50/80 dark:bg-neutral-800/40 border-b border-neutral-200 dark:border-neutral-800/50 shrink-0">
          {/* Static iframe agent tabs */}
          {visitedIframeIds.map(id => {
            const iframeAgent = getAgentConfig(id);
            if (!iframeAgent) return null;
            const AgentIcon = iframeAgent.Icon;
            const isActive = id === agentId;
            return (
              <button
                key={id}
                onClick={() => navigate(`/agents/${id}`)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
                  isActive
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
                }`}
              >
                <AgentIcon className="w-3.5 h-3.5" />
                {iframeAgent.name}
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); removeIframeAgent(id); }}
                  className={`ml-0.5 p-0.5 rounded transition-colors duration-150 ${
                    isActive
                      ? 'hover:bg-orange-600/40'
                      : 'hover:bg-neutral-300/60 dark:hover:bg-neutral-600/40'
                  }`}
                  title={`Close ${iframeAgent.name}`}
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            );
          })}
          {/* Custom tabs */}
          {customTabs.map(tab => {
            const isActive = isUrlPromptAgent && activeCustomTabId === tab.id && !showCustomUrlPrompt;
            return (
              <button
                key={tab.id}
                onClick={() => { if (!isUrlPromptAgent) navigate('/agents/custom'); setActiveCustomTabId(tab.id); setShowCustomUrlPrompt(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
                  isActive
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                {tab.name}
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); removeCustomTab(tab.id); }}
                  className={`ml-0.5 p-0.5 rounded transition-colors duration-150 ${
                    isActive
                      ? 'hover:bg-orange-600/40'
                      : 'hover:bg-neutral-300/60 dark:hover:bg-neutral-600/40'
                  }`}
                  title={`Close ${tab.name}`}
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            );
          })}
          {/* Add custom URL button */}
          <button
            onClick={() => { if (!isUrlPromptAgent) navigate('/agents/custom'); setShowCustomUrlPrompt(true); setCustomUrlInput(''); }}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40 transition-colors duration-150"
            title="Add custom URL"
          >
            <Plus className="w-4 h-4" />
          </button>
          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(!isFullscreen)}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40 transition-colors duration-150 ml-auto"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Static iframe containers */}
        {visitedIframeIds.map(id => {
          const iframeAgent = getAgentConfig(id);
          if (!iframeAgent) return null;
          return (
            <div key={id} className={id === agentId ? 'flex-1 min-h-0' : 'hidden'}>
              <IframeAgent agent={iframeAgent} />
            </div>
          );
        })}

        {/* Custom tab iframes */}
        {customTabs.map(tab => {
          const isActive = isUrlPromptAgent && activeCustomTabId === tab.id && !showCustomUrlPrompt;
          return (
            <div key={tab.id} className={isActive ? 'flex-1 min-h-0' : 'hidden'}>
              <IframeAgent agent={makeCustomAgentConfig(tab)} />
            </div>
          );
        })}

        {/* URL prompt for URL-prompt iframe agents */}
        {isUrlPromptAgent && showCustomUrlPrompt && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 p-8 max-w-md w-full">
              <Globe className="w-12 h-12 text-neutral-400" />
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Load Custom URL</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
                Quick open or enter any URL
              </p>
              <div className="flex items-center gap-2">
                {CUSTOM_URL_PRESETS.map(preset => (
                  <button
                    key={preset.url}
                    onClick={() => openCustomUrl(preset.url)}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-orange-500 hover:text-white transition-colors border border-neutral-200 dark:border-neutral-700"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                <span className="text-xs text-neutral-400">or</span>
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              </div>
              <form onSubmit={handleCustomUrlSubmit} className="w-full flex gap-2">
                <input
                  type="text"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://example.com or localhost:5174"
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-medium rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-colors shadow-sm"
                >
                  Open
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChatComponent = () => {
    // Iframe agents are rendered persistently via renderIframeAgents
    if (currentAgent.type === 'iframe') return null;

    switch (currentAgent.id) {
      case 'chat':
        return <ChatSection />;
      case 'trivia':
        return <TriviaChat agent={currentAgent} />;
      case 'games':
        return <GamesChat agent={currentAgent} />;
      case 'merch':
        return <MerchChat agent={currentAgent} />;
      default:
        return <ChatSection />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Desktop agent grid - hidden in iframe fullscreen */}
      <div data-tutorial="agents" className={`${iframeFullscreen ? 'hidden' : 'hidden lg:block'} mb-8 relative px-8 pt-8 pb-5 rounded-2xl dark:bg-linear-to-br dark:from-neutral-900/40 dark:to-neutral-800/20 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800/50`}>
        <div className="absolute top-0 left-0 w-32 h-32 border-l-2 border-t-2 border-orange-500/50 rounded-tl-2xl" />
        <div className="absolute bottom-0 right-0 w-32 h-32 border-r-2 border-b-2 border-orange-500/50 rounded-br-2xl" />

        <div className="relative">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.min(agents.length, DEFAULT_VISIBLE_AGENTS)}, 1fr)` }}
          >
            {/* Fixed agent cards */}
            {visibleAgents.slice(0, DEFAULT_VISIBLE_AGENTS).map((agent) => (
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
            {/* Extra agents - expand/collapse animation */}
            <AnimatePresence initial={false} mode="sync">
              {showAllAgents && visibleAgents.slice(DEFAULT_VISIBLE_AGENTS).map((agent, index) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.15, delay: index * 0.02 }}
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
      <div className={`${iframeFullscreen ? 'hidden' : 'hidden lg:block'} mb-6`}>
        <ActivityTicker />
      </div>

      {/* Mobile tab switcher - hidden in iframe fullscreen */}
      <div data-tutorial="mobile-tabs" className={`${iframeFullscreen ? 'hidden' : 'lg:hidden'} shrink-0 relative flex p-1 mb-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-2xl backdrop-blur-sm border border-neutral-200 dark:border-neutral-700/30 overflow-hidden`}>
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
          data-tutorial="mobile-wallet-tab"
          onClick={() => scrollToPanel('wallet')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-colors duration-200 ${
            activePanel === 'wallet' ? 'text-white' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
      </div>

      {/* Mobile swipeable container - hidden in iframe fullscreen */}
      <div
        ref={sliderRef}
        onScroll={handleScroll}
        className={`${iframeFullscreen ? 'hidden' : 'lg:hidden'} flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide py-1`}
      >
        <div data-tutorial="mobile-chat" className="w-full shrink-0 snap-center h-full">
          <WalletRequiredBlocker agentId={agentId!} onOpenWallet={() => scrollToPanel('wallet')}>
            {renderIframeAgents()}
            {renderChatComponent()}
          </WalletRequiredBlocker>
        </div>
        <div data-tutorial="mobile-wallet" className="w-full shrink-0 snap-center h-full">
          <WalletPanel />
        </div>
      </div>

      {/* Desktop grid layout - full width in iframe fullscreen */}
      <div className={`hidden lg:grid ${iframeFullscreen ? 'lg:grid-cols-1' : 'lg:grid-cols-3 lg:gap-8'} lg:flex-1 lg:min-h-162.5 ${iframeFullscreen ? '' : 'lg:py-2'}`}>
        <div data-tutorial="chat" className={`${iframeFullscreen ? '' : 'lg:col-span-2'} h-full min-h-0`}>
          <WalletRequiredBlocker agentId={agentId!}>
            {renderIframeAgents()}
            {renderChatComponent()}
          </WalletRequiredBlocker>
        </div>
        {!iframeFullscreen && (
          <div data-tutorial="wallet" className="h-full min-h-0">
            <WalletPanel />
          </div>
        )}
      </div>
    </div>
  );
}
