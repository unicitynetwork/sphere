import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { Plus, Eye, X, Wallet, CheckCircle, PanelLeftClose } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../../config/activities';
import { useAgentChat } from '../../../hooks/useAgentChat';
import { useWallet } from '../../wallet/L3/hooks/useWallet';
import { v4 as uuidv4 } from 'uuid';
import { ChatContainer, ChatHeader, ChatBubble, ChatInput, TypingIndicator, QuickActions } from './index';

// Generic sidebar item
export interface SidebarItem {
  id: string;
  title: string;
  image?: string;
  timestamp: number;
  status: string;
  amount?: number;
  [key: string]: unknown;
}

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

// Configuration for the sidebar (optional)
interface SidebarConfig<TItem extends SidebarItem> {
  title: string;
  emptyText: string;
  emptyIcon: ReactNode;
  items: TItem[];
  setItems: React.Dispatch<React.SetStateAction<TItem[]>>;
  renderItem: (item: TItem) => ReactNode;
  storageKey: string;
}

// Configuration for action button in messages
interface ActionConfig<TCardData> {
  label: string | ((data: TCardData) => string);
  onAction: (data: TCardData) => void;
}

// Configuration for transaction modal
interface TransactionConfig<TCardData> {
  confirmTitle: string;
  processingText: string;
  successText: string;
  renderConfirmContent?: (data: TCardData, onConfirm: () => void) => ReactNode;
  onConfirm: (data: TCardData) => Promise<SidebarItem>;
}

// Configuration for details modal
interface DetailsConfig<TItem extends SidebarItem> {
  title: string;
  renderContent: (item: TItem) => ReactNode;
  renderActions?: (item: TItem, onClose: () => void) => ReactNode;
}

interface AgentChatProps<TCardData, TItem extends SidebarItem> {
  agent: AgentConfig;

  // Sidebar (optional - if not provided, renders without sidebar)
  sidebarConfig?: SidebarConfig<TItem>;

  // Mock response handler (for sidebar-based agents that don't use real backend)
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

  // Transaction modal (optional)
  transactionConfig?: TransactionConfig<TCardData>;

  // Details modal (optional)
  detailsConfig?: DetailsConfig<TItem>;

  // Additional message actions
  renderMessageActions?: (message: AgentMessage<TCardData>) => ReactNode;

  // Additional modals/content
  additionalContent?: ReactNode;

  // Background gradient colors
  bgGradient?: { from: string; to: string };
}

