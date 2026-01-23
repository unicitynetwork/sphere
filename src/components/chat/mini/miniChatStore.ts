import { useSyncExternalStore, useCallback } from 'react';
import type { ChatConversation } from '../data/models';

const STORAGE_KEY = 'sphere_mini_chat';
const MAX_OPEN_WINDOWS = 3;

interface MiniChatState {
  openWindowIds: string[];
  minimizedWindowIds: string[];
  dismissedWindowIds: string[]; // Windows closed with × - hidden from bubbles
  isListExpanded: boolean;
}

interface StoredState {
  openWindowIds: string[];
  minimizedWindowIds: string[];
  dismissedWindowIds: string[];
}

function loadFromStorage(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const openWindowIds = parsed.openWindowIds || [];
      const openSet = new Set(openWindowIds);
      // Validate: minimizedWindowIds must be subset of openWindowIds
      const minimizedWindowIds = (parsed.minimizedWindowIds || []).filter(
        (id: string) => openSet.has(id)
      );
      return {
        openWindowIds,
        minimizedWindowIds,
        dismissedWindowIds: parsed.dismissedWindowIds || [],
      };
    }
  } catch {
    // ignore
  }
  return { openWindowIds: [], minimizedWindowIds: [], dismissedWindowIds: [] };
}

function saveToStorage(state: MiniChatState) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      openWindowIds: state.openWindowIds,
      minimizedWindowIds: state.minimizedWindowIds,
      dismissedWindowIds: state.dismissedWindowIds,
    })
  );
}

const initial = loadFromStorage();
let state: MiniChatState = {
  openWindowIds: initial.openWindowIds,
  minimizedWindowIds: initial.minimizedWindowIds,
  dismissedWindowIds: initial.dismissedWindowIds,
  isListExpanded: false,
};

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export const miniChatStore = {
  getState: () => state,

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // Open a chat window (or restore if minimized)
  openWindow: (conversation: ChatConversation) => {
    const isAlreadyOpen = state.openWindowIds.includes(conversation.id);
    const isMinimized = state.minimizedWindowIds.includes(conversation.id);

    if (isAlreadyOpen && !isMinimized) {
      return; // Already open and visible
    }

    const nextOpenIds = [...state.openWindowIds];
    const nextMinimizedIds = state.minimizedWindowIds.filter((id) => id !== conversation.id);
    // Remove from dismissed when opening
    const nextDismissedIds = state.dismissedWindowIds.filter((id) => id !== conversation.id);

    if (!isAlreadyOpen) {
      // Add to open windows
      if (nextOpenIds.length >= MAX_OPEN_WINDOWS) {
        nextOpenIds.shift();
      }
      nextOpenIds.push(conversation.id);
    }

    state = {
      ...state,
      openWindowIds: nextOpenIds,
      minimizedWindowIds: nextMinimizedIds,
      dismissedWindowIds: nextDismissedIds,
      isListExpanded: false,
    };
    saveToStorage(state);
    emitChange();
  },

  // Close window completely (X button) - also hides bubble
  closeWindow: (conversationId: string) => {
    state = {
      ...state,
      openWindowIds: state.openWindowIds.filter((id) => id !== conversationId),
      minimizedWindowIds: state.minimizedWindowIds.filter((id) => id !== conversationId),
      dismissedWindowIds: state.dismissedWindowIds.includes(conversationId)
        ? state.dismissedWindowIds
        : [...state.dismissedWindowIds, conversationId],
    };
    saveToStorage(state);
    emitChange();
  },

  // Minimize window (_ button) - hides window but keeps bubble
  minimizeWindow: (conversationId: string) => {
    if (!state.openWindowIds.includes(conversationId)) {
      return;
    }

    const isMinimized = state.minimizedWindowIds.includes(conversationId);

    if (isMinimized) {
      // Restore from minimized
      state = {
        ...state,
        minimizedWindowIds: state.minimizedWindowIds.filter((id) => id !== conversationId),
      };
    } else {
      // Minimize
      state = {
        ...state,
        minimizedWindowIds: [...state.minimizedWindowIds, conversationId],
      };
    }
    saveToStorage(state);
    emitChange();
  },

  toggleList: () => {
    const willOpen = !state.isListExpanded;

    // When opening list, minimize all open windows
    if (willOpen && state.openWindowIds.length > 0) {
      state = {
        ...state,
        isListExpanded: true,
        minimizedWindowIds: [...state.openWindowIds],
      };
      saveToStorage(state);
    } else {
      // Simple toggle
      state = { ...state, isListExpanded: willOpen };
    }
    emitChange();
  },

  closeList: () => {
    state = { ...state, isListExpanded: false };
    emitChange();
  },
};

export function useMiniChatStore() {
  const storeState = useSyncExternalStore(miniChatStore.subscribe, miniChatStore.getState);

  const openWindow = useCallback((conversation: ChatConversation) => {
    miniChatStore.openWindow(conversation);
  }, []);

  const closeWindow = useCallback((conversationId: string) => {
    miniChatStore.closeWindow(conversationId);
  }, []);

  const minimizeWindow = useCallback((conversationId: string) => {
    miniChatStore.minimizeWindow(conversationId);
  }, []);

  const toggleList = useCallback(() => {
    miniChatStore.toggleList();
  }, []);

  const closeList = useCallback(() => {
    miniChatStore.closeList();
  }, []);

  // Check if a window is minimized
  const isMinimized = useCallback(
    (conversationId: string) => storeState.minimizedWindowIds.includes(conversationId),
    [storeState.minimizedWindowIds]
  );

  return {
    ...storeState,
    openWindow,
    closeWindow,
    minimizeWindow,
    toggleList,
    closeList,
    isMinimized,
  };
}
