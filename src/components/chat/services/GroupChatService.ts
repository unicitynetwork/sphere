import {
  NostrClient,
  NostrKeyManager,
  Filter,
  Event,
} from '@unicitylabs/nostr-js-sdk';

import { IdentityManager } from '../../wallet/L3/services/IdentityManager';
import { GroupChatRepository } from '../data/GroupChatRepository';
import {
  Group,
  GroupMessage,
  GroupMember,
  GroupRole,
  GroupVisibility,
} from '../data/groupModels';
import { GROUP_CHAT_CONFIG } from '../../../config/groupChat.config';
import { Buffer } from 'buffer';

/**
 * Extended filter interface for NIP-29 group queries.
 * NIP-29 uses "h" tags for group IDs which aren't in the standard Filter type.
 */
interface Nip29FilterData {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#e'?: string[];
  '#p'?: string[];
  '#t'?: string[];
  '#d'?: string[];
  '#h'?: string[];  // NIP-29: Group ID tags
  since?: number;
  until?: number;
  limit?: number;
}

/**
 * Create a filter with NIP-29 support.
 * The SDK's Filter doesn't include #h tags, so we cast through the extended interface.
 */
function createNip29Filter(data: Nip29FilterData): Filter {
  return new Filter(data as ConstructorParameters<typeof Filter>[0]);
}

/**
 * NIP-29 Event Kinds
 * https://github.com/nostr-protocol/nips/blob/master/29.md
 */
const NIP29_KINDS = {
  // User messages (sent to group)
  CHAT_MESSAGE: 9,
  THREAD_ROOT: 11,
  THREAD_REPLY: 12,

  // User requests
  JOIN_REQUEST: 9021,
  LEAVE_REQUEST: 9022,

  // Moderation (admin only)
  PUT_USER: 9000,
  REMOVE_USER: 9001,
  EDIT_METADATA: 9002,
  DELETE_EVENT: 9005,
  CREATE_GROUP: 9007,
  DELETE_GROUP: 9008,
  CREATE_INVITE: 9009,

  // Metadata (relay-signed)
  GROUP_METADATA: 39000,
  GROUP_ADMINS: 39001,
  GROUP_MEMBERS: 39002,
  GROUP_ROLES: 39003,
};

export interface CreateGroupOptions {
  name: string;
  description?: string;
  picture?: string;
  visibility?: GroupVisibility;
}

export class GroupChatService {
  private static instance: GroupChatService;
  private client: NostrClient | null = null;
  private identityManager: IdentityManager;
  private repository: GroupChatRepository;
  private relayUrls: string[];
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private messageListeners: ((message: GroupMessage) => void)[] = [];
  private reconnectAttempts: number = 0;

  private constructor(identityManager: IdentityManager, relayUrls?: string[]) {
    this.identityManager = identityManager;
    this.relayUrls = relayUrls || GROUP_CHAT_CONFIG.RELAYS;
    this.repository = GroupChatRepository.getInstance();
  }

  static getInstance(identityManager?: IdentityManager, relayUrls?: string[]): GroupChatService {
    if (!GroupChatService.instance) {
      const manager = identityManager || IdentityManager.getInstance();
      GroupChatService.instance = new GroupChatService(manager, relayUrls);
    }
    return GroupChatService.instance;
  }

  // ==========================================
  // Connection Management
  // ==========================================

  async start(): Promise<void> {
    if (this.isConnected) return;

    if (this.isConnecting && this.connectPromise) {
      return this.connectPromise;
    }

    this.isConnecting = true;
    this.connectPromise = this.doConnect();

    try {
      await this.connectPromise;
    } finally {
      this.isConnecting = false;
      this.connectPromise = null;
    }
  }

  async reset(): Promise<void> {
    console.log('🔄 Resetting GroupChatService connection...');

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        console.warn('Error disconnecting group chat client:', err);
      }
      this.client = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.connectPromise = null;
    this.reconnectAttempts = 0;

