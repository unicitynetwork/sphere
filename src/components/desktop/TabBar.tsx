import { X, LayoutGrid, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDesktopState } from '../../hooks/useDesktopState';
import { getAgentConfig } from '../../config/activities';

interface TabBarProps {
  walletOpen?: boolean;
  onToggleWallet?: () => void;
}

export function TabBar({ walletOpen, onToggleWallet }: TabBarProps) {
  const { openTabs, activeTabId, activateTab, closeTab, showDesktop } = useDesktopState();

  return (
    <div className="flex items-center gap-0.5 sm:gap-1 px-1 sm:px-3 py-1 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-800/50 shrink-0 overflow-x-auto scrollbar-hide">
      {/* Show Desktop button */}
      <button
        onClick={showDesktop}
        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-150 shrink-0 ${
          activeTabId === null
            ? 'bg-orange-500/15 text-orange-500'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
        }`}
        title="Show Desktop"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>

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
            onClick={() => activateTab(tab.id)}
            className={`relative flex items-center gap-1 px-1.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 shrink-0 ${
              isActive
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
            }`}
          >
            {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
            <span className="max-w-24 truncate hidden sm:inline">{tab.label}</span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
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

      {/* Wallet toggle — pushed to the right */}
      {onToggleWallet && (
        <>
          <div className="ml-auto" />
          <button
            onClick={onToggleWallet}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-150 shrink-0 ${
              walletOpen
                ? 'bg-orange-500/15 text-orange-500'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
            }`}
            title={walletOpen ? 'Hide Wallet' : 'Show Wallet'}
          >
            <Wallet className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
