import { useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../../sdk/hooks/core/useIdentity';
import { type Conversation, buildConversations, CHAT_KEYS } from '../data/chatTypes';
import { useMiniChatStore } from './miniChatStore';
import { MiniChatBubble } from './MiniChatBubble';
import { MiniChatList } from './MiniChatList';
import { MiniChatWindow } from './MiniChatWindow';

const MAX_VISIBLE_BUBBLES = 5;

function buildAddressId(directAddress: string): string {
  let hash = directAddress;
  if (hash.startsWith('DIRECT://')) hash = hash.slice(9);
  else if (hash.startsWith('DIRECT:')) hash = hash.slice(7);
  const first = hash.slice(0, 6).toLowerCase();
  const last = hash.slice(-6).toLowerCase();
  return `DIRECT_${first}_${last}`;
}

export function MiniChatBubbles() {
  const queryClient = useQueryClient();
  const { sphere } = useSphereContext();
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';

  const {
    openWindowIds,
    minimizedWindowIds,
    dismissedWindowIds,
    isListExpanded,
    toggleList,
    closeList,
    openWindow,
  } = useMiniChatStore();

  const { data: conversations = [] } = useQuery({
    queryKey: CHAT_KEYS.conversations(addressId),
    queryFn: () => {
      if (!sphere) return [];
      const sdkConvs = sphere.communications.getConversations();
      return buildConversations(sdkConvs, sphere.identity!.chainPubkey);
    },
    enabled: !!sphere,
    staleTime: 5000,
  });

  const { data: totalUnreadCount = 0 } = useQuery({
    queryKey: CHAT_KEYS.unreadCount(addressId),
    queryFn: () => sphere?.communications.getUnreadCount() ?? 0,
    enabled: !!sphere,
    staleTime: 5000,
  });

  // Listen for real-time message updates
  useEffect(() => {
    const handleDMReceived = () => {
      queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
    };

    window.addEventListener('dm-received', handleDMReceived as EventListener);

    return () => {
      window.removeEventListener('dm-received', handleDMReceived as EventListener);
    };
  }, [queryClient]);

  // Preserve window order based on when they were opened (openWindowIds order)
  const openWindows = useMemo(() => {
    return openWindowIds
      .map((id) => conversations.find((c) => c.peerPubkey === id))
      .filter((c): c is Conversation => c !== undefined);
  }, [conversations, openWindowIds]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
      return b.lastMessageTime - a.lastMessageTime;
    });
  }, [conversations]);

  // Windows that are open and NOT minimized should show as chat windows
  const windowsToRender = openWindows.filter((w) => !minimizedWindowIds.includes(w.peerPubkey));

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
      .filter((c) => !dismissedIds.has(c.peerPubkey) && !visibleWindowIds.has(c.peerPubkey))
      .slice(0, MAX_VISIBLE_BUBBLES);
  }, [sortedConversations, openWindowIds, minimizedWindowIds, dismissedWindowIds]);

  if (conversations.length === 0) {
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
            visibleBubbles.map((conversation, index) => (
              <MiniChatBubble
                key={conversation.peerPubkey}
                conversation={conversation}
                onClick={() => openWindow(conversation)}
                index={index}
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
          {windowsToRender.map((conversation, index) => (
            <MiniChatWindow
              key={conversation.peerPubkey}
              conversation={conversation}
              index={index}
            />
          ))}
        </AnimatePresence>
      </div>
    </>,
    document.body
  );
}