export function AgentChat<TCardData, TItem extends SidebarItem>({
  agent,
  sidebarConfig,
  getMockResponse,
  processMessage,
  renderMessageCard,
  actionConfig,
  transactionConfig,
  detailsConfig,
  renderMessageActions,
  additionalContent,
  bgGradient = { from: 'bg-indigo-500/5', to: 'bg-cyan-500/5' },
}: AgentChatProps<TCardData, TItem>) {
  const [input, setInput] = useState('');
  const [extendedMessages, setExtendedMessages] = useState<AgentMessage<TCardData>[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMockTyping, setIsMockTyping] = useState(false);

  // Transaction modal state
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [pendingCardData, setPendingCardData] = useState<TCardData | null>(null);
  const [transactionStep, setTransactionStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

  // Details modal state
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasGreeted = useRef(false);
  const currentAgentId = useRef(agent.id);

  // Get nametag from wallet for user identification
  const { nametag } = useWallet();

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

  // Determine if we're in mock mode based on VITE_AGENT_MODE env variable
  const useMockMode = agentMode === 'mock';
  const isTyping = useMockMode ? isMockTyping : isStreaming;

  // Copy message content
  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Get typing indicator color based on agent
  const getIndicatorColor = () => {
    if (agent.color.includes('indigo')) return 'bg-indigo-500';
    if (agent.color.includes('emerald') || agent.color.includes('teal')) return 'bg-emerald-500';
    if (agent.color.includes('orange') || agent.color.includes('red')) return 'bg-orange-500';
    if (agent.color.includes('purple') || agent.color.includes('pink')) return 'bg-purple-500';
    return 'bg-indigo-500';
  };

  // Reset state when agent changes
  useEffect(() => {
    if (currentAgentId.current !== agent.id) {
      currentAgentId.current = agent.id;
      setExtendedMessages([]);
      setInput('');
      hasGreeted.current = false;
      if (!useMockMode) {
        setMessages([]);
      }
    }
  }, [agent.id, setMessages, useMockMode]);

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

  // Save sidebar items to localStorage
  useEffect(() => {
    if (sidebarConfig) {
      localStorage.setItem(sidebarConfig.storageKey, JSON.stringify(sidebarConfig.items));
    }
  }, [sidebarConfig?.items, sidebarConfig?.storageKey]);

  // Greeting message
  useEffect(() => {
    if (!hasGreeted.current && extendedMessages.length === 0 && agent.greetingMessage) {
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
  }, [agent.greetingMessage, extendedMessages.length, setMessages, useMockMode]);

  const scrollToBottom = useCallback((instant = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [extendedMessages, isTyping, scrollToBottom]);

  // Auto-focus input when typing ends
  useEffect(() => {
    if (!isTyping) {
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

    // Focus input
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 0);

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
    if (transactionConfig) {
      setPendingCardData(cardData);
      setTransactionStep('confirm');
      setShowTransactionModal(true);
    } else if (actionConfig) {
      actionConfig.onAction(cardData);
    }
  };

  const handleConfirmTransaction = async () => {
    if (!pendingCardData || !transactionConfig || !sidebarConfig) return;

    setTransactionStep('processing');
    const newItem = await transactionConfig.onConfirm(pendingCardData);
    sidebarConfig.setItems(prev => [newItem as TItem, ...prev]);
    setTransactionStep('success');
  };

  const handleCloseSuccessModal = () => {
    setShowTransactionModal(false);
    setPendingCardData(null);
  };

  const handleNewChat = () => {
    setExtendedMessages([]);
    if (!useMockMode) {
      setMessages([]);
    }
    hasGreeted.current = false;
  };

  const handleItemClick = (item: TItem) => {
    if (detailsConfig) {
      setSelectedItem(item);
      setShowDetailsModal(true);
    }
  };

  const getActionLabel = (cardData: TCardData): string => {
    if (!actionConfig) return '';
    return typeof actionConfig.label === 'function'
      ? actionConfig.label(cardData)
      : actionConfig.label;
  };

  // Render sidebar if config provided
  const renderSidebar = () => {
    if (!sidebarConfig) return null;

    return (
      <>
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <div className={`
          w-56 border-r border-neutral-800/50 flex flex-col z-50 overflow-hidden
          fixed lg:relative inset-y-0 left-0
          transform transition-all duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${sidebarCollapsed ? 'lg:w-0 lg:border-0 lg:min-w-0' : 'lg:w-56'}
          bg-neutral-900/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none
        `}>
          <div className="p-4 border-b border-neutral-800/50">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">{sidebarConfig.title}</h3>
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleNewChat}
                  className={`p-2 rounded-lg bg-linear-to-br ${agent.color} text-white`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Plus className="w-4 h-4" />
                </motion.button>
                {/* Collapse button for desktop */}
                <motion.button
                  onClick={() => setSidebarCollapsed(true)}
                  className="hidden lg:flex p-2 rounded-lg bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50 transition-colors"
                  title="Collapse sidebar"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <PanelLeftClose className="w-4 h-4" />
                </motion.button>
                {/* Close button for mobile */}
                <motion.button
                  onClick={() => setSidebarOpen(false)}
                  className="lg:hidden p-2 rounded-lg bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {sidebarConfig.items.length === 0 ? (
              <div className="text-center text-neutral-500 py-8">
                {sidebarConfig.emptyIcon}
                <p className="text-sm mt-2">{sidebarConfig.emptyText}</p>
              </div>
            ) : (
              sidebarConfig.items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => handleItemClick(item)}
                  className="p-3 rounded-xl bg-neutral-800/50 border border-neutral-700/30 cursor-pointer hover:bg-neutral-700/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    {sidebarConfig.renderItem(item)}
                    <Eye className="w-4 h-4 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
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
        showMenuButton={!!sidebarConfig}
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Messages area */}
      <div ref={messagesContainerRef} className="overflow-y-auto p-4 space-y-4 min-h-0">
        <AnimatePresence initial={false}>
          {extendedMessages.map((message) => (
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
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {isTyping && (() => {
          if (useMockMode) {
            return <TypingIndicator color={getIndicatorColor()} />;
          }
          // For streaming mode, only show if last message is empty assistant
          const lastMsg = extendedMessages[extendedMessages.length - 1];
          const showIndicator = lastMsg?.role === 'assistant' && !lastMsg.content;
          return showIndicator ? (
            <TypingIndicator color={getIndicatorColor()} status={currentStatus} />
          ) : null;
        })()}
      </div>

      {/* Bottom section - always at bottom */}
      <div className="bg-neutral-900/95 backdrop-blur-sm">
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
      {sidebarConfig ? (
        // With sidebar layout - use grid for proper height inheritance
        <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden grid grid-cols-[auto_1fr] relative shadow-2xl h-full min-h-0">
          <div className={`absolute -top-20 -right-20 w-96 h-96 ${bgGradient.from} rounded-full blur-3xl`} />
          <div className={`absolute -bottom-20 -left-20 w-96 h-96 ${bgGradient.to} rounded-full blur-3xl`} />
          {renderSidebar()}
          {renderChat()}
        </div>
      ) : (
        // Without sidebar layout
        <ChatContainer bgGradient={bgGradient}>
          {renderChat()}
        </ChatContainer>
      )}

      {/* Transaction Modal */}
      <AnimatePresence>
        {showTransactionModal && pendingCardData && transactionConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => transactionStep === 'confirm' && setShowTransactionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              {transactionStep === 'confirm' && (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-white">{transactionConfig.confirmTitle}</h3>
                    <button onClick={() => setShowTransactionModal(false)} className="text-neutral-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {transactionConfig.renderConfirmContent
                    ? transactionConfig.renderConfirmContent(pendingCardData, handleConfirmTransaction)
                    : (
                      <motion.button
                        onClick={handleConfirmTransaction}
                        className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Wallet className="w-5 h-5" />
                        Confirm & Pay
                      </motion.button>
                    )
                  }
                </>
              )}

              {transactionStep === 'processing' && (
                <div className="py-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Wallet className="w-8 h-8 text-orange-500" />
                    </motion.div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Processing...</h3>
                  <p className="text-neutral-400">{transactionConfig.processingText}</p>
                </div>
              )}

              {transactionStep === 'success' && (
                <div className="py-8 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center"
                  >
                    <CheckCircle className="w-8 h-8 text-white" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-white mb-2">Success!</h3>
                  <p className="text-neutral-400 mb-6">{transactionConfig.successText}</p>

                  <motion.button
                    onClick={handleCloseSuccessModal}
                    className="w-full py-3 rounded-xl bg-neutral-800 text-white font-medium border border-neutral-700"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Continue
                  </motion.button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Details Modal */}
      <AnimatePresence>
        {showDetailsModal && selectedItem && detailsConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowDetailsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">{detailsConfig.title}</h3>
                <button onClick={() => setShowDetailsModal(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {detailsConfig.renderContent(selectedItem)}

              <div className="space-y-3 mt-4">
                {detailsConfig.renderActions && detailsConfig.renderActions(selectedItem, () => setShowDetailsModal(false))}
                <motion.button
                  onClick={() => setShowDetailsModal(false)}
                  className="w-full py-3 rounded-xl bg-neutral-800 text-white font-medium border border-neutral-700"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Close
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Additional custom content */}
      {additionalContent}
    </>
  );
}
