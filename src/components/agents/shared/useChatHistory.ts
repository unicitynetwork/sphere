/**
 * useChatHistory - React hook for managing agent chat history
 *
 * Features:
 * - Auto-save messages to localStorage
 * - Session management (create, load, continue)
 * - Search through history
 * - Event-based updates
 * - Per-user history (bound to nametag)
 * - IPFS sync for cross-device synchronization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatHistoryRepository, type ChatSession } from './ChatHistoryRepository';
import type { ChatMessage } from '../../../hooks/useAgentChat';
import type { SyncResult } from './ChatHistoryIpfsService';

interface UseChatHistoryOptions {
  agentId: string;
  userId?: string; // nametag - each user has their own history
  seedPhrase?: string; // for IPFS sync - user's seed phrase
  enabled?: boolean;
  enableIpfsSync?: boolean; // enable IPFS synchronization
}

interface UseChatHistoryReturn {
  // Session management
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  createNewSession: () => ChatSession | null;
  loadSession: (sessionId: string) => ChatMessage[];
  deleteSession: (sessionId: string) => void;
  clearAllHistory: () => void;
  resetCurrentSession: () => void;

  // Message management
  saveCurrentMessages: (messages: ChatMessage[]) => void;

  // Search
  searchSessions: (query: string) => ChatSession[];

  // State
  isLoading: boolean;

  // IPFS sync
  ipfsSyncEnabled: boolean;
  isIpfsSyncing: boolean;
  lastIpfsSync: SyncResult | null;
  ipfsIpnsName: string | null;
  forceIpfsSync: () => Promise<void>;
}

export function useChatHistory({
  agentId,
  userId,
  seedPhrase,
  enabled = true,
  enableIpfsSync = false,
}: UseChatHistoryOptions): UseChatHistoryReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ipfsSyncEnabled, setIpfsSyncEnabled] = useState(false);
  const [isIpfsSyncing, setIsIpfsSyncing] = useState(false);
  const [lastIpfsSync, setLastIpfsSync] = useState<SyncResult | null>(null);
  const [ipfsIpnsName, setIpfsIpnsName] = useState<string | null>(null);

  const currentSessionRef = useRef<ChatSession | null>(null);
  const userIdRef = useRef<string | undefined>(userId);
  const ipfsInitializedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Initialize IPFS sync
  useEffect(() => {
    if (!enabled || !enableIpfsSync || !userId || !seedPhrase) {
      return;
    }

    if (ipfsInitializedRef.current) {
      return; // Already initialized
    }

    const initIpfs = async () => {
      try {
        console.log('[useChatHistory] Initializing IPFS sync...');
        const success = await chatHistoryRepository.initializeIpfsSync(seedPhrase, userId);

        if (success) {
          ipfsInitializedRef.current = true;
          setIpfsSyncEnabled(true);

          const status = chatHistoryRepository.getIpfsStatus();
          setIpfsIpnsName(status.ipnsName);

          // Sync with IPFS on initialization (this will restore remote data
          // or upload local data if no remote exists)
          setIsIpfsSyncing(true);
          const syncResult = await chatHistoryRepository.syncWithIpfs();

          // Reload sessions after sync
          const agentSessions = chatHistoryRepository.getSessionsForAgent(agentId, userId);
          setSessions(agentSessions);

          if (syncResult) {
            setLastIpfsSync(syncResult);
          }
          setIsIpfsSyncing(false);
          console.log('[useChatHistory] IPFS sync initialized successfully');
        }
      } catch (error) {
        console.error('[useChatHistory] Failed to initialize IPFS sync:', error);
        setIsIpfsSyncing(false);
      }
    };

    initIpfs();
  }, [enabled, enableIpfsSync, userId, seedPhrase, agentId]);

  // Listen for IPFS sync events
  useEffect(() => {
    if (!enableIpfsSync) return;

    const handleSyncEvent = (e: CustomEvent) => {
      const result = e.detail as SyncResult;
      setLastIpfsSync(result);
      setIsIpfsSyncing(false);
    };

    window.addEventListener('chat-history-ipfs-sync', handleSyncEvent as EventListener);
    return () => {
      window.removeEventListener('chat-history-ipfs-sync', handleSyncEvent as EventListener);
    };
  }, [enableIpfsSync]);

  // Load sessions on mount and when userId changes
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    const loadSessions = () => {
      const agentSessions = chatHistoryRepository.getSessionsForAgent(agentId, userId);
      setSessions(agentSessions);
      setIsLoading(false);
    };

    // Reset current session when user changes
    setCurrentSession(null);
    loadSessions();

    // Listen for updates from other tabs/components
    const handleUpdate = () => {
      loadSessions();
    };

    window.addEventListener('agent-chat-history-updated', handleUpdate);
    return () => {
      window.removeEventListener('agent-chat-history-updated', handleUpdate);
    };
  }, [agentId, userId, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't disable IPFS sync on unmount as service is singleton
      // chatHistoryRepository.disableIpfsSync();
    };
  }, []);

  // Create a new session
  const createNewSession = useCallback((): ChatSession | null => {
    if (!userIdRef.current) return null;
    const session = chatHistoryRepository.createSession(agentId, userIdRef.current);
    setCurrentSession(session);
    setSessions(prev => [session, ...prev]);
    return session;
  }, [agentId]);

  // Load an existing session
  const loadSession = useCallback((sessionId: string): ChatMessage[] => {
    const sessionData = chatHistoryRepository.getSessionWithMessages(sessionId);
    if (sessionData) {
      setCurrentSession(sessionData);
      return sessionData.messages;
    }
    return [];
  }, []);

  // Delete a session
  const deleteSession = useCallback((sessionId: string) => {
    chatHistoryRepository.deleteSession(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));

    // If deleting current session, clear it
    if (currentSessionRef.current?.id === sessionId) {
      setCurrentSession(null);
    }
  }, []);

  // Clear all history for this agent and user
  const clearAllHistory = useCallback(() => {
    chatHistoryRepository.deleteAllSessionsForAgent(agentId, userIdRef.current);
    setSessions([]);
    setCurrentSession(null);
  }, [agentId]);

  // Reset current session (for starting new chat)
  const resetCurrentSession = useCallback(() => {
    setCurrentSession(null);
  }, []);

  // Save messages for current session
  const saveCurrentMessages = useCallback((messages: ChatMessage[]) => {
    if (!enabled || !userIdRef.current) return;

    // Filter out greeting messages and empty messages
    const validMessages = messages.filter(m =>
      m.id !== 'greeting' && m.content.trim()
    );

    if (validMessages.length === 0) return;

    let session = currentSessionRef.current;

    // Create session if none exists
    if (!session) {
      const firstUserMessage = validMessages.find(m => m.role === 'user');
      session = chatHistoryRepository.createSession(agentId, userIdRef.current, firstUserMessage);
      setCurrentSession(session);
      setSessions(prev => {
        // Avoid duplicates
        if (prev.some(s => s.id === session!.id)) return prev;
        return [session!, ...prev];
      });
    }

    // Save all messages
    chatHistoryRepository.saveMessages(session.id, validMessages);

    // Update local session state
    setCurrentSession(prev => prev ? {
      ...prev,
      messageCount: validMessages.length,
      updatedAt: Date.now(),
    } : null);
  }, [agentId, enabled]);

  // Search sessions
  const searchSessions = useCallback((query: string): ChatSession[] => {
    return chatHistoryRepository.searchSessions(query, agentId, userIdRef.current);
  }, [agentId]);

  // Force IPFS sync
  const forceIpfsSync = useCallback(async () => {
    if (!ipfsSyncEnabled) return;

    setIsIpfsSyncing(true);
    try {
      const result = await chatHistoryRepository.forceIpfsSync();
      if (result) {
        setLastIpfsSync(result);
        // Reload sessions after sync
        const agentSessions = chatHistoryRepository.getSessionsForAgent(agentId, userIdRef.current);
        setSessions(agentSessions);
      }
    } catch (error) {
      console.error('[useChatHistory] Force IPFS sync failed:', error);
    } finally {
      setIsIpfsSyncing(false);
    }
  }, [ipfsSyncEnabled, agentId]);

  return {
    sessions,
    currentSession,
    createNewSession,
    loadSession,
    deleteSession,
    clearAllHistory,
    resetCurrentSession,
    saveCurrentMessages,
    searchSessions,
    isLoading,
    // IPFS sync
    ipfsSyncEnabled,
    isIpfsSyncing,
    lastIpfsSync,
    ipfsIpnsName,
    forceIpfsSync,
  };
}
