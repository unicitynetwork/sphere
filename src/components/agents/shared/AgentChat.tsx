import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Plus, X, PanelLeftClose, Search, Trash2, Clock, MessageSquare, Activity, ChevronDown, Cloud, Check, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../../config/activities';
import { useAgentChat, type ChatMessage } from '../../../hooks/useAgentChat';
import { useWallet } from '../../wallet/L3/hooks/useWallet';
import { v4 as uuidv4 } from 'uuid';
import { ChatHeader, ChatBubble, ChatInput, QuickActions } from './index';
import { useChatHistory } from './useChatHistory';
import { useUrlSession } from './useUrlSession';
import type { SyncState } from './useChatHistorySync';

// Generic sidebar item (for custom agent-specific items like bets, purchases, orders)
export interface SidebarItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  icon?: ReactNode;
  timestamp: number;
  status?: string;
  amount?: string;
  [key: string]: unknown;
}

// Configuration for the custom sidebar content (optional - each agent defines their own)
export interface SidebarConfig<TItem extends SidebarItem> {
  title: string;
  emptyText: string;
  emptyIcon?: ReactNode;
  items: TItem[];
  renderItem: (item: TItem, onClick: () => void) => ReactNode;
  onItemClick?: (item: TItem) => void;
}

// Sidebar tab type
type SidebarTab = 'history' | 'activity';

// Extended message with optional card data
export interface AgentMessage<TCardData = unknown> {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  thinking?: string;
  cardData?: TCardData;
  showActionButton?: boolean;
}

// Configuration for action button in messages
interface ActionConfig<TCardData> {
  label: string | ((data: TCardData) => string);
  onAction: (data: TCardData) => void;
}

interface AgentChatProps<TCardData, TItem extends SidebarItem = SidebarItem> {
  agent: AgentConfig;

  // Mock response handler (for agents that don't use real backend)
  // When provided AND agent has no backendActivityId, mock mode is used automatically
  getMockResponse?: (
    userInput: string,
    addMessage: (content: string, cardData?: TCardData, showActionButton?: boolean) => void
  ) => Promise<void>;

  // Process assistant message to attach card data (for unified agents)
  processMessage?: (message: AgentMessage<TCardData>, allMessages: AgentMessage<TCardData>[]) => AgentMessage<TCardData>;

  // Card rendering in messages
  renderMessageCard?: (cardData: TCardData, message: AgentMessage<TCardData>) => ReactNode;

  // Action button
  actionConfig?: ActionConfig<TCardData>;

  // Additional message actions
  renderMessageActions?: (message: AgentMessage<TCardData>) => ReactNode;

  // Additional modals/content
  additionalContent?: ReactNode;

  // Background gradient colors
  bgGradient?: { from: string; to: string };

  // Custom sidebar configuration (bets, purchases, orders, etc.)
  // Each agent can provide their own items and rendering
  sidebarConfig?: SidebarConfig<TItem>;
}

