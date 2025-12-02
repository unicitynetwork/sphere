import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Chat Message Status
// ==========================================

export const MessageStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;

export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

// ==========================================
// Chat Message Type
// ==========================================

export const MessageType = {
  TEXT: 'TEXT',
  PAYMENT_REQUEST: 'PAYMENT_REQUEST',
  TOKEN_TRANSFER: 'TOKEN_TRANSFER',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// ==========================================
// Chat Message Model
// ==========================================

export interface ChatMessageData {
  id?: string;
  conversationId: string;
  content: string;
  timestamp: number;
  isFromMe: boolean;
  status: MessageStatus;
  type: MessageType;
  senderPubkey?: string;
  senderNametag?: string;
  signature?: string;
  metadata?: Record<string, unknown>;
}

export class ChatMessage {
  id: string;
  conversationId: string;
  content: string;
  timestamp: number;
  isFromMe: boolean;
  status: MessageStatus;
  type: MessageType;
  senderPubkey?: string;
  senderNametag?: string;
  signature?: string;
  metadata?: Record<string, unknown>;

  constructor(data: ChatMessageData) {
    this.id = data.id || uuidv4();
    this.conversationId = data.conversationId;
    this.content = data.content;
    this.timestamp = data.timestamp || Date.now();
    this.isFromMe = data.isFromMe;
    this.status = data.status || MessageStatus.PENDING;
    this.type = data.type || MessageType.TEXT;
    this.senderPubkey = data.senderPubkey;
    this.senderNametag = data.senderNametag;
    this.signature = data.signature;
    this.metadata = data.metadata;
  }

  getFormattedTime(): string {
    return new Date(this.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getFormattedDate(): string {
    const date = new Date(this.timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString();
  }

  toJSON(): ChatMessageData {
    return {
      id: this.id,
      conversationId: this.conversationId,
      content: this.content,
      timestamp: this.timestamp,
      isFromMe: this.isFromMe,
      status: this.status,
      type: this.type,
      senderPubkey: this.senderPubkey,
      senderNametag: this.senderNametag,
      signature: this.signature,
      metadata: this.metadata,
    };
  }

  static fromJSON(json: ChatMessageData): ChatMessage {
    return new ChatMessage(json);
  }
}

// ==========================================
// Chat Conversation Model
// ==========================================

export interface ChatConversationData {
  id?: string;
  participantPubkey: string;
  participantNametag?: string;
  participantName?: string;
  lastMessageTime?: number;
  lastMessageText?: string;
  unreadCount?: number;
  isApproved?: boolean;
  createdAt?: number;
}

export class ChatConversation {
  id: string;
  participantPubkey: string;
  participantNametag?: string;
  participantName?: string;
  lastMessageTime: number;
  lastMessageText: string;
  unreadCount: number;
  isApproved: boolean;
  createdAt: number;

  constructor(data: ChatConversationData) {
    this.id = data.id || data.participantPubkey;
    this.participantPubkey = data.participantPubkey;
    this.participantNametag = data.participantNametag;
    this.participantName = data.participantName;
    this.lastMessageTime = data.lastMessageTime || Date.now();
    this.lastMessageText = data.lastMessageText || '';
    this.unreadCount = data.unreadCount || 0;
    this.isApproved = data.isApproved ?? true;
    this.createdAt = data.createdAt || Date.now();
  }

  getDisplayName(): string {
    if (this.participantNametag) {
      return `@${this.participantNametag.replace('@', '')}`;
    }
    if (this.participantName) {
      return this.participantName;
    }
    return this.participantPubkey.slice(0, 8) + '...';
  }

  getAvatar(): string {
    const name = this.participantNametag || this.participantName || this.participantPubkey;
    return name.slice(0, 2).toUpperCase();
  }

  getFormattedLastMessageTime(): string {
    const date = new Date(this.lastMessageTime);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    return date.toLocaleDateString();
  }

  toJSON(): ChatConversationData {
    return {
      id: this.id,
      participantPubkey: this.participantPubkey,
      participantNametag: this.participantNametag,
      participantName: this.participantName,
      lastMessageTime: this.lastMessageTime,
      lastMessageText: this.lastMessageText,
      unreadCount: this.unreadCount,
      isApproved: this.isApproved,
      createdAt: this.createdAt,
    };
  }

  static fromJSON(json: ChatConversationData): ChatConversation {
    return new ChatConversation(json);
  }
}
