import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDesktopState } from '../../hooks/useDesktopState';
import { useUIState } from '../../hooks/useUIState';
import { getAgentConfig, type AgentConfig } from '../../config/activities';
import { TabBar } from './TabBar';
import { DesktopShortcuts } from './DesktopShortcuts';
import { ChatSection } from '../chat/ChatSection';
import { DMChatSection } from '../chat/dm/DMChatSection';
import { GroupChatSection } from '../chat/group/GroupChatSection';
import { MerchChat } from '../agents/MerchChat';
import { TriviaChat } from '../agents/TriviaChat';
import { GamesChat } from '../agents/GamesChat';
import { IframeAgent } from '../agents/IframeAgent';
import { WalletPanel } from '../wallet/WalletPanel';
import { WalletRequiredBlocker } from '../agents/WalletRequiredBlocker';
import { ActivityTicker } from '../activity';

const CUSTOM_URL_PRESETS = [
  { label: 'Sphere Connect Example', url: 'https://unicitynetwork.github.io/sphere-sdk-connect-example/' },
];

export function DesktopLayout() {
  const { openTabs, activeTabId, openTab } = useDesktopState();
  const { isFullscreen, toggleFullscreen, setFullscreen } = useUIState();
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [walletOpen, setWalletOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  // Auto-open wallet panel when payment request arrives
  useEffect(() => {
    const handlePaymentRequest = () => {
      setWalletOpen(true);
    };
    window.addEventListener('payment-requests-updated', handlePaymentRequest);
    return () => window.removeEventListener('payment-requests-updated', handlePaymentRequest);
  }, []);

  // Escape key exits fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, setFullscreen]);

  const toggleWallet = () => setWalletOpen((prev) => !prev);

  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = customUrlInput.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = url.includes('localhost') || url.match(/^\d/) ? `http://${url}` : `https://${url}`;
    }
    openTab('custom', { url, label: new URL(url).hostname });
    setCustomUrlInput('');
  };

  const openCustomUrl = (url: string) => {
    const label = new URL(url).hostname;
    openTab('custom', { url, label });
  };

  const renderTabContent = (tabId: string, appId: string, url?: string) => {
    const agent = getAgentConfig(appId);

    // Custom URL iframe tab
    if (url) {
      const customAgent: AgentConfig = {
        id: tabId,
        name: url,
        description: '',
        Icon: Globe,
        category: 'Custom',
        color: 'from-indigo-500 to-violet-600',
        type: 'iframe',
        iframeUrl: url,
      };
      return <IframeAgent agent={customAgent} />;
    }

    if (!agent) return null;

    switch (appId) {
      case 'dm':
        return (
          <WalletRequiredBlocker agentId={appId} onOpenWallet={() => setWalletOpen(true)}>
            <DMChatSection />
          </WalletRequiredBlocker>
        );
      case 'group-chat':
        return (
          <WalletRequiredBlocker agentId={appId} onOpenWallet={() => setWalletOpen(true)}>
            <GroupChatSection />
          </WalletRequiredBlocker>
        );
      case 'trivia':
        return <TriviaChat agent={agent} />;
      case 'games':
        return <GamesChat agent={agent} />;
      case 'merch':
        return <MerchChat agent={agent} />;
      case 'custom':
        return renderCustomUrlPrompt();
      default:
        if (agent.type === 'iframe') {
          return <IframeAgent agent={agent} />;
        }
        return <ChatSection />;
    }
  };

  const renderCustomUrlPrompt = () => (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 p-8 max-w-md w-full">
        <Globe className="w-12 h-12 text-neutral-400" />
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Load Custom URL</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
          Quick open or enter any URL
        </p>
        <div className="flex items-center gap-2">
          {CUSTOM_URL_PRESETS.map((preset) => (
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
  );

  return (
    <div className={`flex flex-col overflow-hidden bg-white dark:bg-neutral-900 ${
      isFullscreen ? 'fixed inset-0 z-99999' : 'h-full'
    }`}>
      {/* Activity ticker - hidden in fullscreen */}
      {!isFullscreen && (
        <div className="shrink-0">
          <ActivityTicker />
        </div>
      )}

      {/* Tab bar with wallet toggle */}
      <TabBar
        walletOpen={walletOpen}
        onToggleWallet={toggleWallet}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* Content area with optional wallet panel */}
      <div className="flex-1 min-h-0 flex relative">
        {/* Main content */}
        <div className="flex-1 min-w-0 relative bg-white dark:bg-neutral-900">
          {activeTabId === null && <DesktopShortcuts />}
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={tab.id === activeTabId ? 'h-full' : 'hidden'}
            >
              {renderTabContent(tab.id, tab.appId, tab.url)}
            </div>
          ))}
        </div>

        {/* Wallet panel — desktop: inline side panel with slide transition */}
        <div
          data-tutorial="wallet-panel"
          className={`hidden lg:block shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
            walletOpen ? 'w-80 xl:w-96' : 'w-0'
          }`}
        >
          <div className="w-80 xl:w-96 h-full">
            <WalletPanel />
          </div>
        </div>

        {/* Wallet panel — mobile: overlay sliding from right */}
        <AnimatePresence>
          {walletOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="lg:hidden absolute inset-0 bg-black/50 z-40"
                onClick={toggleWallet}
              />
              <motion.div
                data-tutorial="wallet-panel-mobile"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="lg:hidden absolute inset-0 z-50"
              >
                <WalletPanel />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
