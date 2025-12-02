import { useState } from 'react';
import { motion } from 'framer-motion';
import { Hash, User, Sparkles, PanelLeftClose, PanelLeft, Menu, Globe } from 'lucide-react';
import { DMChatSection } from './dm/DMChatSection';
import type { ChatMode } from '../../types';

export function ChatSection() {
  const [chatMode, setChatMode] = useState<ChatMode>('dm');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleModeChange = (mode: ChatMode) => {
    setChatMode(mode);
  };

  // DM mode - render DMChatSection with mode toggle
  if (chatMode === 'dm') {
    return (
      <DMChatSection
        chatMode={chatMode}
        onModeChange={handleModeChange}
      />
    );
  }

  // Global chat mode - Coming Soon with same sidebar design
  return (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden grid grid-cols-[auto_1fr] relative shadow-xl dark:shadow-2xl h-full min-h-0 theme-transition">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          w-72 border-r border-neutral-200 dark:border-neutral-800/50 flex flex-col z-50 overflow-hidden
          fixed lg:relative inset-y-0 left-0 h-full min-h-0
          transform transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${sidebarCollapsed ? 'lg:w-0 lg:border-0 lg:min-w-0' : 'lg:w-72'}
          bg-white/95 dark:bg-neutral-900/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none
        `}
      >
        {/* Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-bl-full" />

          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <h3 className="text-neutral-900 dark:text-white font-medium">Messages</h3>
              <Sparkles className="w-4 h-4 text-orange-500 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              {/* Collapse button for desktop */}
              <motion.button
                onClick={() => setSidebarCollapsed(true)}
                className="hidden lg:flex p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                title="Collapse sidebar"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <PanelLeftClose className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 relative z-10">
            <motion.button
              className="px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/20 to-white/0" />
              <Hash className="w-4 h-4 inline mr-2" />
              <span className="relative z-10">Global</span>
            </motion.button>
            <motion.button
              onClick={() => handleModeChange('dm')}
              className="px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <User className="w-4 h-4 inline mr-2" />
              <span>DM</span>
            </motion.button>
          </div>
        </div>

        {/* Empty channels list placeholder */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-neutral-400 dark:text-neutral-500 text-xs text-center mt-4">
            Channels coming soon
          </p>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="grid grid-rows-[auto_1fr] z-10 min-w-0 h-full min-h-0">
        {/* Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 flex items-center gap-3 bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative z-20 theme-transition">
          {/* Desktop expand sidebar button (when collapsed) */}
          {sidebarCollapsed && (
            <motion.button
              onClick={() => setSidebarCollapsed(false)}
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
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Menu className="w-5 h-5" />
          </motion.button>
          <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center border border-neutral-200 dark:border-neutral-700/50">
            <Hash className="w-5 h-5 text-neutral-400" />
          </div>
          <h3 className="text-neutral-900 dark:text-white font-medium">Global Chat</h3>
        </div>

        {/* Coming Soon Content */}
        <div className="flex flex-col items-center justify-center p-8 relative z-10">
          <div className="w-20 h-20 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4">
            <Globe className="w-10 h-10 text-neutral-400" />
          </div>
          <h2 className="text-xl font-medium text-neutral-900 dark:text-white mb-2">
            Coming Soon
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">
            Global chat is under development
          </p>
        </div>
      </div>
    </div>
  );
}