    console.log('✅ GroupChatService reset complete');
  }

  private async doConnect(): Promise<void> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) throw new Error('No identity found for group chat');

    const secretKey = Buffer.from(identity.privateKey, 'hex');
    const keyManager = NostrKeyManager.fromPrivateKey(secretKey);

    this.client = new NostrClient(keyManager);

    console.log(`📡 Connecting to group chat relays: ${this.relayUrls.join(', ')}`);
    try {
      await this.client.connect(...this.relayUrls);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('✅ Connected to group chat relays');

      // Subscribe to events for joined groups
      await this.subscribeToJoinedGroups();
    } catch (error) {
      console.error('❌ Failed to connect to group chat relays', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= GROUP_CHAT_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}...`);

    setTimeout(() => {
      this.start().catch(console.error);
    }, GROUP_CHAT_CONFIG.RECONNECT_DELAY_MS);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // ==========================================
  // Subscription Management
  // ==========================================

  private async subscribeToJoinedGroups(): Promise<void> {
    if (!this.client) return;

    const groups = this.repository.getGroups();
    if (groups.length === 0) {
      console.log('No joined groups to subscribe to');
      return;
    }

    const groupIds = groups.map((g) => g.id);
    console.log(`📥 Subscribing to ${groupIds.length} groups`);

    // Subscribe to group messages
    const messageFilter = createNip29Filter({
      kinds: [NIP29_KINDS.CHAT_MESSAGE, NIP29_KINDS.THREAD_ROOT, NIP29_KINDS.THREAD_REPLY],
      '#h': groupIds,
    });

    this.client.subscribe(messageFilter, {
      onEvent: (event) => this.handleGroupEvent(event),
      onEndOfStoredEvents: () => {
        console.log('End of stored group messages');
      },
    });

    // Subscribe to group metadata changes
    const metadataFilter = createNip29Filter({
      kinds: [NIP29_KINDS.GROUP_METADATA, NIP29_KINDS.GROUP_MEMBERS, NIP29_KINDS.GROUP_ADMINS],
      '#d': groupIds,
    });

    this.client.subscribe(metadataFilter, {
      onEvent: (event) => this.handleMetadataEvent(event),
      onEndOfStoredEvents: () => {
        console.log('End of stored group metadata');
      },
    });
  }

  subscribeToGroup(groupId: string): void {
    if (!this.client) return;

    console.log(`📥 Subscribing to group: ${groupId}`);

    // Subscribe to messages for this group
    const messageFilter = createNip29Filter({
      kinds: [NIP29_KINDS.CHAT_MESSAGE, NIP29_KINDS.THREAD_ROOT, NIP29_KINDS.THREAD_REPLY],
      '#h': [groupId],
    });

    this.client.subscribe(messageFilter, {
      onEvent: (event) => this.handleGroupEvent(event),
      onEndOfStoredEvents: () => {
        console.log(`End of stored messages for group ${groupId}`);
      },
    });
  }

  // ==========================================
  // Event Handlers
  // ==========================================

  private handleGroupEvent(event: Event): void {
    // Deduplicate
    if (this.repository.isEventProcessed(event.id)) {
      return;
    }

    const groupId = this.getGroupIdFromEvent(event);
    if (!groupId) {
      console.warn('Group event missing h tag:', event);
      return;
    }

    // Only process events for groups we've joined
    const group = this.repository.getGroup(groupId);
    if (!group) {
      console.log(`Ignoring event for non-joined group: ${groupId}`);
      return;
    }

    console.log(`📩 Group message in ${groupId}: ${event.content.slice(0, 50)}...`);

    const message = new GroupMessage({
      id: event.id,
      groupId: groupId,
      content: event.content,
      timestamp: event.created_at * 1000,
      senderPubkey: event.pubkey,
      senderNametag: this.extractNametag(event),
      replyToId: this.extractReplyTo(event),
      previousIds: this.extractPreviousIds(event),
    });

    this.repository.saveMessage(message);
    this.repository.addProcessedEventId(event.id);

    // Notify listeners
    this.notifyMessageListeners(message);
    window.dispatchEvent(new CustomEvent('group-message-received', { detail: message }));
  }

  private handleMetadataEvent(event: Event): void {
    const groupId = this.getGroupIdFromMetadataEvent(event);
    if (!groupId) return;

    const group = this.repository.getGroup(groupId);
    if (!group) return;

    if (event.kind === NIP29_KINDS.GROUP_METADATA) {
      // Update group metadata
      try {
        const metadata = JSON.parse(event.content);
        group.name = metadata.name || group.name;
        group.description = metadata.about || group.description;
        group.picture = metadata.picture || group.picture;
        group.updatedAt = event.created_at * 1000;
        this.repository.saveGroup(group);
      } catch (e) {
        console.error('Failed to parse group metadata', e);
      }
    } else if (event.kind === NIP29_KINDS.GROUP_MEMBERS) {
      // Update member list
      this.updateMembersFromEvent(groupId, event);
    }
  }

  private updateMembersFromEvent(groupId: string, event: Event): void {
    // NIP-29 GROUP_MEMBERS event has p tags with pubkeys and optional roles
    const pTags = event.tags.filter((t) => t[0] === 'p');

    for (const tag of pTags) {
      const pubkey = tag[1];
      const role = tag[3] as GroupRole || GroupRole.MEMBER;

      const member = new GroupMember({
        pubkey,
        groupId,
        role,
        joinedAt: event.created_at * 1000,
      });

      this.repository.saveMember(member);
    }
  }

  // ==========================================
  // Group Discovery
  // ==========================================

  async fetchAvailableGroups(): Promise<Group[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    return new Promise((resolve) => {
      const groups: Group[] = [];
      const filter = new Filter({ kinds: [NIP29_KINDS.GROUP_METADATA] });

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          const group = this.parseGroupMetadata(event);
          if (group && group.visibility === GroupVisibility.PUBLIC) {
            groups.push(group);
          }
        },
        onEndOfStoredEvents: () => {
          console.log(`Found ${groups.length} available groups`);
          resolve(groups);
        },
      });

      // Timeout after 10 seconds
      setTimeout(() => resolve(groups), 10000);
    });
  }

  async fetchGroupMetadata(groupId: string): Promise<Group | null> {
    if (!this.client) await this.start();
    if (!this.client) return null;

    return new Promise((resolve) => {
      const filter = new Filter({
        kinds: [NIP29_KINDS.GROUP_METADATA],
        '#d': [groupId],
      });

      let found = false;

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          if (!found) {
            found = true;
            resolve(this.parseGroupMetadata(event));
          }
        },
        onEndOfStoredEvents: () => {
          if (!found) resolve(null);
        },
      });

      setTimeout(() => {
        if (!found) resolve(null);
      }, 5000);
    });
  }

  async fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    return new Promise((resolve) => {
      const members: GroupMember[] = [];
      const filter = new Filter({
        kinds: [NIP29_KINDS.GROUP_MEMBERS],
        '#d': [groupId],
      });

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          const pTags = event.tags.filter((t) => t[0] === 'p');
          for (const tag of pTags) {
            members.push(
              new GroupMember({
                pubkey: tag[1],
                groupId,
                role: (tag[3] as GroupRole) || GroupRole.MEMBER,
                joinedAt: event.created_at * 1000,
              })
            );
          }
        },
        onEndOfStoredEvents: () => {
          resolve(members);
        },
      });

      setTimeout(() => resolve(members), 5000);
    });
  }

  // ==========================================
  // Join/Leave Operations
  // ==========================================

  async joinGroup(groupId: string, inviteCode?: string): Promise<boolean> {
    if (!this.client) await this.start();
    if (!this.client) return false;

    try {
      // First, fetch group metadata
      const group = await this.fetchGroupMetadata(groupId);
      if (!group) {
        console.error(`Group not found: ${groupId}`);
        return false;
      }

      // Build join request event (kind 9021)
      const tags: string[][] = [['h', groupId]];
      if (inviteCode) {
        tags.push(['code', inviteCode]);
      }

      const eventId = await this.client.createAndPublishEvent({
        kind: NIP29_KINDS.JOIN_REQUEST,
        tags,
        content: '',
      });

      if (eventId) {
        console.log(`✅ Join request sent for group ${groupId}`);

        // Save the group locally
        this.repository.saveGroup(group);

        // Subscribe to this group's events
        this.subscribeToGroup(groupId);

        // Fetch existing messages
        await this.fetchMessages(groupId);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to join group', error);
      return false;
    }
  }

  async leaveGroup(groupId: string): Promise<boolean> {
    if (!this.client) await this.start();
    if (!this.client) return false;

    try {
      const eventId = await this.client.createAndPublishEvent({
        kind: NIP29_KINDS.LEAVE_REQUEST,
        tags: [['h', groupId]],
        content: '',
      });

      if (eventId) {
        console.log(`✅ Left group ${groupId}`);

        // Remove group from local storage
        this.repository.deleteGroup(groupId);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to leave group', error);
      return false;
    }
  }

  // ==========================================
  // Message Operations
  // ==========================================

  async sendMessage(
    groupId: string,
    content: string,
    replyToId?: string
  ): Promise<GroupMessage | null> {
    if (!this.client) await this.start();
    if (!this.client) return null;

    try {
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) throw new Error('No identity for sending group message');

      const kind = replyToId ? NIP29_KINDS.THREAD_REPLY : NIP29_KINDS.CHAT_MESSAGE;

      // Build tags
      const tags: string[][] = [['h', groupId]];

      // Add previous message IDs for ordering
      const previousIds = this.repository.getRecentMessageIds(
        groupId,
        GROUP_CHAT_CONFIG.MAX_PREVIOUS_TAGS
      );
      if (previousIds.length > 0) {
        tags.push(['previous', ...previousIds]);
      }

      // Add reply reference if replying
      if (replyToId) {
        tags.push(['e', replyToId, '', 'reply']);
      }

      const eventId = await this.client.createAndPublishEvent({
        kind,
        tags,
        content,
      });

      if (eventId) {
        const message = new GroupMessage({
          id: eventId,
          groupId,
          content,
          timestamp: Date.now(),
          senderPubkey: identity.publicKey,
          replyToId,
          previousIds,
        });

        this.repository.saveMessage(message);
        this.repository.addProcessedEventId(eventId);

        console.log(`📤 Group message sent to ${groupId}`);
        return message;
      }

      return null;
    } catch (error) {
      console.error('Failed to send group message', error);
      return null;
    }
  }

  async fetchMessages(
    groupId: string,
    since?: number,
    limit?: number
  ): Promise<GroupMessage[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    return new Promise((resolve) => {
      const messages: GroupMessage[] = [];
      const filterData: Nip29FilterData = {
        kinds: [NIP29_KINDS.CHAT_MESSAGE, NIP29_KINDS.THREAD_ROOT, NIP29_KINDS.THREAD_REPLY],
        '#h': [groupId],
      };

      if (since) {
        filterData.since = Math.floor(since / 1000);
      }
      if (limit) {
        filterData.limit = limit;
      }

      const filter = createNip29Filter(filterData);

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          if (!this.repository.isEventProcessed(event.id)) {
            const message = new GroupMessage({
              id: event.id,
              groupId,
              content: event.content,
              timestamp: event.created_at * 1000,
              senderPubkey: event.pubkey,
              senderNametag: this.extractNametag(event),
              replyToId: this.extractReplyTo(event),
              previousIds: this.extractPreviousIds(event),
            });

            messages.push(message);
            this.repository.saveMessage(message);
            this.repository.addProcessedEventId(event.id);
          }
        },
        onEndOfStoredEvents: () => {
          console.log(`Fetched ${messages.length} messages for group ${groupId}`);
          resolve(messages);
        },
      });

      setTimeout(() => resolve(messages), 10000);
    });
  }

  // ==========================================
  // Admin Operations (Future)
  // ==========================================

  async createGroup(options: CreateGroupOptions): Promise<Group | null> {
    if (!this.client) await this.start();
    if (!this.client) return null;

    try {
      const eventId = await this.client.createAndPublishEvent({
        kind: NIP29_KINDS.CREATE_GROUP,
        tags: [],
        content: JSON.stringify({
          name: options.name,
          about: options.description,
          picture: options.picture,
          private: options.visibility === GroupVisibility.PRIVATE,
        }),
      });

      if (eventId) {
        // The relay should respond with the group metadata
        // For now, create a local group with the event ID as temporary ID
        const group = new Group({
          id: eventId.slice(0, 12), // Temporary ID until relay confirms
          relayUrl: this.relayUrls[0], // Primary relay URL
          name: options.name,
          description: options.description,
          picture: options.picture,
          visibility: options.visibility || GroupVisibility.PUBLIC,
          createdAt: Date.now(),
        });

        console.log(`✅ Group create request sent`);
        return group;
      }

      return null;
    } catch (error) {
      console.error('Failed to create group', error);
      return null;
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  private getGroupIdFromEvent(event: Event): string | null {
    const hTag = event.tags.find((t) => t[0] === 'h');
    return hTag ? hTag[1] : null;
  }

  private getGroupIdFromMetadataEvent(event: Event): string | null {
    const dTag = event.tags.find((t) => t[0] === 'd');
    return dTag ? dTag[1] : null;
  }

  private extractNametag(event: Event): string | undefined {
    // Some relays may include nametag in a tag
    const nametagTag = event.tags.find((t) => t[0] === 'nametag');
    return nametagTag ? nametagTag[1] : undefined;
  }

  private extractReplyTo(event: Event): string | undefined {
    const eTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
    return eTag ? eTag[1] : undefined;
  }

  private extractPreviousIds(event: Event): string[] | undefined {
    const previousTag = event.tags.find((t) => t[0] === 'previous');
    return previousTag ? previousTag.slice(1) : undefined;
  }

  private parseGroupMetadata(event: Event): Group | null {
    try {
      const groupId = this.getGroupIdFromMetadataEvent(event);
      if (!groupId) return null;

      const metadata = JSON.parse(event.content);
      const isPrivate = metadata.private === true || event.tags.some((t) => t[0] === 'private');

      return new Group({
        id: groupId,
        relayUrl: this.relayUrls[0], // Primary relay URL
        name: metadata.name || 'Unnamed Group',
        description: metadata.about,
        picture: metadata.picture,
        visibility: isPrivate ? GroupVisibility.PRIVATE : GroupVisibility.PUBLIC,
        createdAt: event.created_at * 1000,
      });
    } catch (e) {
      console.error('Failed to parse group metadata', e);
      return null;
    }
  }

  // ==========================================
  // Listeners
  // ==========================================

  addMessageListener(listener: (message: GroupMessage) => void): void {
    this.messageListeners.push(listener);
  }

  removeMessageListener(listener: (message: GroupMessage) => void): void {
    this.messageListeners = this.messageListeners.filter((l) => l !== listener);
  }

  private notifyMessageListeners(message: GroupMessage): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  // ==========================================
  // Utilities
  // ==========================================

  getMyPublicKey(): string | null {
    const keyManager = this.client?.getKeyManager();
    return keyManager?.getPublicKeyHex() || null;
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }
}
