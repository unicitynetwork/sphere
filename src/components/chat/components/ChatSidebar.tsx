// src/components/chat/components/ChatSidebar.tsx
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Sparkles, User, X } from 'lucide-react';
import type { ChatState } from '../../../hooks/useChatState';
import { UserContact } from './UserContact';

type SidebarProps = Pick<ChatState, 'chatMode' | 'handleModeChange' | 'users' | 'onlineCount' | 'selectedUser' | 'handleUserSelect'> & {
  isOpen: boolean;
  onClose: () => void;
};

export function ChatSidebar({ chatMode, handleModeChange, users, onlineCount, selectedUser, handleUserSelect, isOpen, onClose }: SidebarProps) {

  const totalOnlineCount = onlineCount + 124;

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div className={`
        w-80 border-r border-neutral-800/50 flex flex-col z-50
        fixed lg:relative inset-y-0 left-0
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        bg-neutral-900/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none
      `}>
        {/* Mode Toggle Header */}
        <div className="p-6 border-b border-neutral-800/50 bg-linear-to-br from-neutral-900/80 to-neutral-800/40 backdrop-blur-sm relative">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-bl-full" />

          {/* Close button for mobile */}
          <button
            onClick={onClose}
            className="lg:hidden absolute top-4 right-4 p-2 rounded-lg bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50 transition-colors z-20"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-4 relative z-10">
            <h3 className="text-white">Messages</h3>
            <Sparkles className="w-4 h-4 text-orange-500 animate-pulse" />
          </div>

          <div className="grid grid-cols-2 gap-2 relative z-10">
            {/* Global Button */}
            <motion.button
              onClick={() => handleModeChange('global')}
              className={`px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden ${
                chatMode === 'global' ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30' : 'bg-neutral-800/50 text-neutral-400 hover:bg-neutral-800 border border-neutral-700/50'
              }`}
            >
              {chatMode === 'global' && (<div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/20 to-white/0" />)}
              <Hash className="w-4 h-4 inline mr-2" />
              <span className="relative z-10">Global</span>
            </motion.button>

            {/* DM Button */}
            <motion.button
              onClick={() => handleModeChange('dm')}
              className={`px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden ${
                chatMode === 'dm' ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30' : 'bg-neutral-800/50 text-neutral-400 hover:bg-neutral-800 border border-neutral-700/50'
              }`}
            >
              {chatMode === 'dm' && (<div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/20 to-white/0" />)}
              <User className="w-4 h-4 inline mr-2" />
              <span className="relative z-10">DM</span>
            </motion.button>
          </div>
        </div>

        {/* Contacts/Users List */}
        <div className="flex-1 overflow-y-auto">
          {chatMode === 'global' ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </div>
                  <span className="text-sm text-neutral-400">{totalOnlineCount} online</span>
                </div>
              </div>
              {/* Global Channel Card */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="p-4 rounded-xl bg-linear-to-br from-neutral-800/60 to-neutral-900/60 backdrop-blur-sm border border-neutral-700/50 relative overflow-hidden group"
                onClick={() => handleModeChange('global')}
              >
                {/* Hover glow */}
                <div className="absolute inset-0 bg-linear-to-r from-orange-500/0 via-orange-500/5 to-orange-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-center gap-3 mb-2 relative z-10">
                  <div className="w-10 h-10 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
                    <Hash className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-white">Global Channel</span>
                </div>
                <p className="text-xs text-neutral-400 relative z-10">Community discussion and support</p>
              </motion.div>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {users.map((user) => (
                <UserContact
                  key={user.id}
                  user={user}
                  isSelected={selectedUser?.id === user.id}
                  onClick={() => handleUserSelect(user)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}