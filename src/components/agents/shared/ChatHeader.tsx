import { Menu, PanelLeft, Maximize2, Minimize2 } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AgentConfig } from '../../../config/activities';

interface ChatHeaderProps {
  agent: AgentConfig;
  rightContent?: React.ReactNode;
  onToggleSidebar?: () => void;
  onExpandSidebar?: () => void;
  showMenuButton?: boolean;
  sidebarCollapsed?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function ChatHeader({
  agent,
  rightContent,
  onToggleSidebar,
  onExpandSidebar,
  showMenuButton,
  sidebarCollapsed,
  isFullscreen,
  onToggleFullscreen,
}: ChatHeaderProps) {
  return (
    <div className="p-4 border-b border-neutral-200 dark:border-neutral-800/50 relative z-20 theme-transition">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Desktop expand sidebar button (when collapsed) */}
          {showMenuButton && sidebarCollapsed && onExpandSidebar && (
            <motion.button
              onClick={onExpandSidebar}
              className="hidden lg:block p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Expand sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </motion.button>
          )}
          {/* Mobile menu button */}
          {showMenuButton && onToggleSidebar && (
            <motion.button
              onClick={onToggleSidebar}
              className="lg:hidden p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Menu className="w-5 h-5" />
            </motion.button>
          )}

          {/* Mobile & Fullscreen: Static agent info */}
          <div className={`flex items-center gap-2 ${isFullscreen ? '' : 'lg:hidden'}`}>
            <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
              <agent.Icon className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <div className="text-lg text-neutral-900 dark:text-white font-medium">{agent.name}</div>
              <div className="text-sm text-neutral-500 dark:text-neutral-400">{agent.description}</div>
            </div>
          </div>

          {/* Desktop: Static agent info (hidden in fullscreen) */}
          <div className={`${isFullscreen ? 'hidden' : 'hidden lg:flex'} items-center gap-3`}>
            <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
              <agent.Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg text-neutral-900 dark:text-white font-medium">{agent.name}</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{agent.description}</p>
            </div>
          </div>
        </div>

        {/* Right side: fullscreen toggle + custom content */}
        <div className="flex items-center gap-2">
          {rightContent}
          {onToggleFullscreen && (
            <motion.button
              onClick={onToggleFullscreen}
              className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
