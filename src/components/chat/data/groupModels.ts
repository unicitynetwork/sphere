import { v4 as uuidv4 } from 'uuid';

// ==========================================
// Group Role
// ==========================================

export const GroupRole = {
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  MEMBER: 'MEMBER',
} as const;

export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];

// ==========================================
// Group Visibility
// ==========================================

export const GroupVisibility = {
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
} as const;

export type GroupVisibility = (typeof GroupVisibility)[keyof typeof GroupVisibility];

// ==========================================
// Group Model
// ==========================================

export interface GroupData {
  id: string;
  relayUrl: string;
  name: string;
  description?: string;
  picture?: string;
  visibility: GroupVisibility;
  createdAt: number;
  updatedAt?: number;
  memberCount?: number;
  unreadCount?: number;
  lastMessageTime?: number;
  lastMessageText?: string;
  localJoinedAt?: number; // When the current user joined this group locally
}

export class Group {
  id: string;
  relayUrl: string;
  name: string;
  description?: string;
  picture?: string;
  visibility: GroupVisibility;
  createdAt: number;
  updatedAt?: number;
  memberCount: number;
  unreadCount: number;
  lastMessageTime: number;
  lastMessageText: string;
  localJoinedAt: number; // When the current user joined this group locally

  constructor(data: GroupData) {
    this.id = data.id;
    this.relayUrl = data.relayUrl;
    this.name = data.name;
    this.description = data.description;
    this.picture = data.picture;
    this.visibility = data.visibility || GroupVisibility.PUBLIC;
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt;
    this.memberCount = data.memberCount || 0;
    this.unreadCount = data.unreadCount || 0;
    this.lastMessageTime = data.lastMessageTime || Date.now();
    this.lastMessageText = data.lastMessageText || '';
    this.localJoinedAt = data.localJoinedAt || Date.now();
  }

  getDisplayName(): string {
    return this.name || this.id.slice(0, 8) + '...';
  }

  getAvatar(): string {
    return this.name.slice(0, 2).toUpperCase();
  }

  getFullIdentifier(): string {
    return `${this.relayUrl}'${this.id}`;
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

  toJSON(): GroupData {
    return {
      id: this.id,
      relayUrl: this.relayUrl,
      name: this.name,
      description: this.description,
      picture: this.picture,
      visibility: this.visibility,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      memberCount: this.memberCount,
      unreadCount: this.unreadCount,
      lastMessageTime: this.lastMessageTime,
      lastMessageText: this.lastMessageText,
      localJoinedAt: this.localJoinedAt,
    };
  }

  static fromJSON(json: GroupData): Group {
    return new Group(json);
  }
}

// ==========================================
// Group Message Model
// ==========================================

export interface GroupMessageData {
  id?: string;
  groupId: string;
  content: string;
  timestamp: number;
  senderPubkey: string;
  senderNametag?: string;
  replyToId?: string;
  previousIds?: string[];
  metadata?: Record<string, unknown>;
}

export class GroupMessage {
  id: string;
  groupId: string;
  content: string;
  timestamp: number;
  senderPubkey: string;
  senderNametag?: string;
  replyToId?: string;
  previousIds?: string[];
  metadata?: Record<string, unknown>;

  constructor(data: GroupMessageData) {
    this.id = data.id || uuidv4();
    this.groupId = data.groupId;
    this.content = data.content;
    this.timestamp = data.timestamp || Date.now();
    this.senderPubkey = data.senderPubkey;
    this.senderNametag = data.senderNametag;
    this.replyToId = data.replyToId;
    this.previousIds = data.previousIds;
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

  getSenderDisplayName(): string {
    if (this.senderNametag) {
      return `@${this.senderNametag.replace('@', '')}`;
    }
    return this.senderPubkey.slice(0, 8) + '...';
  }

  getSenderAvatar(): string {
    const name = this.senderNametag || this.senderPubkey;
    return name.slice(0, 2).toUpperCase();
  }

  toJSON(): GroupMessageData {
    return {
      id: this.id,
      groupId: this.groupId,
      content: this.content,
      timestamp: this.timestamp,
      senderPubkey: this.senderPubkey,
      senderNametag: this.senderNametag,
      replyToId: this.replyToId,
      previousIds: this.previousIds,
      metadata: this.metadata,
    };
  }

  static fromJSON(json: GroupMessageData): GroupMessage {
    return new GroupMessage(json);
  }
}

// ==========================================
// Group Member Model
// ==========================================

export interface GroupMemberData {
  pubkey: string;
  groupId: string;
  role: GroupRole;
  nametag?: string;
  joinedAt: number;
}

export class GroupMember {
  pubkey: string;
  groupId: string;
  role: GroupRole;
  nametag?: string;
  joinedAt: number;

  constructor(data: GroupMemberData) {
    this.pubkey = data.pubkey;
    this.groupId = data.groupId;
    this.role = data.role || GroupRole.MEMBER;
    this.nametag = data.nametag;
    this.joinedAt = data.joinedAt || Date.now();
  }

  getDisplayName(): string {
    if (this.nametag) {
      return `@${this.nametag.replace('@', '')}`;
    }
    return this.pubkey.slice(0, 8) + '...';
  }

  getAvatar(): string {
    const name = this.nametag || this.pubkey;
    return name.slice(0, 2).toUpperCase();
  }

  isAdmin(): boolean {
    return this.role === GroupRole.ADMIN;
  }

  isModerator(): boolean {
    return this.role === GroupRole.MODERATOR || this.role === GroupRole.ADMIN;
  }

  toJSON(): GroupMemberData {
    return {
      pubkey: this.pubkey,
      groupId: this.groupId,
      role: this.role,
      nametag: this.nametag,
      joinedAt: this.joinedAt,
    };
  }

  static fromJSON(json: GroupMemberData): GroupMember {
    return new GroupMember(json);
  }
}
