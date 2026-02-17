import { LayoutGrid, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDesktopState } from '../../hooks/useDesktopState';
import { getAgentConfig } from '../../config/activities';

interface TaskbarProps {
  walletOpen: boolean;
  onToggleWallet: () => void;
}

export function Taskbar({ walletOpen, onToggleWallet }: TaskbarProps) {
  const { openTabs, activeTabId, activateTab, showDesktop } = useDesktopState();

  return (
    <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border-t border-neutral-200 dark:border-neutral-800/50 shrink-0">
      {/* Desktop button */}
      <button
        onClick={showDesktop}
        className={`p-2 rounded-lg transition-colors duration-150 ${
          activeTabId === null
            ? 'bg-orange-500/15 text-orange-500'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
        }`}
        title="Show Desktop"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>

      {openTabs.length > 0 && (
        <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />
      )}

      {/* Open app buttons */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1">
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const agent = getAgentConfig(tab.appId);
          const TabIcon = agent?.Icon;

          return (
            <motion.button
              key={tab.id}
              layout
              onClick={() => activateTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors duration-150 shrink-0 ${
                isActive
                  ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                  : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
              }`}
              title={tab.label}
            >
              {TabIcon && <TabIcon className="w-4 h-4" />}
              <span className="text-xs font-medium max-w-20 truncate hidden sm:inline">
                {tab.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="taskbar-indicator"
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-orange-500 rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Wallet toggle button */}
      <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />
      <button
        onClick={onToggleWallet}
        className={`p-2 rounded-lg transition-colors duration-150 ${
          walletOpen
            ? 'bg-orange-500/15 text-orange-500'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
        }`}
        title={walletOpen ? 'Hide Wallet' : 'Show Wallet'}
      >
        <Wallet className="w-4 h-4" />
      </button>
    </div>
  );
}
