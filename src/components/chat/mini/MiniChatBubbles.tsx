import { useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { ChatRepository } from '../data/ChatRepository';
import { GroupChatRepository } from '../data/GroupChatRepository';
import type { ChatMessage } from '../data/models';
import type { GroupMessage } from '../data/groupModels';
import { useMiniChatStore, parseWindowId, createWindowId } from './miniChatStore';
import { MiniChatBubble } from './MiniChatBubble';
import { MiniGroupChatBubble } from './MiniGroupChatBubble';
import { MiniChatList } from './MiniChatList';
import { MiniChatWindow } from './MiniChatWindow';
import { MiniGroupChatWindow } from './MiniGroupChatWindow';

const MAX_VISIBLE_BUBBLES = 5;
const chatRepository = ChatRepository.getInstance();
const groupChatRepository = GroupChatRepository.getInstance();

export function MiniChatBubbles() {
  const queryClient = useQueryClient();
  const {
    openWindowIds,
    minimizedWindowIds,
    dismissedWindowIds,
    isListExpanded,
    toggleList,
    closeList,
    openWindow,
    openGroupWindow,
  } = useMiniChatStore();

  const { data: conversations = [] } = useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => chatRepository.getConversations(),
    staleTime: 5000,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['groupChat', 'groups'],
    queryFn: () => groupChatRepository.getGroups(),
    staleTime: 5000,
  });

  const { data: dmUnreadCount = 0 } = useQuery({
    queryKey: ['chat', 'unreadCount'],
    queryFn: () => chatRepository.getTotalUnreadCount(),
    staleTime: 5000,
  });

  const { data: groupUnreadCount = 0 } = useQuery({
    queryKey: ['groupChat', 'unreadCount'],
    queryFn: () => groupChatRepository.getTotalUnreadCount(),
    staleTime: 5000,
  });

  const totalUnreadCount = dmUnreadCount + groupUnreadCount;

  // Listen for real-time message updates
  useEffect(() => {
    const handleChatUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'unreadCount'] });
    };

    const handleDMReceived = (event: CustomEvent<ChatMessage>) => {
      const message = event.detail;
      // Invalidate conversations and unread count
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'unreadCount'] });
      // Invalidate messages for the specific conversation
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', message.conversationId] });
    };

    const handleGroupChatUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'groups'] });
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'unreadCount'] });
    };

    const handleGroupMessageReceived = (event: CustomEvent<GroupMessage>) => {
      const message = event.detail;
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'groups'] });
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'unreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'messages', message.groupId] });
    };

    window.addEventListener('chat-updated', handleChatUpdate);
    window.addEventListener('dm-received', handleDMReceived as EventListener);
    window.addEventListener('group-chat-updated', handleGroupChatUpdate);
    window.addEventListener('group-message-received', handleGroupMessageReceived as EventListener);

    return () => {
      window.removeEventListener('chat-updated', handleChatUpdate);
      window.removeEventListener('dm-received', handleDMReceived as EventListener);
      window.removeEventListener('group-chat-updated', handleGroupChatUpdate);
      window.removeEventListener('group-message-received', handleGroupMessageReceived as EventListener);
    };
  }, [queryClient]);

  // Parse open windows into DM and group windows
  const { dmWindows, groupWindows } = useMemo(() => {
    const dmWindows: { windowId: string; conversation: NonNullable<typeof conversations[0]> }[] = [];
    const groupWindows: { windowId: string; group: NonNullable<typeof groups[0]> }[] = [];

    for (const windowId of openWindowIds) {
      const parsed = parseWindowId(windowId);
      if (!parsed) continue;

      if (parsed.type === 'dm') {
        const conversation = conversations.find((c) => c.id === parsed.id);
        if (conversation) {
          dmWindows.push({ windowId, conversation });
        }
      } else if (parsed.type === 'group') {
        const group = groups.find((g) => g.id === parsed.id);
        if (group) {
          groupWindows.push({ windowId, group });
        }
      }
    }

    return { dmWindows, groupWindows };
  }, [conversations, groups, openWindowIds]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
      return b.lastMessageTime - a.lastMessageTime;
    });
  }, [conversations]);

  // Windows that are open and NOT minimized should show as chat windows
  const dmWindowsToRender = dmWindows.filter((w) => !minimizedWindowIds.includes(w.windowId));
  const groupWindowsToRender = groupWindows.filter((w) => !minimizedWindowIds.includes(w.windowId));

  // Single list of bubbles: conversations that should show as bubbles (not as windows)
  const visibleBubbles = useMemo(() => {
    const dismissedIds = new Set(dismissedWindowIds);
    // Windows that are open but NOT minimized - these show as windows, not bubbles
    const visibleWindowIds = new Set(
      openWindowIds.filter((id) => !minimizedWindowIds.includes(id))
    );

    // Show all conversations EXCEPT:
    // - dismissed ones (closed with ×)
    // - ones that have visible windows (open and not minimized)
    return sortedConversations
      .filter((c) => {
        const windowId = createWindowId('dm', c.id);
        return !dismissedIds.has(windowId) && !visibleWindowIds.has(windowId);
      })
      .slice(0, MAX_VISIBLE_BUBBLES);
  }, [sortedConversations, openWindowIds, minimizedWindowIds, dismissedWindowIds]);

  // Group bubbles: groups that have minimized windows
  const visibleGroupBubbles = useMemo(() => {
    return groups.filter((g) => {
      const windowId = createWindowId('group', g.id);
      // Show as bubble if: window is open AND minimized
      return openWindowIds.includes(windowId) && minimizedWindowIds.includes(windowId);
    });
  }, [groups, openWindowIds, minimizedWindowIds]);

  if (conversations.length === 0 && groups.length === 0) {
    return null;
  }

  return createPortal(
    <>
      {/* Hidden on mobile (< 768px) */}
      <div className="hidden md:flex fixed left-4 bottom-4 z-100000 flex-col-reverse items-start gap-3">
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleList}
          className="relative w-14 h-14 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 shadow-lg cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          <MessageCircle className="w-5 h-5" />

          {totalUnreadCount > 0 && !isListExpanded && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow-md">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
        </button>

        <AnimatePresence mode="popLayout">
          {!isListExpanded &&
            visibleGroupBubbles.map((group, index) => (
              <MiniGroupChatBubble
                key={`group-${group.id}`}
                group={group}
                onClick={() => openGroupWindow(group)}
                index={index}
              />
            ))}
          {!isListExpanded &&
            visibleBubbles.map((conversation, index) => (
              <MiniChatBubble
                key={conversation.id}
                conversation={conversation}
                onClick={() => openWindow(conversation)}
                index={visibleGroupBubbles.length + index}
              />
            ))}
        </AnimatePresence>

      </div>

      {/* Hidden on mobile (< 768px) */}
      <div className="hidden md:block">
        <AnimatePresence>
          {isListExpanded && <MiniChatList onClose={closeList} />}
        </AnimatePresence>

        <AnimatePresence>
          {dmWindowsToRender.map(({ windowId, conversation }, index) => (
            <MiniChatWindow
              key={windowId}
              conversation={conversation}
              index={index}
            />
          ))}
          {groupWindowsToRender.map(({ windowId, group }, index) => (
            <MiniGroupChatWindow
              key={windowId}
              group={group}
              index={dmWindowsToRender.length + index}
            />
          ))}
        </AnimatePresence>
      </div>
    </>,
    document.body
  );
}
