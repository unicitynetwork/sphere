import { useState, useRef, useEffect } from 'react';
import { Menu, PanelLeft, ChevronDown } from 'lucide-react';
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
}

export function ChatHeader({
  agent,
  rightContent,
  onToggleSidebar,
  onExpandSidebar,
  showMenuButton,
  sidebarCollapsed,
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

          {/* Mobile: Agent picker dropdown */}
          <div ref={pickerRef} className="relative lg:hidden">
            <button
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              className="flex items-center gap-2 active:scale-95 transition-transform"
            >
              <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
                <agent.Icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg text-neutral-900 dark:text-white font-medium">{agent.name}</span>
              <ChevronDown className={`w-4 h-4 text-neutral-500 dark:text-neutral-400 transition-transform ${showAgentPicker ? 'rotate-180' : ''}`} />
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
                      <div className={`p-2 rounded-lg bg-linear-to-br ${a.color}`}>
                        <a.Icon className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-neutral-900 dark:text-white text-sm">{a.name}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop: Static agent info */}
          <div className="hidden lg:flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
              <agent.Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg text-neutral-900 dark:text-white font-medium">{agent.name}</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{agent.description}</p>
            </div>
          </div>
        </div>

        {/* Right side: custom content */}
        {rightContent && (
          <div className="flex items-center gap-2">
            {rightContent}
          </div>
        )}
      </div>
    </div>
  );
}
