import { Menu, PanelLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AgentConfig } from '../../../config/activities';

interface ChatHeaderProps {
  agent: AgentConfig;
  rightContent?: React.ReactNode;
  onToggleSidebar?: () => void;
  onExpandSidebar?: () => void;
  showMenuButton?: boolean;
  sidebarCollapsed?: boolean;
}

export function ChatHeader({ agent, rightContent, onToggleSidebar, onExpandSidebar, showMenuButton, sidebarCollapsed }: ChatHeaderProps) {
  return (
    <div className="p-4 border-b border-neutral-800/50 relative z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Desktop expand sidebar button (when collapsed) */}
          {showMenuButton && sidebarCollapsed && onExpandSidebar && (
            <motion.button
              onClick={onExpandSidebar}
              className="hidden lg:block p-2 rounded-xl bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50 transition-colors border border-neutral-700/50"
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
              className="lg:hidden p-2 rounded-xl bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50 transition-colors border border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Menu className="w-5 h-5" />
            </motion.button>
          )}
          <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
            <agent.Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg text-white font-medium">{agent.name}</h2>
            <p className="text-sm text-neutral-400 hidden sm:block">{agent.description}</p>
          </div>
        </div>
        {rightContent}
      </div>
    </div>
  );
}
