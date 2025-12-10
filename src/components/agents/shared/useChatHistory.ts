/**
 * useChatHistory - React hook for managing agent chat history
 *
 * Features:
 * - Auto-save messages to localStorage
 * - Session management (create, load, continue)
 * - Search through history
 * - Event-based updates
 * - Per-user history (bound to nametag)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatHistoryRepository, type ChatSession } from './ChatHistoryRepository';
import type { ChatMessage } from '../../../hooks/useAgentChat';

interface UseChatHistoryOptions {
  agentId: string;
  userId?: string; // nametag - each user has their own history
  enabled?: boolean;
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
}

export function useChatHistory({ agentId, userId, enabled = true }: UseChatHistoryOptions): UseChatHistoryReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const currentSessionRef = useRef<ChatSession | null>(null);
  const userIdRef = useRef<string | undefined>(userId);

  // Keep refs in sync
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

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
  };
}