export function AgentChat<TCardData, TItem extends SidebarItem = SidebarItem>({
  agent,
  getMockResponse,
  processMessage,
  renderMessageCard,
  actionConfig,
  renderMessageActions,
  additionalContent,
  bgGradient = { from: 'bg-indigo-500/5', to: 'bg-cyan-500/5' },
  sidebarConfig,
}: AgentChatProps<TCardData, TItem>) {
  const [input, setInput] = useState('');
  const [extendedMessages, setExtendedMessages] = useState<AgentMessage<TCardData>[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMockTyping, setIsMockTyping] = useState(false);

  // Sidebar state (left sidebar for chat history and activity)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('history');
  const [showTabSelector, setShowTabSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasGreeted = useRef(false);
  const currentAgentId = useRef(agent.id);
  const currentNametag = useRef<string | null>(null);
  const lastSavedMessagesRef = useRef<string>('');
  const isMountedRef = useRef(true);

  // Get nametag from wallet for user identification
  const { nametag } = useWallet();

  // Chat history hook - bound to nametag so each user has their own history
  const {
    sessions,
    currentSession: historySession, // Session created when saving messages
    loadSession,
    deleteSession,
    clearAllHistory,
    resetCurrentSession,
    showDeleteSuccess,
    saveCurrentMessages,
    searchSessions,
    syncState,
    syncImmediately,
    justDeleted,
  } = useChatHistory({
    agentId: agent.id,
    userId: nametag ?? undefined,
    enabled: !!nametag, // Only enable when user has a nametag
  });

  // URL-based session management with TanStack Query
  // Both mobile and desktop instances sync via URL changes automatically
  const {
    urlSessionId,
    currentSession,
    currentMessages: sessionMessages,
    navigateToSession,
    clearSession,
  } = useUrlSession({ sessions });

  // Update URL when a new session is created (via saveCurrentMessages)
  useEffect(() => {
    if (historySession?.id && historySession.id !== urlSessionId) {
      navigateToSession(historySession.id);
    }
  }, [historySession?.id, urlSessionId, navigateToSession]);

  // Filter sessions based on search
  const filteredSessions = searchQuery.trim()
    ? searchSessions(searchQuery)
    : sessions;

  // Use the agent chat hook for streaming support
  const {
    messages,
    setMessages,
    isStreaming,
    currentStatus,
    sendMessage,
    stopGeneration,
    agentMode,
  } = useAgentChat({
    activityId: agent.backendActivityId || agent.id,
    userId: nametag ?? undefined,
  });

  // Determine if we're in mock mode:
  // - If agent has no backendActivityId AND getMockResponse is provided, use mock mode
  // - Otherwise, use agentMode from env variable
  const useMockMode = (getMockResponse && !agent.backendActivityId) || agentMode === 'mock';
  const isTyping = useMockMode ? isMockTyping : isStreaming;

  // Copy message content
  const handleCopy = async (text: string, id: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-HTTPS environments
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      console.warn('Failed to copy text');
    }
  };

  // Track component mount state for async operations
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset state when agent changes
  useEffect(() => {
    if (currentAgentId.current !== agent.id) {
      currentAgentId.current = agent.id;
      setExtendedMessages([]);
      setInput('');
      hasGreeted.current = false;
      lastSavedMessagesRef.current = '';
      if (!useMockMode) {
        setMessages([]);
      }
    }
  }, [agent.id, setMessages, useMockMode]);

  // Reset state when nametag changes (user switches account)
  useEffect(() => {
    if (currentNametag.current !== nametag) {
      currentNametag.current = nametag ?? null;
      setExtendedMessages([]);
      setInput('');
      hasGreeted.current = false;
      lastSavedMessagesRef.current = '';
      if (!useMockMode) {
        setMessages([]);
      }
    }
  }, [nametag, setMessages, useMockMode]);

  // Sync session from URL via TanStack Query
  // When sessionMessages changes (from query), update the UI
  // This handles both mobile and desktop instances automatically
  useEffect(() => {
    if (!urlSessionId || sessionMessages.length === 0) return;

    const agentMessages: AgentMessage<TCardData>[] = sessionMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      thinking: m.thinking,
    }));
    setExtendedMessages(agentMessages);
    if (!useMockMode) {
      setMessages(sessionMessages);
    }
    hasGreeted.current = true;
    lastSavedMessagesRef.current = JSON.stringify(sessionMessages.map(m => ({ id: m.id, content: m.content })));
  }, [urlSessionId, sessionMessages, setMessages, useMockMode]);

  // Sync messages from useAgentChat hook (for non-mock mode)
  useEffect(() => {
    if (useMockMode) return;

    setExtendedMessages(prev => {
      const newExtended: AgentMessage<TCardData>[] = messages.map(msg => {
        const existing = prev.find(e => e.id === msg.id);
        const baseMessage: AgentMessage<TCardData> = {
          ...msg,
          cardData: existing?.cardData,
          showActionButton: existing?.showActionButton,
        };
        // Apply message processor if provided
        if (processMessage) {
          return processMessage(baseMessage, prev);
        }
        return baseMessage;
      });
      return newExtended;
    });
  }, [messages, useMockMode, processMessage]);

  // Auto-save chat history when messages change (debounced)
  useEffect(() => {
    if (isTyping) return;

    // Filter out greeting messages for saving
    const messagesToSave = extendedMessages.filter(m => m.id !== 'greeting' && m.content.trim());
    if (messagesToSave.length === 0) return;

    // Create a simple hash of messages to detect changes
    const messagesHash = JSON.stringify(messagesToSave.map(m => ({ id: m.id, content: m.content })));
    if (messagesHash === lastSavedMessagesRef.current) return;

    // Debounce the save
    const timeoutId = setTimeout(() => {
      // Convert AgentMessage to ChatMessage format for storage
      const chatMessages: ChatMessage[] = messagesToSave.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        thinking: m.thinking,
      }));
      saveCurrentMessages(chatMessages);
      lastSavedMessagesRef.current = messagesHash;
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [extendedMessages, isTyping, saveCurrentMessages]);

  // Greeting message (skip if restoring session from URL)
  useEffect(() => {
    if (!hasGreeted.current && extendedMessages.length === 0 && agent.greetingMessage && !urlSessionId) {
      hasGreeted.current = true;
      if (useMockMode) {
        setExtendedMessages([{
          id: 'greeting',
          role: 'assistant',
          content: agent.greetingMessage,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages([{
          id: 'greeting',
          role: 'assistant',
          content: agent.greetingMessage,
          timestamp: Date.now(),
        }]);
      }
    }
  }, [agent.greetingMessage, extendedMessages.length, setMessages, useMockMode, urlSessionId]);

  const scrollToBottom = useCallback((instant = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [extendedMessages, isTyping, scrollToBottom]);

  // Auto-focus input when typing ends (desktop only to prevent keyboard auto-open on mobile)
  useEffect(() => {
    if (!isTyping && window.innerWidth >= 1024) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [isTyping]);

  // Handle mobile keyboard - scroll to bottom when input is focused
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleFocus = () => {
      // Only scroll on mobile (< 1024px)
      if (window.innerWidth < 1024) {
        // Small delay to wait for keyboard to appear
        setTimeout(() => {
          scrollToBottom(true);
        }, 300);
      }
    };

    input.addEventListener('focus', handleFocus);
    return () => input.removeEventListener('focus', handleFocus);
  }, [scrollToBottom]);

  const addAssistantMessage = (content: string, cardData?: TCardData, showActionButton?: boolean) => {
    setExtendedMessages(prev => [...prev, {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      cardData,
      showActionButton,
    }]);
  };

  const handleSend = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isTyping) return;

    const userInput = messageText.toLowerCase();
    setInput('');

    // Focus input (desktop only to prevent keyboard auto-open on mobile)
    if (window.innerWidth >= 1024) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 0);
    }

    if (useMockMode && getMockResponse) {
      // Mock mode - add user message and get mock response
      setExtendedMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'user',
        content: messageText,
        timestamp: Date.now(),
      }]);

      setIsMockTyping(true);
      await getMockResponse(userInput, addAssistantMessage);
      setIsMockTyping(false);
    } else {
      // Real mode - use the hook
      await sendMessage(messageText);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (message: string) => {
    if (isTyping) return;
    handleSend(message);
  };

  const handleAction = (cardData: TCardData) => {
    if (actionConfig) {
      actionConfig.onAction(cardData);
    }
  };

  const handleNewChat = () => {
    setExtendedMessages([]);
    if (!useMockMode) {
      setMessages([]);
    }
    hasGreeted.current = false;
    lastSavedMessagesRef.current = '';
    // Reset current session so a new one is created when first message is saved
    resetCurrentSession();
    // Clear URL session param
    clearSession();
  };

  // Load a previous chat session via URL navigation
  // TanStack Query handles the actual data loading
  const handleLoadSession = useCallback((sessionId: string) => {
    // IMPORTANT: Load session into useChatHistory first to set currentSessionRef
    // This prevents saveCurrentMessages from creating a duplicate session
    loadSession(sessionId);
    // Navigate to session - TanStack Query will load the data for display
    navigateToSession(sessionId);
    // Close sidebar on mobile
    setSidebarOpen(false);
  }, [loadSession, navigateToSession]);

  const handleDeleteSession = async (sessionId: string) => {
    const wasCurrentSession = currentSession?.id === sessionId;
    deleteSession(sessionId);
    setShowDeleteConfirm(null);

    // If we deleted the current session, start a new chat
    if (wasCurrentSession) {
      handleNewChat();
    }

    // Wait for IPFS sync then show success
    try {
      await syncImmediately();
      if (isMountedRef.current) {
        showDeleteSuccess();
      }
    } catch (error) {
      console.error('Failed to sync after deleting session:', error);
    }
  };

  const handleClearAllHistory = async () => {
    clearAllHistory();
    setShowClearAllConfirm(false);
    handleNewChat();

    // Sync in background, show success after completion
    try {
      await syncImmediately();
      if (isMountedRef.current) {
        showDeleteSuccess();
      }
    } catch (error) {
      console.error('Failed to sync after clearing history:', error);
    }
  };

  const getActionLabel = (cardData: TCardData): string => {
    if (!actionConfig) return '';
    return typeof actionConfig.label === 'function'
      ? actionConfig.label(cardData)
      : actionConfig.label;
  };

  // Format relative time for session display
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  // Get sync display info based on detailed step from IPFS service
  const getSyncDisplayInfo = (state: SyncState): { label: string; icon: ReactNode; color: string } => {
    // Use detailed step for more granular status
    switch (state.currentStep) {
      case 'initializing':
        return {
          label: 'Initializing...',
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          color: 'text-blue-500'
        };
      case 'resolving-ipns':
        return {
          label: 'Looking up...',
          icon: <Cloud className="w-3 h-3" />,
          color: 'text-blue-500'
        };
      case 'fetching-content':
        return {
          label: 'Downloading...',
          icon: <Cloud className="w-3 h-3 animate-pulse" />,
          color: 'text-blue-500'
        };
      case 'importing-data':
        return {
          label: 'Importing...',
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          color: 'text-blue-500'
        };
      case 'building-data':
        return {
          label: 'Preparing...',
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          color: 'text-amber-500'
        };
      case 'uploading':
        return {
          label: 'Uploading...',
          icon: <Cloud className="w-3 h-3 animate-pulse" />,
          color: 'text-amber-500'
        };
      case 'publishing-ipns':
        return {
          label: 'Publishing...',
          icon: <Cloud className="w-3 h-3 animate-pulse" />,
          color: 'text-amber-500'
        };
      case 'complete':
        return {
          label: 'Synced',
          icon: <Check className="w-3 h-3" />,
          color: 'text-green-500'
        };
      case 'error':
        return {
          label: 'Sync error',
          icon: <AlertCircle className="w-3 h-3" />,
          color: 'text-red-500'
        };
      case 'idle':
      default:
        // Check TanStack Query states for additional context
        if (state.isError) {
          return {
            label: 'Sync error',
            icon: <AlertCircle className="w-3 h-3" />,
            color: 'text-red-500'
          };
        }
        return {
          label: 'Synced',
          icon: <Check className="w-3 h-3" />,
          color: 'text-neutral-400'
        };
    }
  };

  // Render sync status indicator (always visible)
  const renderSyncIndicator = () => {
    // Show success message after deletion
    if (justDeleted) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-green-500 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800/50">
          <Check className="w-3 h-3" />
          <span>Successfully deleted</span>
        </div>
      );
    }

    const { label, icon, color } = getSyncDisplayInfo(syncState);

    return (
      <div className={`flex items-center gap-1.5 text-xs ${color} px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800/50`}>
        {icon}
        <span>{syncState.stepProgress || label}</span>
      </div>
    );
  };

  // Render left sidebar with tabs (history and activity)
  const renderHistorySidebar = () => {

    return (
      <>
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden absolute inset-0 bg-black/50 z-40 rounded-3xl"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <div className={`
          w-64 border-r border-neutral-200 dark:border-neutral-800/50 flex flex-col z-50 overflow-hidden
          absolute lg:relative inset-y-0 left-0
          transform transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${sidebarCollapsed ? 'lg:w-0 lg:border-0 lg:min-w-0' : 'lg:w-64'}
          bg-white/95 dark:bg-neutral-900/95 lg:bg-transparent dark:lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none rounded-l-3xl lg:rounded-none
        `}>
          {/* Header with tabs */}
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800/50">
            <div className="flex items-center justify-between mb-3">
              {/* Title with dropdown selector if sidebarConfig is provided */}
              {sidebarConfig ? (
                <div className="relative">
                  <button
                    onClick={() => setShowTabSelector(!showTabSelector)}
                    className="text-neutral-900 dark:text-white font-medium flex items-center gap-2 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    {sidebarTab === 'history' ? (
                      <>
                        <Clock className="w-4 h-4" />
                        Chat History
                      </>
                    ) : (
                      <>
                        <Activity className="w-4 h-4" />
                        {sidebarConfig.title}
                      </>
                    )}
                    <ChevronDown className={`w-4 h-4 transition-transform ${showTabSelector ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown menu */}
                  <AnimatePresence>
                    {showTabSelector && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute top-full left-0 mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-hidden z-10 min-w-[160px]"
                      >
                        <button
                          onClick={() => {
                            setSidebarTab('history');
                            setShowTabSelector(false);
                          }}
                          className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors ${
                            sidebarTab === 'history'
                              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-white'
                              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                          }`}
                        >
                          <Clock className="w-4 h-4" />
                          Chat History
                        </button>
                        <button
                          onClick={() => {
                            setSidebarTab('activity');
                            setShowTabSelector(false);
                          }}
                          className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors ${
                            sidebarTab === 'activity'
                              ? 'bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-white'
                              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                          }`}
                        >
                          <Activity className="w-4 h-4" />
                          {sidebarConfig.title}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <h3 className="text-neutral-900 dark:text-white font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Chat History
                </h3>
              )}

              <div className="flex items-center gap-1">
                {sidebarTab === 'history' && (
                  <motion.button
                    onClick={handleNewChat}
                    className={`p-2 rounded-lg bg-linear-to-br ${agent.color} text-white`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="New chat"
                  >
                    <Plus className="w-4 h-4" />
                  </motion.button>
                )}
                {/* Collapse button for desktop */}
                <motion.button
                  onClick={() => setSidebarCollapsed(true)}
                  className="hidden lg:flex p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
                  title="Collapse sidebar"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <PanelLeftClose className="w-4 h-4" />
                </motion.button>
                {/* Close button for mobile */}
                <motion.button
                  onClick={() => setSidebarOpen(false)}
                  className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            {/* Search - only for history tab (or when no sidebarConfig) */}
            {(!sidebarConfig || sidebarTab === 'history') && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search history..."
                  className="w-full pl-9 pr-3 py-2 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-lg text-sm text-neutral-900 dark:text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600"
                />
              </div>
            )}
          </div>

          {/* Sync status indicator - show when syncing or always in history tab */}
          {(!sidebarConfig || sidebarTab === 'history') && (
            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800/50">
              {renderSyncIndicator()}
            </div>
          )}

          {/* Content based on tab */}
          {(!sidebarConfig || sidebarTab === 'history') ? (
            <>
              {/* Sessions list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredSessions.length === 0 ? (
                  <div className="text-center text-neutral-500 py-8">
                    <MessageSquare className="w-8 h-8 mx-auto opacity-50 mb-2" />
                    <p className="text-sm">
                      {searchQuery ? 'No matching conversations' : 'No chat history yet'}
                    </p>
                  </div>
                ) : (
                  filteredSessions.map((session) => (
                    <motion.div
                      key={session.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`
                        p-3 rounded-xl cursor-pointer transition-colors group relative
                        ${currentSession?.id === session.id
                          ? 'bg-neutral-200 dark:bg-neutral-700/50 border border-neutral-300 dark:border-neutral-600'
                          : 'bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/30 hover:bg-neutral-200 dark:hover:bg-neutral-700/50'
                        }
                      `}
                      onClick={() => handleLoadSession(session.id)}
                    >
                      <div className="pr-8">
                        <p className="text-neutral-900 dark:text-white text-sm font-medium truncate">
                          {session.title}
                        </p>
                        <p className="text-neutral-500 text-xs truncate mt-1">
                          {session.preview || 'No preview'}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-neutral-400">
                          <Clock className="w-3 h-3" />
                          <span>{formatRelativeTime(session.updatedAt)}</span>
                          <span>·</span>
                          <span>{session.messageCount} messages</span>
                        </div>
                      </div>

                      {/* Delete button */}
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(session.id);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition-all"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Footer - clear all history */}
              {sessions.length > 0 && (
                <div className="p-3 border-t border-neutral-200 dark:border-neutral-800/50">
                  <button
                    onClick={() => setShowClearAllConfirm(true)}
                    className="w-full py-2 px-3 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear all history
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Custom sidebar content (Activity tab) - rendered by sidebarConfig */
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sidebarConfig.items.length === 0 ? (
                <div className="text-center text-neutral-500 py-8">
                  {sidebarConfig.emptyIcon || <Activity className="w-8 h-8 mx-auto opacity-50 mb-2" />}
                  <p className="text-sm">{sidebarConfig.emptyText}</p>
                </div>
              ) : (
                sidebarConfig.items.map((item) => (
                  <div key={item.id}>
                    {sidebarConfig.renderItem(item, () => sidebarConfig.onItemClick?.(item))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Delete confirmation modal */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
              onClick={() => setShowDeleteConfirm(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-sm w-full shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
                  Delete conversation?
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-6">
                  This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 py-2 px-4 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium border border-neutral-200 dark:border-neutral-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteSession(showDeleteConfirm)}
                    className="flex-1 py-2 px-4 rounded-lg bg-red-500 text-white font-medium"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clear all confirmation modal */}
        <AnimatePresence>
          {showClearAllConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
              onClick={() => setShowClearAllConfirm(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-sm w-full shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
                  Clear all history?
                </h3>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-6">
                  This will delete all {sessions.length} conversations. This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowClearAllConfirm(false)}
                    className="flex-1 py-2 px-4 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium border border-neutral-200 dark:border-neutral-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClearAllHistory}
                    className="flex-1 py-2 px-4 rounded-lg bg-red-500 text-white font-medium"
                  >
                    Clear all
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  };

  // Main chat content
  const renderChat = () => (
    <div className="grid grid-rows-[auto_1fr_auto] z-10 h-full min-h-0">
      <ChatHeader
        agent={agent}
        onToggleSidebar={() => setSidebarOpen(true)}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        showMenuButton={true}
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Messages area */}
      <div ref={messagesContainerRef} className="overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Success notification after deletion */}
        <AnimatePresence>
          {justDeleted && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-600 dark:text-green-400 text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Successfully deleted
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {extendedMessages.map((message) => {
            // Determine if this message is currently streaming
            const isLastMessage = message.id === extendedMessages[extendedMessages.length - 1]?.id;
            const messageIsStreaming = isTyping && isLastMessage;

            return (
              <ChatBubble
                key={message.id}
                role={message.role}
                content={message.content}
                agentName={agent.name}
                agentColor={agent.color}
                thinking={message.thinking}
                showCopy={true}
                isCopied={copiedId === message.id}
                onCopy={() => handleCopy(message.content, message.id)}
                isStreaming={messageIsStreaming}
                currentStatus={messageIsStreaming ? currentStatus : null}
              >
                {/* Custom card content */}
                {message.cardData && renderMessageCard && renderMessageCard(message.cardData, message)}

                {/* Additional message actions */}
                {renderMessageActions && renderMessageActions(message)}

                {/* Action button */}
                {message.showActionButton && message.cardData && actionConfig && (
                  <motion.button
                    onClick={() => handleAction(message.cardData!)}
                    className={`mt-2 w-full py-3 rounded-xl bg-linear-to-r ${agent.color} text-white font-medium`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {getActionLabel(message.cardData)}
                  </motion.button>
                )}
              </ChatBubble>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Bottom section - always at bottom */}
      <div className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm theme-transition">
        {/* Quick actions */}
        {agent.quickActions && (
          <QuickActions
            actions={agent.quickActions}
            onAction={handleQuickAction}
            disabled={isTyping}
          />
        )}

        <ChatInput
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSend={() => handleSend()}
          onKeyDown={handleKeyPress}
          placeholder={agent.placeholder || `Message ${agent.name}...`}
          disabled={useMockMode ? isMockTyping : false}
          isStreaming={!useMockMode && isStreaming}
          onStop={!useMockMode ? stopGeneration : undefined}
          agentColor={agent.color}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Layout with left sidebar for chat history */}
      <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden relative lg:grid lg:grid-cols-[auto_1fr] lg:shadow-xl dark:lg:shadow-2xl h-full min-h-0 theme-transition">
        <div className={`absolute -top-20 -right-20 w-96 h-96 ${bgGradient.from} rounded-full blur-3xl`} />
        <div className={`absolute -bottom-20 -left-20 w-96 h-96 ${bgGradient.to} rounded-full blur-3xl`} />
        {renderHistorySidebar()}
        {renderChat()}
      </div>

      {/* Additional custom content */}
      {additionalContent}
    </>
  );
}
