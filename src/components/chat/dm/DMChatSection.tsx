import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Menu, PanelLeft, Hash, User } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { DMConversationList } from './DMConversationList';
import { DMMessageList } from './DMMessageList';
import { DMChatInput } from './DMChatInput';
import { NewConversationModal } from './NewConversationModal';
import type { ChatMode } from '../../../types';

interface DMChatSectionProps {
  chatMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export function DMChatSection({ chatMode, onModeChange }: DMChatSectionProps) {
  const {
    conversations,
    selectedConversation,
    selectConversation,
    deleteConversation,
    startNewConversation,
    messages,
    isLoadingMessages,
    sendMessage,
    isSending,
    messageInput,
    setMessageInput,
    searchQuery,
    setSearchQuery,
    filteredConversations,
    totalUnreadCount,
  } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);

  const handleSend = () => {
    if (messageInput.trim()) {
      sendMessage(messageInput);
    }
  };

  const handleNewConversation = async (pubkeyOrNametag: string): Promise<boolean> => {
    const conversation = await startNewConversation(pubkeyOrNametag);
    return !!conversation;
  };

  return (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden grid grid-cols-[auto_1fr] relative shadow-xl dark:shadow-2xl h-full min-h-0 theme-transition">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      {/* Left Sidebar - Conversation List */}
      <DMConversationList
        conversations={filteredConversations}
        selectedConversation={selectedConversation}
        onSelect={(conversation) => {
          selectConversation(conversation);
          setSidebarOpen(false);
        }}
        onDelete={deleteConversation}
        onNewConversation={() => setShowNewConversation(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        totalUnreadCount={totalUnreadCount}
        chatMode={chatMode}
        onModeChange={onModeChange}
      />

      {/* Main Chat Area */}
      <div className="grid grid-rows-[auto_1fr_auto] z-10 min-w-0 h-full min-h-0">
        {/* Chat Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 flex items-center justify-between bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative z-20 theme-transition">
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-500/5 rounded-tr-full" />

          <div className="flex items-center gap-3 relative z-10">
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

            {selectedConversation ? (
              <div className="flex items-center gap-3">
                <motion.div whileHover={{ scale: 1.05 }} className="relative">
                  <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
                  <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl text-white font-medium">
                    {selectedConversation.getAvatar()}
                  </div>
                </motion.div>
                <div>
                  <h3 className="text-neutral-900 dark:text-white font-medium">
                    {selectedConversation.getDisplayName()}
                  </h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {selectedConversation.participantPubkey.slice(0, 16)}...
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center border border-neutral-200 dark:border-neutral-700/50">
                  <MessageCircle className="w-6 h-6 text-neutral-400" />
                </div>
                <div>
                  <h3 className="text-neutral-900 dark:text-white font-medium">
                    Direct Messages
                  </h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Select a conversation to start
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Mode Toggle - Desktop */}
          <div className="hidden lg:flex items-center gap-2 relative z-10">
            <motion.button
              onClick={() => onModeChange('global')}
              className="px-3 py-1.5 rounded-lg text-sm transition-all bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Hash className="w-4 h-4 inline mr-1" />
              Global
            </motion.button>
            <motion.button
              className="px-3 py-1.5 rounded-lg text-sm transition-all bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <User className="w-4 h-4 inline mr-1" />
              DM
            </motion.button>
          </div>
        </div>

        {/* Messages */}
        {selectedConversation ? (
          <DMMessageList messages={messages} isLoading={isLoadingMessages} />
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-8 min-h-0">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-24 h-24 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4"
            >
              <MessageCircle className="w-12 h-12 text-neutral-400" />
            </motion.div>
            <p className="text-neutral-500 dark:text-neutral-400">
              Welcome to Direct Messages
            </p>
            <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-1">
              Select a conversation or start a new one
            </p>
            <motion.button
              onClick={() => setShowNewConversation(true)}
              className="mt-4 px-6 py-3 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white font-medium shadow-lg shadow-orange-500/30"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Start New Conversation
            </motion.button>
          </div>
        )}

        {/* Message Input */}
        {selectedConversation && (
          <div className="shrink-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm theme-transition">
            <DMChatInput
              value={messageInput}
              onChange={setMessageInput}
              onSend={handleSend}
              isSending={isSending}
              placeholder={`Message ${selectedConversation.getDisplayName()}...`}
            />
          </div>
        )}
      </div>

      {/* New Conversation Modal */}
      <NewConversationModal
        isOpen={showNewConversation}
        onClose={() => setShowNewConversation(false)}
        onStart={handleNewConversation}
      />
    </div>
  );
}
