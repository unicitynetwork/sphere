import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Menu, PanelLeft, ChevronDown, Users, Maximize2, Minimize2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGroupChat } from '../hooks/useGroupChat';
import { useServices } from '../../../contexts/useServices';
import { useUIState } from '../../../hooks/useUIState';
import { GroupList } from './GroupList';
import { GroupMessageList } from './GroupMessageList';
import { DMChatInput } from '../dm/DMChatInput';
import { JoinGroupModal } from './JoinGroupModal';
import { agents } from '../../../config/activities';
import { setMentionClickHandler } from '../../../utils/mentionHandler';
import type { ChatModeChangeHandler } from '../../../types';

interface GroupChatSectionProps {
  onModeChange: ChatModeChangeHandler;
}

export function GroupChatSection({ onModeChange }: GroupChatSectionProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    selectedGroup,
    selectGroup,
    leaveGroup,
    joinGroup,
    filteredGroups,
    availableGroups,
    isLoadingAvailable,
    refreshAvailableGroups,
    messages,
    isLoadingMessages,
    sendMessage,
    isSending,
    messageInput,
    setMessageInput,
    searchQuery,
    setSearchQuery,
    totalUnreadCount,
    isConnected,
  } = useGroupChat();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [inviteLinkFromUrl, setInviteLinkFromUrl] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Global fullscreen state
  const { isFullscreen, setFullscreen } = useUIState();

  // Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, setFullscreen]);

  // Handle ?join= URL parameter for invite links
  useEffect(() => {
    const joinParam = searchParams.get('join');
    if (joinParam) {
      setInviteLinkFromUrl(joinParam);
      setShowJoinGroup(true);
      // Clear the parameter from URL
      setSearchParams((prev) => {
        prev.delete('join');
        return prev;
      });
    }
  }, [searchParams, setSearchParams]);

  // Get my pubkey for message display
  const { groupChatService } = useServices();
  const myPubkey = groupChatService?.getMyPublicKey() || null;

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

  // Auto-focus input when message is sent (desktop only)
  useEffect(() => {
    if (!isSending && selectedGroup && window.innerWidth >= 1024) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isSending, selectedGroup]);

  // Auto-focus input when group is selected (desktop only)
  useEffect(() => {
    if (selectedGroup && window.innerWidth >= 1024) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 100);
    }
  }, [selectedGroup]);

  // Set up mention click handler - clicking @mention switches to DM with that user
  useEffect(() => {
    setMentionClickHandler((username) => {
      onModeChange('dm', username);
    });
    return () => setMentionClickHandler(null);
  }, [onModeChange]);

  const handleAgentSelect = (agentId: string) => {
    navigate(`/agents/${agentId}`);
    setShowAgentPicker(false);
  };

  // Get current chat agent config
  const chatAgent = agents.find((a) => a.id === 'chat')!;

  const handleSend = () => {
    if (messageInput.trim()) {
      sendMessage(messageInput);
    }
  };

  const handleJoinGroup = async (groupId: string, inviteCode?: string): Promise<boolean> => {
    const success = await joinGroup(groupId, inviteCode);
    if (success) {
      // Find the group and select it to open immediately
      const group = availableGroups.find((g) => g.id === groupId);
      if (group) {
        selectGroup(group);
      }
    }
    return success;
  };

  const handleLeaveGroup = async (groupId: string) => {
    await leaveGroup(groupId);
  };

  // Chat content (shared between normal and fullscreen modes)
  const chatContent = (
    <>
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Left Sidebar - Group List */}
      <GroupList
        groups={filteredGroups}
        selectedGroup={selectedGroup}
        onSelect={(group) => {
          selectGroup(group);
          setSidebarOpen(false);
        }}
        onLeave={handleLeaveGroup}
        onJoinGroup={() => setShowJoinGroup(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        totalUnreadCount={totalUnreadCount}
        onModeChange={onModeChange}
      />

      {/* Main Chat Area */}
      <div className="grid grid-rows-[auto_1fr_auto] z-10 min-w-0 h-full min-h-0">
        {/* Chat Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 flex items-center justify-between bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative z-20 theme-transition">
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/5 rounded-tr-full" />

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

            {/* Mobile & Fullscreen: Agent picker dropdown */}
            <div ref={pickerRef} className={`relative ${isFullscreen ? '' : 'lg:hidden'}`}>
              <button
                onClick={() => setShowAgentPicker(!showAgentPicker)}
                className="flex items-center gap-2 active:scale-95 transition-transform"
              >
                <div className={`p-2.5 rounded-xl bg-linear-to-br ${chatAgent.color}`}>
                  <chatAgent.Icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <div className="text-lg text-neutral-900 dark:text-white font-medium">{chatAgent.name}</div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">{chatAgent.description}</div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-neutral-500 dark:text-neutral-400 transition-transform ${
                    showAgentPicker ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence>
                {showAgentPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700/50 rounded-xl shadow-xl overflow-hidden z-50"
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

            {/* Desktop: Show group or default header (hidden in fullscreen) */}
            <div className={`${isFullscreen ? 'hidden' : 'hidden lg:flex'} items-center gap-3`}>
              {selectedGroup ? (
                <>
                  <motion.div whileHover={{ scale: 1.05 }} className="relative">
                    <div className="absolute inset-0 bg-blue-500 rounded-xl blur-lg opacity-50" />
                    <div className="relative w-12 h-12 rounded-xl bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-xl text-white font-medium">
                      <Hash className="w-6 h-6" />
                    </div>
                  </motion.div>
                  <div>
                    <h3 className="text-neutral-900 dark:text-white font-medium">
                      {selectedGroup.getDisplayName()}
                    </h3>
                    {selectedGroup.memberCount !== undefined && (
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {selectedGroup.memberCount} members
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center border border-neutral-200 dark:border-neutral-700/50">
                    <Hash className="w-6 h-6 text-neutral-400" />
                  </div>
                  <div>
                    <h3 className="text-neutral-900 dark:text-white font-medium">Group Chat</h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {isConnected ? 'Select a group to start' : 'Connecting...'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Fullscreen toggle */}
          <motion.button
            onClick={() => setFullscreen(!isFullscreen)}
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
        </div>

        {/* Messages */}
        {selectedGroup ? (
          <GroupMessageList
            messages={messages}
            isLoading={isLoadingMessages}
            myPubkey={myPubkey}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-8 min-h-0">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-24 h-24 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4"
            >
              <Hash className="w-12 h-12 text-neutral-400" />
            </motion.div>
            <p className="text-neutral-500 dark:text-neutral-400">Welcome to Group Chat</p>
            <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-1">
              Select a group or join a new one
            </p>
            <motion.button
              onClick={() => setShowJoinGroup(true)}
              className="mt-4 px-6 py-3 rounded-xl bg-linear-to-r from-blue-500 to-purple-600 text-white font-medium shadow-lg shadow-blue-500/30"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Browse Groups
            </motion.button>
          </div>
        )}

        {/* Message Input */}
        {selectedGroup && (
          <div className="shrink-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm theme-transition">
            <DMChatInput
              ref={inputRef}
              value={messageInput}
              onChange={setMessageInput}
              onSend={handleSend}
              isSending={isSending}
              placeholder={`Message #${selectedGroup.getDisplayName()}...`}
            />
          </div>
        )}
      </div>

      {/* Join Group Modal */}
      <JoinGroupModal
        isOpen={showJoinGroup}
        onClose={() => {
          setShowJoinGroup(false);
          setInviteLinkFromUrl(null);
        }}
        availableGroups={availableGroups}
        isLoading={isLoadingAvailable}
        onRefresh={refreshAvailableGroups}
        onJoin={handleJoinGroup}
        initialInviteLink={inviteLinkFromUrl || undefined}
      />
    </>
  );

  // Normal container
  const normalContent = (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden grid grid-cols-1 lg:grid-cols-[auto_1fr] relative lg:shadow-xl dark:lg:shadow-2xl h-full min-h-0 theme-transition">
      {chatContent}
    </div>
  );

  // Fullscreen portal content with smooth animation
  const fullscreenContent = createPortal(
    <AnimatePresence>
      {isFullscreen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className="fixed top-14 left-0 right-0 bottom-0 z-99999 bg-white dark:bg-neutral-900"
        >
          <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[auto_1fr] overflow-hidden relative">
            {chatContent}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <>
      {!isFullscreen && normalContent}
      {fullscreenContent}
    </>
  );
}
