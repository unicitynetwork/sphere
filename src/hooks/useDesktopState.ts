import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAgentConfig } from '../config/activities';
import { STORAGE_KEYS } from '../config/storageKeys';

const DESKTOP_STATE_KEY = ['desktop', 'state'] as const;

export interface DesktopTab {
  id: string;
  appId: string;
  label: string;
  url?: string;
}

interface DesktopState {
  openTabs: DesktopTab[];
  activeTabId: string | null;
  previousActiveTabId?: string | null;
  walletOpen: boolean;
}

const defaultState: DesktopState = {
  openTabs: [],
  activeTabId: null,
  walletOpen: window.matchMedia('(min-width: 1024px)').matches,
};

function loadState(): DesktopState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DESKTOP_STATE);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as DesktopState;
    // Validate tabs against current agent configs — remove stale entries
    const validTabs = parsed.openTabs.filter(
      (tab) => tab.url || getAgentConfig(tab.appId),
    );
    const activeStillOpen = validTabs.some((t) => t.id === parsed.activeTabId);
    return {
      openTabs: validTabs,
      activeTabId: activeStillOpen ? parsed.activeTabId : null,
      walletOpen: defaultState.walletOpen,
    };
  } catch {
    return defaultState;
  }
}

function saveState(state: DesktopState) {
  // walletOpen is transient UI state (depends on screen size), don't persist it
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { walletOpen: _, ...persistable } = state;
  localStorage.setItem(STORAGE_KEYS.DESKTOP_STATE, JSON.stringify(persistable));
}

export function useDesktopState() {
  const queryClient = useQueryClient();

  const { data: state = defaultState } = useQuery({
    queryKey: DESKTOP_STATE_KEY,
    queryFn: loadState,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const update = useCallback(
    (updater: (prev: DesktopState) => DesktopState) => {
      queryClient.setQueryData<DesktopState>(DESKTOP_STATE_KEY, (prev) => {
        const next = updater(prev ?? defaultState);
        saveState(next);
        return next;
      });
    },
    [queryClient],
  );

  const openTab = useCallback(
    (appId: string, opts?: { url?: string; label?: string }) => {
      update((prev) => {
        // When opening a URL tab, check if same URL already open
        if (opts?.url) {
          const byUrl = prev.openTabs.find((t) => t.url === opts.url);
          if (byUrl) {
            return { ...prev, activeTabId: byUrl.id };
          }
          // Replace existing prompt tab (same appId, no URL) with the URL version
          const agent = getAgentConfig(appId);
          const tab: DesktopTab = {
            id: `custom-${Date.now()}`,
            appId,
            label: opts.label ?? agent?.name ?? appId,
            url: opts.url,
          };
          const filtered = prev.openTabs.filter(
            (t) => !(t.appId === appId && !t.url),
          );
          return {
            ...prev,
            openTabs: [...filtered, tab],
            activeTabId: tab.id,
          };
        }
        // Non-URL tab — reuse existing if already open
        const existing = prev.openTabs.find(
          (t) => t.appId === appId && !t.url,
        );
        if (existing) {
          return { ...prev, activeTabId: existing.id };
        }
        const agent = getAgentConfig(appId);
        const tab: DesktopTab = {
          id: appId,
          appId,
          label: opts?.label ?? agent?.name ?? appId,
        };
        return {
          ...prev,
          openTabs: [...prev.openTabs, tab],
          activeTabId: tab.id,
        };
      });
    },
    [update],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      update((prev) => {
        const idx = prev.openTabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;
        const next = prev.openTabs.filter((t) => t.id !== tabId);
        let nextActive = prev.activeTabId;
        if (prev.activeTabId === tabId) {
          // Activate the neighbor tab or show desktop
          const neighbor = next[Math.min(idx, next.length - 1)];
          nextActive = neighbor?.id ?? null;
        }
        return { ...prev, openTabs: next, activeTabId: nextActive };
      });
    },
    [update],
  );

  const activateTab = useCallback(
    (tabId: string) => {
      update((prev) => {
        if (prev.activeTabId === tabId) return prev;
        return { ...prev, activeTabId: tabId };
      });
    },
    [update],
  );

  const showDesktop = useCallback(() => {
    update((prev) => {
      const isMobile = !window.matchMedia('(min-width: 1024px)').matches;
      if (prev.activeTabId === null) {
        // Already on desktop — toggle back to the previous tab if it's still open
        const prevId = prev.previousActiveTabId;
        if (prevId && prev.openTabs.some((t) => t.id === prevId)) {
          return { ...prev, activeTabId: prevId, previousActiveTabId: null };
        }
        // Fallback: activate the last open tab
        const last = prev.openTabs[prev.openTabs.length - 1];
        if (last) {
          return { ...prev, activeTabId: last.id, previousActiveTabId: null };
        }
        return prev;
      }
      return {
        ...prev,
        activeTabId: null,
        previousActiveTabId: prev.activeTabId,
        // On mobile, close wallet when showing desktop
        walletOpen: isMobile ? false : prev.walletOpen,
      };
    });
  }, [update]);

  const toggleWallet = useCallback(() => {
    update((prev) => ({ ...prev, walletOpen: !prev.walletOpen }));
  }, [update]);

  const setWalletOpen = useCallback(
    (open: boolean) => {
      update((prev) => (prev.walletOpen === open ? prev : { ...prev, walletOpen: open }));
    },
    [update],
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      update((prev) => {
        const tabs = [...prev.openTabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        return { ...prev, openTabs: tabs };
      });
    },
    [update],
  );

  return {
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    activeTab: state.openTabs.find((t) => t.id === state.activeTabId) ?? null,
    walletOpen: state.walletOpen,
    openTab,
    closeTab,
    activateTab,
    showDesktop,
    reorderTabs,
    toggleWallet,
    setWalletOpen,
  };
}

/** Lightweight subscription — only re-renders when activeTabId changes */
export function useActiveTabId(): string | null {
  const { data } = useQuery({
    queryKey: DESKTOP_STATE_KEY,
    queryFn: loadState,
    staleTime: Infinity,
    gcTime: Infinity,
    select: (s) => s.activeTabId,
  });
  return data ?? null;
}
