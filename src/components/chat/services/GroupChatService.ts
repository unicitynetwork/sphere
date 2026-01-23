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
import { NametagService } from '../../wallet/L3/services/NametagService';
import { NostrService } from '../../wallet/L3/services/NostrService';

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
    // Check if relay URL changed and clear stale data if so
    const primaryRelay = this.relayUrls[0];
    this.repository.checkAndClearOnRelayChange(primaryRelay);

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

      // Check if we have any local groups
      const localGroups = this.repository.getGroups();

      if (localGroups.length === 0) {
        // No local groups - try to restore from relay (e.g., after wallet import)
        console.log('📥 No local groups found, attempting to restore from relay...');
        await this.restoreJoinedGroups();
      } else {
        // Subscribe to events for existing joined groups
        await this.subscribeToJoinedGroups();
      }
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

    // Subscribe to moderation events (message deletions)
    const moderationFilter = createNip29Filter({
      kinds: [NIP29_KINDS.DELETE_EVENT],
      '#h': groupIds,
    });

    this.client.subscribe(moderationFilter, {
      onEvent: (event) => this.handleDeleteEvent(event),
      onEndOfStoredEvents: () => {
        console.log('End of stored moderation events');
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

    // Subscribe to moderation events (message deletions) for this group
    const moderationFilter = createNip29Filter({
      kinds: [NIP29_KINDS.DELETE_EVENT],
      '#h': [groupId],
    });

    this.client.subscribe(moderationFilter, {
      onEvent: (event) => this.handleDeleteEvent(event),
      onEndOfStoredEvents: () => {
        console.log(`End of stored moderation events for group ${groupId}`);
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

    // Unwrap message content to extract sender's nametag if embedded
    const { text: content, senderNametag } = this.unwrapMessageContent(event.content);

    console.log(`📩 Group message in ${groupId} from ${senderNametag || event.pubkey.slice(0, 8)}: ${content.slice(0, 50)}...`);

    const message = new GroupMessage({
      id: event.id,
      groupId: groupId,
      content: content,
      timestamp: event.created_at * 1000,
      senderPubkey: event.pubkey,
      senderNametag: senderNametag || undefined,
      replyToId: this.extractReplyTo(event),
      previousIds: this.extractPreviousIds(event),
    });

    this.repository.saveMessage(message);
    this.repository.addProcessedEventId(event.id);

    // Update or create member with nametag from this message
    if (senderNametag) {
      let member = this.repository.getMember(groupId, event.pubkey);
      if (member) {
        if (member.nametag !== senderNametag) {
          member.nametag = senderNametag;
          this.repository.saveMember(member);
        }
      } else {
        // Create member record if they sent a message but aren't in member list yet
        member = new GroupMember({
          pubkey: event.pubkey,
          groupId: groupId,
          role: GroupRole.MEMBER,
          nametag: senderNametag,
          joinedAt: event.created_at * 1000,
        });
        this.repository.saveMember(member);
      }
    }

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
    } else if (event.kind === NIP29_KINDS.GROUP_ADMINS) {
      // Update admin list - mark these members as admins
      this.updateAdminsFromEvent(groupId, event);
    }
  }

  private handleDeleteEvent(event: Event): void {
    // NIP-29 DELETE_EVENT (kind 9005) has h tag for group and e tag for event to delete
    const groupId = this.getGroupIdFromEvent(event);
    if (!groupId) return;

    // Only process if we're a member of this group
    if (!this.repository.getGroup(groupId)) {
      return;
    }

    // Get the event ID(s) to delete from e tags
    const eTags = event.tags.filter((t) => t[0] === 'e');
    for (const tag of eTags) {
      const messageId = tag[1];
      if (messageId) {
        console.log(`🗑️ Received delete event for message ${messageId} in group ${groupId}`);
        this.repository.deleteMessage(messageId);
      }
    }

    // Notify UI of the deletion
    window.dispatchEvent(new CustomEvent('group-chat-updated'));
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

  private updateAdminsFromEvent(groupId: string, event: Event): void {
    // NIP-29 GROUP_ADMINS event has p tags with admin pubkeys
    const pTags = event.tags.filter((t) => t[0] === 'p');

    console.log(`👑 Updating admins for group ${groupId}: ${pTags.length} admins`);

    for (const tag of pTags) {
      const pubkey = tag[1];

      // Check if member already exists
      const existingMember = this.repository.getMember(groupId, pubkey);

      if (existingMember) {
        // Update existing member to admin role
        existingMember.role = GroupRole.ADMIN;
        this.repository.saveMember(existingMember);
      } else {
        // Create new member with admin role
        const member = new GroupMember({
          pubkey,
          groupId,
          role: GroupRole.ADMIN,
          joinedAt: event.created_at * 1000,
        });
        this.repository.saveMember(member);
      }
    }
  }

  // ==========================================
  // Group Membership Restoration
  // ==========================================

  /**
   * Restore joined groups after wallet import.
   * Queries the relay for GROUP_MEMBERS events to find groups where
   * the current user is a member, then saves them locally.
   * This is called automatically on connect when no local groups exist.
   */
  async restoreJoinedGroups(): Promise<Group[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    const myPubkey = this.getMyPublicKey();
    if (!myPubkey) {
      console.log('❌ Cannot restore groups: no public key available');
      return [];
    }

    console.log(`🔍 Searching for groups where ${myPubkey.slice(0, 8)}... is a member`);

    return new Promise((resolve) => {
      const groupIdsWithMembership = new Set<string>();
      let membersComplete = false;

      // Fetch all GROUP_MEMBERS events
      const membersFilter = new Filter({ kinds: [NIP29_KINDS.GROUP_MEMBERS] });
      this.client!.subscribe(membersFilter, {
        onEvent: (event) => {
          const groupId = this.getGroupIdFromMetadataEvent(event);
          if (!groupId) return;

          // Check if our pubkey is in the member list
          const pTags = event.tags.filter((t) => t[0] === 'p');
          const isMember = pTags.some((tag) => tag[1] === myPubkey);

          if (isMember) {
            groupIdsWithMembership.add(groupId);
          }
        },
        onEndOfStoredEvents: async () => {
          membersComplete = true;

          if (groupIdsWithMembership.size === 0) {
            console.log('ℹ️ No group memberships found on relay');
            resolve([]);
            return;
          }

          console.log(`📋 Found ${groupIdsWithMembership.size} groups to restore:`, Array.from(groupIdsWithMembership));

          // Now fetch metadata for each group and save locally
          const restoredGroups: Group[] = [];

          for (const groupId of groupIdsWithMembership) {
            try {
              // Check if already saved locally (race condition protection)
              if (this.repository.getGroup(groupId)) {
                console.log(`ℹ️ Group ${groupId} already exists locally, skipping`);
                continue;
              }

              const group = await this.fetchGroupMetadata(groupId);
              if (group) {
                this.repository.saveGroup(group);
                restoredGroups.push(group);
                console.log(`✅ Restored group: ${group.name} (${groupId})`);

                // Fetch members and messages for the restored group
                await Promise.all([
                  this.fetchAndSaveMembers(groupId),
                  this.fetchMessages(groupId),
                ]);
              }
            } catch (err) {
              console.error(`Failed to restore group ${groupId}:`, err);
            }
          }

          // Subscribe to restored groups for new messages
          if (restoredGroups.length > 0) {
            await this.subscribeToJoinedGroups();
            window.dispatchEvent(new CustomEvent('group-chat-updated'));
          }

          console.log(`✅ Restored ${restoredGroups.length} groups from relay`);
          resolve(restoredGroups);
        },
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!membersComplete) {
          console.warn('⚠️ Group restoration timed out');
          resolve([]);
        }
      }, 15000);
    });
  }

  // ==========================================
  // Group Discovery
  // ==========================================

  async fetchAvailableGroups(): Promise<Group[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    return new Promise((resolve) => {
      const groupsMap = new Map<string, Group>();
      const memberCountsMap = new Map<string, number>();
      let metadataComplete = false;
      let membersComplete = false;

      const tryResolve = () => {
        if (metadataComplete && membersComplete) {
          // Apply member counts to groups
          for (const [groupId, count] of memberCountsMap) {
            const group = groupsMap.get(groupId);
            if (group) {
              group.memberCount = count;
            }
          }
          const groups = Array.from(groupsMap.values());
          console.log(`Found ${groups.length} available groups`);
          resolve(groups);
        }
      };

      // Fetch group metadata
      const metadataFilter = new Filter({ kinds: [NIP29_KINDS.GROUP_METADATA] });
      this.client!.subscribe(metadataFilter, {
        onEvent: (event) => {
          const group = this.parseGroupMetadata(event);
          if (group && group.visibility === GroupVisibility.PUBLIC) {
            // Dedupe by group ID, keep the most recent
            const existing = groupsMap.get(group.id);
            if (!existing || group.createdAt > existing.createdAt) {
              groupsMap.set(group.id, group);
            }
          }
        },
        onEndOfStoredEvents: () => {
          metadataComplete = true;
          tryResolve();
        },
      });

      // Fetch group members to get counts
      const membersFilter = new Filter({ kinds: [NIP29_KINDS.GROUP_MEMBERS] });
      this.client!.subscribe(membersFilter, {
        onEvent: (event) => {
          const groupId = this.getGroupIdFromMetadataEvent(event);
          if (groupId) {
            const pTags = event.tags.filter((t) => t[0] === 'p');
            // Keep the most recent member count (events can be updated)
            memberCountsMap.set(groupId, pTags.length);
          }
        },
        onEndOfStoredEvents: () => {
          membersComplete = true;
          tryResolve();
        },
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        metadataComplete = true;
        membersComplete = true;
        tryResolve();
      }, 10000);
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

  /**
   * Fetch group admins from the relay.
   * Returns array of pubkeys that are admins for the group.
   */
  async fetchGroupAdmins(groupId: string): Promise<string[]> {
    if (!this.client) await this.start();
    if (!this.client) return [];

    return new Promise((resolve) => {
      const adminPubkeys: string[] = [];
      const filter = new Filter({
        kinds: [NIP29_KINDS.GROUP_ADMINS],
        '#d': [groupId],
      });

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          const pTags = event.tags.filter((t) => t[0] === 'p');
          for (const tag of pTags) {
            if (!adminPubkeys.includes(tag[1])) {
              adminPubkeys.push(tag[1]);
            }
          }
        },
        onEndOfStoredEvents: () => {
          resolve(adminPubkeys);
        },
      });

      setTimeout(() => resolve(adminPubkeys), 5000);
    });
  }

  /**
   * Fetch group members and admins, then save them to the repository.
   * This updates the group's memberCount via repository.saveMember().
   */
  private async fetchAndSaveMembers(groupId: string): Promise<void> {
    // Fetch members and admins in parallel
    const [members, adminPubkeys] = await Promise.all([
      this.fetchGroupMembers(groupId),
      this.fetchGroupAdmins(groupId),
    ]);

    console.log(`📋 Fetched ${members.length} members and ${adminPubkeys.length} admins for group ${groupId}`);

    // Save members, marking admins appropriately
    for (const member of members) {
      if (adminPubkeys.includes(member.pubkey)) {
        member.role = GroupRole.ADMIN;
      }
      this.repository.saveMember(member);
    }

    // Save any admins that weren't in the member list
    for (const pubkey of adminPubkeys) {
      const existingMember = this.repository.getMember(groupId, pubkey);
      if (!existingMember) {
        const adminMember = new GroupMember({
          pubkey,
          groupId,
          role: GroupRole.ADMIN,
          joinedAt: Date.now(),
        });
        this.repository.saveMember(adminMember);
      }
    }
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

        // Fetch existing messages and members
        await Promise.all([
          this.fetchMessages(groupId),
          this.fetchAndSaveMembers(groupId),
        ]);

        return true;
      }

      return false;
    } catch (error) {
      // Handle "already a member" as success - just sync the local state
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already a member')) {
        console.log(`ℹ️ Already a member of group ${groupId}, syncing local state...`);

        // Fetch and save group metadata
        const group = await this.fetchGroupMetadata(groupId);
        if (group) {
          this.repository.saveGroup(group);
          this.subscribeToGroup(groupId);
          await Promise.all([
            this.fetchMessages(groupId),
            this.fetchAndSaveMembers(groupId),
          ]);
          return true;
        }
      }

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

      // Get sender's nametag to include in message
      const senderNametag = await this.getMyNametag();

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

      // Wrap content with sender's nametag for recipients to see who sent it
      const wrappedContent = this.wrapMessageContent(content, senderNametag);

      const eventId = await this.client.createAndPublishEvent({
        kind,
        tags,
        content: wrappedContent,
      });

      if (eventId) {
        const message = new GroupMessage({
          id: eventId,
          groupId,
          content,
          timestamp: Date.now(),
          senderPubkey: identity.publicKey,
          senderNametag: senderNametag || undefined,
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
      console.log('📡 Message filter:', JSON.stringify(filter.toJSON()));

      this.client!.subscribe(filter, {
        onEvent: (event) => {
          // Don't check isEventProcessed here - we want to reload history on rejoin
          // Unwrap message content to extract sender's nametag if embedded
          const { text: content, senderNametag } = this.unwrapMessageContent(event.content);

          const message = new GroupMessage({
            id: event.id,
            groupId,
            content: content,
            timestamp: event.created_at * 1000,
            senderPubkey: event.pubkey,
            senderNametag: senderNametag || undefined,
            replyToId: this.extractReplyTo(event),
            previousIds: this.extractPreviousIds(event),
          });

          messages.push(message);
          this.repository.saveMessage(message);
          this.repository.addProcessedEventId(event.id);

          // Update or create member with nametag from this message
          if (senderNametag) {
            let member = this.repository.getMember(groupId, event.pubkey);
            if (member) {
              if (member.nametag !== senderNametag) {
                member.nametag = senderNametag;
                this.repository.saveMember(member);
              }
            } else {
              // Create member record if they sent a message but aren't in member list yet
              member = new GroupMember({
                pubkey: event.pubkey,
                groupId: groupId,
                role: GroupRole.MEMBER,
                nametag: senderNametag,
                joinedAt: event.created_at * 1000,
              });
              this.repository.saveMember(member);
            }
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
  // Admin/Moderation Operations
  // ==========================================

  /**
   * Delete a message from the group (admin/moderator only).
   * Sends a DELETE_EVENT (kind 9005) to the relay.
   */
  async deleteMessage(groupId: string, messageId: string): Promise<boolean> {
    if (!this.client) await this.start();
    if (!this.client) return false;

    // Check if current user is a moderator
    if (!this.isCurrentUserModerator(groupId)) {
      console.error('❌ Cannot delete message: not a moderator');
      return false;
    }

    try {
      // NIP-29: DELETE_EVENT (kind 9005) with h tag for group and e tag for event to delete
      const eventId = await this.client.createAndPublishEvent({
        kind: NIP29_KINDS.DELETE_EVENT,
        tags: [
          ['h', groupId],
          ['e', messageId],
        ],
        content: '',
      });

      if (eventId) {
        console.log(`🗑️ Delete request sent for message ${messageId} in group ${groupId}`);

        // Remove from local storage
        this.repository.deleteMessage(messageId);
        window.dispatchEvent(new CustomEvent('group-chat-updated'));

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to delete message', error);
      return false;
    }
  }

  /**
   * Kick/remove a user from the group (admin only).
   * Sends a REMOVE_USER (kind 9001) to the relay.
   */
  async kickUser(groupId: string, userPubkey: string, reason?: string): Promise<boolean> {
    if (!this.client) await this.start();
    if (!this.client) return false;

    // Check if current user is an admin
    if (!this.isCurrentUserAdmin(groupId)) {
      console.error('❌ Cannot kick user: not an admin');
      return false;
    }

    // Prevent kicking yourself
    const myPubkey = this.getMyPublicKey();
    if (myPubkey === userPubkey) {
      console.error('❌ Cannot kick yourself');
      return false;
    }

    try {
      // NIP-29: REMOVE_USER (kind 9001) with h tag for group and p tag for user
      const tags: string[][] = [
        ['h', groupId],
        ['p', userPubkey],
      ];

      const eventId = await this.client.createAndPublishEvent({
        kind: NIP29_KINDS.REMOVE_USER,
        tags,
        content: reason || '',
      });

      if (eventId) {
        console.log(`👢 Kick request sent for user ${userPubkey.slice(0, 8)}... from group ${groupId}`);

        // Remove from local storage
        this.repository.removeMember(groupId, userPubkey);
        window.dispatchEvent(new CustomEvent('group-chat-updated'));

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to kick user', error);
      return false;
    }
  }

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

  /**
   * Wrapper format for messages that includes sender's nametag.
   * Messages are sent as JSON: {"senderNametag": "name", "text": "message"}
   * Same pattern as DM chat for consistency.
   */
  private wrapMessageContent(content: string, senderNametag: string | null): string {
    if (senderNametag) {
      return JSON.stringify({
        senderNametag: senderNametag,
        text: content,
      });
    }
    return content;
  }

  /**
   * Unwrap message content and extract sender's nametag if present.
   */
  private unwrapMessageContent(content: string): { text: string; senderNametag: string | null } {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed.text !== undefined) {
        return {
          text: parsed.text,
          senderNametag: parsed.senderNametag || null,
        };
      }
    } catch {
      // Not JSON, return original content
    }
    return { text: content, senderNametag: null };
  }

  private getGroupIdFromEvent(event: Event): string | null {
    const hTag = event.tags.find((t) => t[0] === 'h');
    return hTag ? hTag[1] : null;
  }

  private getGroupIdFromMetadataEvent(event: Event): string | null {
    const dTag = event.tags.find((t) => t[0] === 'd');
    return dTag ? dTag[1] : null;
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

      // Try parsing content as JSON first, fall back to tags
      let name = 'Unnamed Group';
      let description: string | undefined;
      let picture: string | undefined;
      let isPrivate = false;

      // Try JSON content first
      if (event.content && event.content.trim()) {
        try {
          const metadata = JSON.parse(event.content);
          name = metadata.name || name;
          description = metadata.about || metadata.description;
          picture = metadata.picture;
          isPrivate = metadata.private === true;
        } catch {
          // Content is not JSON, use tags instead
        }
      }

      // Also check tags (can override or supplement JSON)
      for (const tag of event.tags) {
        if (tag[0] === 'name' && tag[1]) name = tag[1];
        if (tag[0] === 'about' && tag[1]) description = tag[1];
        if (tag[0] === 'picture' && tag[1]) picture = tag[1];
        if (tag[0] === 'private') isPrivate = true;
        if (tag[0] === 'public' && tag[1] === 'false') isPrivate = true;
      }

      return new Group({
        id: groupId,
        relayUrl: this.relayUrls[0], // Primary relay URL
        name,
        description,
        picture,
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

  async getMyNametag(): Promise<string | null> {
    const nametagService = NametagService.getInstance(this.identityManager);
    return nametagService.getActiveNametag();
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  /**
   * Check if the current user is an admin of the specified group.
   */
  isCurrentUserAdmin(groupId: string): boolean {
    const myPubkey = this.getMyPublicKey();
    if (!myPubkey) return false;

    const member = this.repository.getMember(groupId, myPubkey);
    return member?.isAdmin() || false;
  }

  /**
   * Check if the current user is a moderator (admin or moderator) of the specified group.
   */
  isCurrentUserModerator(groupId: string): boolean {
    const myPubkey = this.getMyPublicKey();
    if (!myPubkey) return false;

    const member = this.repository.getMember(groupId, myPubkey);
    return member?.isModerator() || false;
  }

  /**
   * Get the current user's role in the specified group.
   */
  getCurrentUserRole(groupId: string): GroupRole | null {
    const myPubkey = this.getMyPublicKey();
    if (!myPubkey) return null;

    const member = this.repository.getMember(groupId, myPubkey);
    return member?.role || null;
  }

  /**
   * Resolve nametags for members who don't have one.
   * Nametags are learned from message content when members send messages.
   * Reverse lookup (pubkey → nametag) is not possible due to privacy design.
   */
  async resolveMemberNametags(_groupId: string): Promise<void> {
    // Nametags are resolved from message content when members send messages.
    // Members who haven't sent messages will show their pubkey only.
    // No-op since reverse lookup is not supported.
  }
}
