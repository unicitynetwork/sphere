import { useSyncExternalStore, useCallback } from 'react';
import type { ChatConversation } from '../data/models';
import type { Group } from '../data/groupModels';

const STORAGE_KEY = 'sphere_mini_chat';
const MAX_OPEN_WINDOWS = 3;

// Window ID format: "dm:{conversationId}" or "group:{groupId}"
export type WindowType = 'dm' | 'group';

export function createWindowId(type: WindowType, id: string): string {
  return `${type}:${id}`;
}

export function parseWindowId(windowId: string): { type: WindowType; id: string } | null {
  const colonIndex = windowId.indexOf(':');
  if (colonIndex === -1) {
    // Legacy format - assume DM
    return { type: 'dm', id: windowId };
  }
  const type = windowId.slice(0, colonIndex) as WindowType;
  const id = windowId.slice(colonIndex + 1);
  if (type !== 'dm' && type !== 'group') {
    return null;
  }
  return { type, id };
}

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

  // Open a DM chat window (or restore if minimized)
  openWindow: (conversation: ChatConversation) => {
    const windowId = createWindowId('dm', conversation.id);
    miniChatStore.openWindowById(windowId);
  },

  // Open a group chat window (or restore if minimized)
  openGroupWindow: (group: Group) => {
    const windowId = createWindowId('group', group.id);
    miniChatStore.openWindowById(windowId);
  },

  // Internal: open window by full ID
  openWindowById: (windowId: string) => {
    const isAlreadyOpen = state.openWindowIds.includes(windowId);
    const isMinimized = state.minimizedWindowIds.includes(windowId);

    if (isAlreadyOpen && !isMinimized) {
      return; // Already open and visible
    }

    const nextOpenIds = [...state.openWindowIds];
    const nextMinimizedIds = state.minimizedWindowIds.filter((id) => id !== windowId);
    // Remove from dismissed when opening
    const nextDismissedIds = state.dismissedWindowIds.filter((id) => id !== windowId);

    if (!isAlreadyOpen) {
      // Add to open windows
      if (nextOpenIds.length >= MAX_OPEN_WINDOWS) {
        nextOpenIds.shift();
      }
      nextOpenIds.push(windowId);
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

  const openGroupWindow = useCallback((group: Group) => {
    miniChatStore.openGroupWindow(group);
  }, []);

  const closeWindow = useCallback((windowId: string) => {
    miniChatStore.closeWindow(windowId);
  }, []);

  const minimizeWindow = useCallback((windowId: string) => {
    miniChatStore.minimizeWindow(windowId);
  }, []);

  const toggleList = useCallback(() => {
    miniChatStore.toggleList();
  }, []);

  const closeList = useCallback(() => {
    miniChatStore.closeList();
  }, []);

  // Check if a window is minimized
  const isMinimized = useCallback(
    (windowId: string) => storeState.minimizedWindowIds.includes(windowId),
    [storeState.minimizedWindowIds]
  );

  return {
    ...storeState,
    openWindow,
    openGroupWindow,
    closeWindow,
    minimizeWindow,
    toggleList,
    closeList,
    isMinimized,
  };
}
