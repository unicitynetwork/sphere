import { useState, useRef, useEffect } from 'react';
import { Menu, PanelLeft, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { agents, type AgentConfig } from '../../../config/activities';

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
  const navigate = useNavigate();
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowAgentPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAgentSelect = (agentId: string) => {
    navigate(`/agents/${agentId}`);
    setShowAgentPicker(false);
  };

  return (
    <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800/50 relative z-20 theme-transition">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Desktop expand sidebar button (when collapsed) */}
          {showMenuButton && sidebarCollapsed && onExpandSidebar && (
            <motion.button
              onClick={onExpandSidebar}
              className="hidden lg:block p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Expand sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </motion.button>
          )}
          {/* Mobile menu button */}
          {showMenuButton && onToggleSidebar && (
            <motion.button
              onClick={onToggleSidebar}
              className="lg:hidden p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Menu className="w-4 h-4" />
            </motion.button>
          )}

          {/* Mobile & Fullscreen: Agent picker dropdown */}
          <div ref={pickerRef} className={`relative ${isFullscreen ? '' : 'lg:hidden'}`}>
            <button
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              className="flex items-center gap-2 active:scale-95 transition-transform"
            >
              <div className={`p-1.5 rounded-lg bg-linear-to-br ${agent.color}`}>
                <agent.Icon className="w-4 h-4 text-white" />
              </div>
              <div className="text-left">
                <div className="text-sm text-neutral-900 dark:text-white font-medium">{agent.name}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">{agent.description}</div>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400 transition-transform ${showAgentPicker ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showAgentPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700/50 rounded-xl shadow-xl overflow-hidden"
                >
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleAgentSelect(a.id)}
                      className={`w-full flex items-center gap-3 p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors ${
                        a.id === agent.id ? 'bg-neutral-100 dark:bg-neutral-800/80' : ''
                      }`}
                    >
                      <div className={`p-2 rounded-lg bg-linear-to-br ${a.color} shrink-0`}>
                        <a.Icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="text-neutral-900 dark:text-white text-sm font-medium">{a.name}</div>
                        <div className="text-neutral-500 dark:text-neutral-400 text-xs truncate">{a.description}</div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop: Static agent info (hidden in fullscreen) */}
          <div className={`${isFullscreen ? 'hidden' : 'hidden lg:flex'} items-center gap-2`}>
            <div className={`p-1.5 rounded-lg bg-linear-to-br ${agent.color}`}>
              <agent.Icon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm text-neutral-900 dark:text-white font-medium">{agent.name}</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{agent.description}</p>
            </div>
          </div>
        </div>

        {/* Right side: fullscreen toggle + custom content */}
        <div className="flex items-center gap-1.5">
          {rightContent}
          {onToggleFullscreen && (
            <motion.button
              onClick={onToggleFullscreen}
              className="p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
