// src/components/chat/components/ChatMainArea.tsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Hash, ChevronDown, Menu, PanelLeft } from 'lucide-react';
import type { ChatState } from '../../../hooks/useChatState';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { agents } from '../../../config/activities';

type MainAreaProps = Pick<ChatState, 'chatMode' | 'selectedUser' | 'messages' | 'onlineCount' | 'message' | 'setMessage' | 'handleSend'> & {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
};

export function ChatMainArea(props: MainAreaProps) {
  const { chatMode, selectedUser, messages, onlineCount, onToggleSidebar, sidebarCollapsed, onExpandSidebar } = props;
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

  const chatAgent = agents.find(a => a.id === 'chat')!

  const totalOnlineCount = onlineCount + 124;

  return (
    <div className="grid grid-rows-[auto_1fr_auto] z-10 min-w-0 h-full min-h-0">
      {/* Chat Header */}
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-800/50 flex items-center justify-between bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative z-20 theme-transition">
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-500/5 rounded-tr-full" />

        <div className="flex items-center gap-3 relative z-10">
          {/* Desktop expand sidebar button (when collapsed) */}
          {sidebarCollapsed && (
            <motion.button
              onClick={onExpandSidebar}
              className="hidden lg:flex p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="Expand sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </motion.button>
          )}
          {/* Mobile menu button */}
          <motion.button
            onClick={onToggleSidebar}
            className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Menu className="w-5 h-5" />
          </motion.button>

          {/* Mobile: Agent picker dropdown */}
          <div ref={pickerRef} className="relative lg:hidden">
            <button
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              className="flex items-center gap-2 active:scale-95 transition-transform"
            >
              <div className={`p-2.5 rounded-xl bg-linear-to-br ${chatAgent.color}`}>
                <chatAgent.Icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg text-neutral-900 dark:text-white font-medium">{chatAgent.name}</span>
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
                        a.id === 'chat' ? 'bg-neutral-100 dark:bg-neutral-800/80' : ''
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

          {/* Desktop: Header Content (Global vs DM) */}
          <div className="hidden lg:flex items-center gap-3">
            {chatMode === 'global' ? (
              <>
                <motion.div whileHover={{ rotate: 5, scale: 1.05 }} className="relative">
                  <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
                  <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl">
                    <Hash className="w-6 h-6 text-white" />
                  </div>
                </motion.div>
                <div>
                  <h3 className="text-neutral-900 dark:text-white">Global Channel</h3>
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <Users className="w-3 h-3" />
                    {totalOnlineCount} members online
                  </p>
                </div>
              </>
            ) : (
              <>
                <motion.div whileHover={{ scale: 1.05 }} className="relative">
                  <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
                  <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl text-white">
                    {selectedUser?.avatar}
                  </div>
                </motion.div>
                <div>
                  <h3 className="text-neutral-900 dark:text-white">{selectedUser?.name}</h3>
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400">
                      <span className="absolute w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    </span>
                    {selectedUser?.status}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05, rotate: 180 }}
          whileTap={{ scale: 0.95 }}
          className="hidden lg:block p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-xl transition-colors relative z-10 border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700/50"
        >
          <ChevronDown className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
        </motion.button>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Message Input - always at bottom */}
      <div className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm theme-transition">
        <MessageInput
          chatMode={chatMode}
          selectedUser={selectedUser}
          message={props.message}
          setMessage={props.setMessage}
          handleSend={props.handleSend}
        />
      </div>
    </div>
  );
}
