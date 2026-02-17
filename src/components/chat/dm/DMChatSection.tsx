import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, PanelLeft } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useChat } from '../hooks/useChat';
import { DMConversationList } from './DMConversationList';
import { DMMessageList } from './DMMessageList';
import { DMChatInput } from './DMChatInput';
import { NewConversationModal } from './NewConversationModal';
import { setMentionClickHandler } from '../../../utils/mentionHandler';
import { getColorFromPubkey } from '../utils/avatarColors';
import { getDisplayName, getAvatar } from '../data/chatTypes';

interface DMChatSectionProps {
  pendingRecipient?: string | null;
  onPendingRecipientHandled?: () => void;
}

export function DMChatSection({ pendingRecipient, onPendingRecipientHandled }: DMChatSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [urlPendingRecipient, setUrlPendingRecipient] = useState<string | null>(null);
  const {
    selectedConversation,
    selectConversation,
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
    isRecipientTyping,
    hasMore,
    loadMore,
  } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [modalInitialValue, setModalInitialValue] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Handle ?nametag= URL param for DM navigation
  useEffect(() => {
    const nametag = searchParams.get('nametag');
    if (nametag) {
      const cleanNametag = nametag.startsWith('@') ? nametag.slice(1) : nametag;
      const formattedNametag = cleanNametag.toLowerCase().replace(/\s+/g, '-');
      setUrlPendingRecipient(formattedNametag);
      setSearchParams((prev) => {
        prev.delete('nametag');
        prev.delete('product');
        prev.delete('image');
        prev.delete('price');
        prev.delete('purchased');
        return prev;
      });
    }
  }, [searchParams, setSearchParams]);

  // Auto-focus input when message is sent (desktop only)
  useEffect(() => {
    if (!isSending && selectedConversation && window.innerWidth >= 1024) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isSending, selectedConversation]);

  // Auto-focus input when conversation is selected (desktop only)
  useEffect(() => {
    if (selectedConversation && window.innerWidth >= 1024) {
      // Small delay to ensure the input is rendered
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 100);
    }
  }, [selectedConversation]);

  // Handle pending recipient from prop, URL param, or @mention click
  // If conversation exists, select it directly; otherwise open modal
  const effectiveRecipient = pendingRecipient || urlPendingRecipient;
  useEffect(() => {
    if (effectiveRecipient) {
      const nametag = effectiveRecipient.startsWith('@') ? effectiveRecipient.slice(1) : effectiveRecipient;
      const existingConversation = filteredConversations.find(
        (c) => c.peerNametag?.toLowerCase() === nametag.toLowerCase()
      );
      if (existingConversation) {
        selectConversation(existingConversation);
      } else {
        setModalInitialValue(nametag);
        setShowNewConversation(true);
      }
      onPendingRecipientHandled?.();
      setUrlPendingRecipient(null);
    }
  }, [effectiveRecipient, onPendingRecipientHandled, filteredConversations, selectConversation]);

  // Set up mention click handler - clicking @mention in DM
  // If conversation exists, select it directly; otherwise open modal
  useEffect(() => {
    setMentionClickHandler((username) => {
      const nametag = username.startsWith('@') ? username.slice(1) : username;
      // Check if conversation already exists
      const existingConversation = filteredConversations.find(
        (c) => c.peerNametag?.toLowerCase() === nametag.toLowerCase()
      );
      if (existingConversation) {
        selectConversation(existingConversation);
      } else {
        setModalInitialValue(nametag);
        setShowNewConversation(true);
      }
    });
    return () => setMentionClickHandler(null);
  }, [filteredConversations, selectConversation]);

  const handleSend = () => {
    if (messageInput.trim()) {
      sendMessage(messageInput);
    }
  };

  const handleNewConversation = async (pubkeyOrNametag: string): Promise<boolean> => {
    const conversation = await startNewConversation(pubkeyOrNametag);
    return !!conversation;
  };

  // Chat content (shared between normal and fullscreen modes)
  const chatContent = (
    <>
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Left Sidebar - Conversation List */}
      <DMConversationList
        conversations={filteredConversations}
        selectedConversation={selectedConversation}
        onSelect={(conversation) => {
          selectConversation(conversation);
          setSidebarOpen(false);
        }}
        onNewConversation={() => setShowNewConversation(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        hasUnread={totalUnreadCount > 0}
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
            {/* Mobile sidebar button */}
            <motion.button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="Show conversations"
            >
              <PanelLeft className="w-5 h-5" />
            </motion.button>

            {/* Conversation or default header */}
            <div className="flex items-center gap-3">
              {selectedConversation ? (
                <>
                  <motion.div whileHover={{ scale: 1.05 }} className="relative">
                    <div className={`relative w-12 h-12 rounded-xl bg-linear-to-br ${getColorFromPubkey(selectedConversation.peerPubkey).gradient} flex items-center justify-center shadow-xl text-white font-medium`}>
                      {getAvatar(selectedConversation.peerPubkey, selectedConversation.peerNametag)}
                    </div>
                  </motion.div>
                  <h3 className="text-neutral-900 dark:text-white font-medium">
                    {getDisplayName(selectedConversation.peerPubkey, selectedConversation.peerNametag)}
                  </h3>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        {selectedConversation ? (
          <DMMessageList key={selectedConversation.peerPubkey} messages={messages} isLoading={isLoadingMessages} isRecipientTyping={isRecipientTyping} hasMore={hasMore} loadMore={loadMore} />
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
              ref={inputRef}
              value={messageInput}
              onChange={setMessageInput}
              onSend={handleSend}
              isSending={isSending}
              placeholder={`Message ${getDisplayName(selectedConversation.peerPubkey, selectedConversation.peerNametag)}...`}
              participantPubkey={selectedConversation.peerPubkey}
            />
          </div>
        )}
      </div>
    </>
  );

  // New Conversation Modal - rendered separately to avoid duplication during fullscreen transitions
  const modalElement = (
    <NewConversationModal
      isOpen={showNewConversation}
      onClose={() => {
        setShowNewConversation(false);
        setModalInitialValue(undefined);
      }}
      onStart={handleNewConversation}
      initialValue={modalInitialValue}
    />
  );

  return (
    <>
      <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-none md:rounded-3xl border-0 md:border md:border-neutral-200 dark:md:border-neutral-800/50 overflow-hidden grid grid-cols-1 lg:grid-cols-[auto_1fr] relative lg:shadow-xl dark:lg:shadow-2xl h-full min-h-0 theme-transition">
        {chatContent}
      </div>
      {modalElement}
    </>
  );
}
