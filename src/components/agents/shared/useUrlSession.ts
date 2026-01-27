/**
 * useUrlSession - TanStack Query hook for URL-based session management
 *
 * Uses URL as single source of truth for active session.
 * Both mobile and desktop instances will automatically sync via URL changes.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chatHistoryRepository, type ChatSession } from './ChatHistoryRepository';
import type { ChatMessage } from '../../../hooks/useAgentChat';

// Query keys
export const sessionKeys = {
  all: ['agent-session'] as const,
  session: (sessionId: string) => [...sessionKeys.all, sessionId] as const,
};

interface UseUrlSessionOptions {
  sessions: ChatSession[];
}

interface SessionData {
  session: ChatSession;
  messages: ChatMessage[];
}

export function useUrlSession({
  sessions,
}: UseUrlSessionOptions) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionId = searchParams.get('session');

  // Check if session exists in the list
  const sessionExists = useMemo(() => {
    if (!urlSessionId) return false;
    return sessions.some(s => s.id === urlSessionId);
  }, [urlSessionId, sessions]);

  // Query: Load session data from repository based on URL
  const {
    data: sessionData,
    isLoading,
  } = useQuery<SessionData | null>({
    queryKey: sessionKeys.session(urlSessionId || ''),
    queryFn: () => {
      if (!urlSessionId) return null;

      const session = chatHistoryRepository.getSessionWithMessages(urlSessionId);
      if (!session) return null;

      return {
        session,
        messages: session.messages,
      };
    },
    enabled: !!urlSessionId && sessionExists,
    staleTime: Infinity, // Session data doesn't go stale - only changes via mutations
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });

  // Navigate to a session (updates URL, which triggers query)
  const navigateToSession = useCallback((sessionId: string) => {
    // Optimistically update the cache with session data
    const session = chatHistoryRepository.getSessionWithMessages(sessionId);
    if (session) {
      queryClient.setQueryData(sessionKeys.session(sessionId), {
        session,
        messages: session.messages,
      });
    }

    // Update URL - this is the single source of truth
    setSearchParams({ session: sessionId }, { replace: true });
  }, [queryClient, setSearchParams]);

  // Clear session (start new chat)
  const clearSession = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Invalidate session cache (call after saving messages)
  const invalidateSession = useCallback((sessionId: string) => {
    queryClient.invalidateQueries({
      queryKey: sessionKeys.session(sessionId),
    });
  }, [queryClient]);

  // Update cache directly (for optimistic updates when saving)
  const updateSessionCache = useCallback((sessionId: string, messages: ChatMessage[]) => {
    queryClient.setQueryData(sessionKeys.session(sessionId), (old: SessionData | null | undefined) => {
      if (!old) return old;
      return {
        ...old,
        messages,
        session: {
          ...old.session,
          messageCount: messages.length,
          updatedAt: Date.now(),
        },
      };
    });
  }, [queryClient]);

  return {
    // Current session from URL
    urlSessionId,
    currentSession: sessionData?.session ?? null,
    currentMessages: sessionData?.messages ?? [],
    isLoading,

    // Navigation
    navigateToSession,
    clearSession,

    // Cache management
    invalidateSession,
    updateSessionCache,
  };
}
