// SDK DirectMessage shape (local mirror — SDK DTS not always resolvable)
interface SDKDirectMessage {
  id: string;
  senderPubkey: string;
  senderNametag?: string;
  recipientPubkey: string;
  recipientNametag?: string;
  content: string;
  timestamp: number;
  isRead: boolean;
}

// ==========================================
// Conversation (derived from SDK data)
// ==========================================

export interface Conversation {
  peerPubkey: string;
  peerNametag?: string;
  lastMessageText: string;
  lastMessageTime: number;
  unreadCount: number;
}

// ==========================================
// Display Message (derived from SDK SDKDirectMessage)
// ==========================================

export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ';

export interface DisplayMessage {
  id: string;
  content: string;
  timestamp: number;
  isFromMe: boolean;
  status: MessageStatus;
  senderPubkey: string;
  senderNametag?: string;
}

// ==========================================
// DM Received Event Detail
// ==========================================

export interface DmReceivedDetail {
  peerPubkey: string;
  messageId: string;
  isFromMe: boolean;
}

// ==========================================
// Display Helpers
// ==========================================

export function getDisplayName(peerPubkey: string, peerNametag?: string): string {
  if (peerNametag) {
    return `@${peerNametag.replace('@', '')}`;
  }
  return peerPubkey.slice(0, 8) + '...';
}

export function getAvatar(peerPubkey: string, peerNametag?: string): string {
  const name = peerNametag || peerPubkey;
  return name.slice(0, 2).toUpperCase();
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMessageDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString();
}

// ==========================================
// Message Mapper
// ==========================================

export function toDisplayMessage(dm: SDKDirectMessage, myPubkey: string): DisplayMessage {
  const isFromMe = dm.senderPubkey === myPubkey;
  return {
    id: dm.id,
    content: dm.content,
    timestamp: dm.timestamp,
    isFromMe,
    status: isFromMe ? (dm.isRead ? 'READ' : 'SENT') : (dm.isRead ? 'READ' : 'DELIVERED'),
    senderPubkey: dm.senderPubkey,
    senderNametag: dm.senderNametag,
  };
}

// ==========================================
// Conversation Builders
// ==========================================

export function buildConversation(
  peerPubkey: string,
  messages: SDKDirectMessage[],
  myPubkey: string,
): Conversation {
  const sorted = [...messages].sort((a, b) => b.timestamp - a.timestamp);
  const lastMsg = sorted[0];

  const peerNametag =
    messages.find(m => m.senderPubkey === peerPubkey && m.senderNametag)?.senderNametag
    ?? messages.find(m => m.recipientPubkey === peerPubkey && m.recipientNametag)?.recipientNametag;

  const unreadCount = messages.filter(
    m => m.senderPubkey !== myPubkey && !m.isRead,
  ).length;

  return {
    peerPubkey,
    peerNametag: peerNametag ?? undefined,
    lastMessageText: lastMsg?.content.slice(0, 100) ?? '',
    lastMessageTime: lastMsg?.timestamp ?? 0,
    unreadCount,
  };
}

export function buildConversations(
  sdkConversations: Map<string, SDKDirectMessage[]>,
  myPubkey: string,
): Conversation[] {
  const result: Conversation[] = [];
  for (const [peerPubkey, messages] of sdkConversations) {
    result.push(buildConversation(peerPubkey, messages, myPubkey));
  }
  return result.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
}

// ==========================================
// Address ID helper (used as cache key segment)
// ==========================================

export function buildAddressId(directAddress: string): string {
  let hash = directAddress;
  if (hash.startsWith('DIRECT://')) hash = hash.slice(9);
  else if (hash.startsWith('DIRECT:')) hash = hash.slice(7);
  const first = hash.slice(0, 6).toLowerCase();
  const last = hash.slice(-6).toLowerCase();
  return `DIRECT_${first}_${last}`;
}

// ==========================================
// Query Keys
// ==========================================

export const CHAT_KEYS = {
  all: ['chat'] as const,
  conversations: (addressId: string) => ['chat', 'conversations', addressId] as const,
  messages: (addressId: string, peerPubkey: string) => ['chat', 'messages', addressId, peerPubkey] as const,
  unreadCount: (addressId: string) => ['chat', 'unreadCount', addressId] as const,
};

export const GROUP_CHAT_KEYS = {
  all: ['groupChat'] as const,
};
