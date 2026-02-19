import { X, LayoutGrid, Wallet, Maximize2, Minimize2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useDesktopState } from '../../hooks/useDesktopState';
import { getAgentConfig } from '../../config/activities';
import { useDmUnreadCount } from '../chat/hooks/useDmUnreadCount';
import { useGroupUnreadCount } from '../chat/hooks/useGroupUnreadCount';

interface TabBarProps {
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function TabBar({ isFullscreen, onToggleFullscreen }: TabBarProps) {
  const navigate = useNavigate();
  const { openTabs, activeTabId, activateTab, closeTab, showDesktop, walletOpen, toggleWallet } = useDesktopState();
  const dmUnreadCount = useDmUnreadCount();
  const groupUnreadCount = useGroupUnreadCount();

  const handleActivateTab = (tab: { id: string; appId: string; url?: string }) => {
    activateTab(tab.id);
    if (tab.url) {
      navigate(`/agents/custom?url=${encodeURIComponent(tab.url)}`);
    } else {
      navigate(`/agents/${tab.appId}`);
    }
  };

  const handleShowDesktop = () => {
    showDesktop();
    navigate('/home');
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const idx = openTabs.findIndex((t) => t.id === tabId);
    const isActive = tabId === activeTabId;
    closeTab(tabId);

    if (isActive) {
      const remaining = openTabs.filter((t) => t.id !== tabId);
      const neighbor = remaining[Math.min(idx, remaining.length - 1)];
      if (neighbor) {
        if (neighbor.url) {
          navigate(`/agents/custom?url=${encodeURIComponent(neighbor.url)}`);
        } else {
          navigate(`/agents/${neighbor.appId}`);
        }
      } else {
        navigate('/home');
      }
    }
  };

  return (
    <div data-tutorial="tab-bar" className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800/50 shrink-0 overflow-x-auto scrollbar-hide">
      {/* Show Desktop button */}
      <motion.button
        data-tutorial="show-desktop"
        onClick={handleShowDesktop}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2 px-4 py-2 rounded-full shrink-0 bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm font-medium shadow-md shadow-orange-500/20"
        title="Show Desktop"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Apps</span>
      </motion.button>

      {openTabs.length > 0 && (
        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
      )}

      {/* Open tabs */}
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const agent = getAgentConfig(tab.appId);
        const TabIcon = agent?.Icon;

        return (
          <motion.button
            key={tab.id}
            layout
            onClick={() => handleActivateTab(tab)}
            className={`relative flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs font-medium rounded-lg transition-colors duration-150 shrink-0 ${
              isActive
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
            }`}
          >
            {TabIcon && <TabIcon className="w-4 h-4" />}
            <span className="max-w-24 truncate hidden sm:inline">{tab.label}</span>
            {tab.appId === 'dm' && dmUnreadCount > 0 && (
              <span className={`min-w-4 h-4 px-0.5 flex items-center justify-center text-[9px] font-bold rounded-full ${
                isActive ? 'bg-white/30 text-white' : 'bg-orange-500 text-white'
              }`}>
                {dmUnreadCount > 99 ? '99+' : dmUnreadCount}
              </span>
            )}
            {tab.appId === 'group-chat' && groupUnreadCount > 0 && (
              <span className={`min-w-4 h-4 px-0.5 flex items-center justify-center text-[9px] font-bold rounded-full ${
                isActive ? 'bg-white/30 text-white' : 'bg-orange-500 text-white'
              }`}>
                {groupUnreadCount > 99 ? '99+' : groupUnreadCount}
              </span>
            )}
            <span
              role="button"
              onClick={(e) => handleCloseTab(e, tab.id)}
              className={`p-0.5 rounded transition-colors duration-150 ${
                isActive
                  ? 'hover:bg-orange-600/40'
                  : 'hover:bg-neutral-300/60 dark:hover:bg-neutral-600/40'
              }`}
              title={`Close ${tab.label}`}
            >
              <X className="w-3 h-3" />
            </span>
          </motion.button>
        );
      })}

      {/* Right side controls — pushed to the right */}
      <div className="ml-auto flex items-center gap-1">
        {/* Fullscreen toggle */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-150 shrink-0 ${
              isFullscreen
                ? 'bg-orange-500/15 text-orange-500'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
            }`}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}

        {/* Wallet toggle */}
        <button
          data-tutorial="wallet-toggle"
          onClick={toggleWallet}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-150 shrink-0 ${
            walletOpen
              ? 'bg-orange-500/15 text-orange-500'
              : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
          }`}
          title={walletOpen ? 'Hide Wallet' : 'Show Wallet'}
        >
          <Wallet className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
