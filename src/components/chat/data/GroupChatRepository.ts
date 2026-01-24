import {
  Group,
  GroupMessage,
  GroupMember,
  type GroupData,
  type GroupMessageData,
  type GroupMemberData,
} from './groupModels';
import { STORAGE_KEYS } from '../../../config/storageKeys';

export class GroupChatRepository {
  private static instance: GroupChatRepository;

  private constructor() {}

  static getInstance(): GroupChatRepository {
    if (!GroupChatRepository.instance) {
      GroupChatRepository.instance = new GroupChatRepository();
    }
    return GroupChatRepository.instance;
  }

  // ==========================================
  // Groups
  // ==========================================

  getGroups(): Group[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GROUP_CHAT_GROUPS);
      if (!raw) return [];
      const parsed: GroupData[] = JSON.parse(raw);
      return parsed
        .map((g) => Group.fromJSON(g))
        .sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    } catch (e) {
      console.error('Failed to parse groups', e);
      return [];
    }
  }

  getGroup(id: string): Group | null {
    const groups = this.getGroups();
    return groups.find((g) => g.id === id) || null;
  }

  saveGroup(group: Group): void {
    const groups = this.getGroups();
    const index = groups.findIndex((g) => g.id === group.id);

    if (index >= 0) {
      groups[index] = group;
    } else {
      groups.push(group);
    }

    this.saveGroups(groups);
    this.notifyUpdate();
  }

  private saveGroups(groups: Group[]): void {
    localStorage.setItem(
      STORAGE_KEYS.GROUP_CHAT_GROUPS,
      JSON.stringify(groups.map((g) => g.toJSON()))
    );
  }

  deleteGroup(id: string): void {
    const groups = this.getGroups().filter((g) => g.id !== id);
    this.saveGroups(groups);

    // Also delete messages and members for this group
    const messages = this.getAllMessages().filter((m) => m.groupId !== id);
    this.saveMessages(messages);

    const members = this.getAllMembers().filter((m) => m.groupId !== id);
    this.saveAllMembers(members);

    this.notifyUpdate();
  }

  updateGroupLastMessage(groupId: string, text: string, timestamp: number): void {
    const group = this.getGroup(groupId);
    if (group) {
      // Only update if this message is newer than the current last message
      if (timestamp >= group.lastMessageTime) {
        group.lastMessageText = text;
        group.lastMessageTime = timestamp;
        this.saveGroup(group);
      }
    }
  }

  incrementUnreadCount(groupId: string): void {
    const group = this.getGroup(groupId);
    if (group) {
      group.unreadCount += 1;
      this.saveGroup(group);
    }
  }

  markGroupAsRead(groupId: string): void {
    const group = this.getGroup(groupId);
    if (group && group.unreadCount > 0) {
      group.unreadCount = 0;
      this.saveGroup(group);
    }
  }

  getTotalUnreadCount(): number {
    return this.getGroups().reduce((sum, g) => sum + g.unreadCount, 0);
  }

  // ==========================================
  // Messages
  // ==========================================

  private getAllMessages(): GroupMessage[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GROUP_CHAT_MESSAGES);
      if (!raw) return [];
      const parsed: GroupMessageData[] = JSON.parse(raw);
      return parsed.map((m) => GroupMessage.fromJSON(m));
    } catch (e) {
      console.error('Failed to parse group messages', e);
      return [];
    }
  }

  private saveMessages(messages: GroupMessage[]): void {
    localStorage.setItem(
      STORAGE_KEYS.GROUP_CHAT_MESSAGES,
      JSON.stringify(messages.map((m) => m.toJSON()))
    );
  }

  getMessagesForGroup(groupId: string): GroupMessage[] {
    return this.getAllMessages()
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getMessage(id: string): GroupMessage | null {
    return this.getAllMessages().find((m) => m.id === id) || null;
  }

  saveMessage(message: GroupMessage): void {
    const messages = this.getAllMessages();
    const index = messages.findIndex((m) => m.id === message.id);

    if (index >= 0) {
      messages[index] = message;
    } else {
      messages.push(message);
    }

    this.saveMessages(messages);

    // Update group's last message
    this.updateGroupLastMessage(
      message.groupId,
      message.content.slice(0, 100),
      message.timestamp
    );

    this.notifyUpdate();
  }

  deleteMessage(id: string): void {
    const messages = this.getAllMessages().filter((m) => m.id !== id);
    this.saveMessages(messages);
    this.notifyUpdate();
  }

  getRecentMessageIds(groupId: string, count: number = 3): string[] {
    return this.getMessagesForGroup(groupId)
      .slice(-count)
      .map((m) => m.id.slice(0, 8));
  }

  // ==========================================
  // Members
  // ==========================================

  private getAllMembers(): GroupMember[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GROUP_CHAT_MEMBERS);
      if (!raw) return [];
      const parsed: GroupMemberData[] = JSON.parse(raw);
      return parsed.map((m) => GroupMember.fromJSON(m));
    } catch (e) {
      console.error('Failed to parse group members', e);
      return [];
    }
  }

  private saveAllMembers(members: GroupMember[]): void {
    localStorage.setItem(
      STORAGE_KEYS.GROUP_CHAT_MEMBERS,
      JSON.stringify(members.map((m) => m.toJSON()))
    );
  }

  getMembersForGroup(groupId: string): GroupMember[] {
    return this.getAllMembers()
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  getMember(groupId: string, pubkey: string): GroupMember | null {
    return this.getAllMembers().find(
      (m) => m.groupId === groupId && m.pubkey === pubkey
    ) || null;
  }

  saveMember(member: GroupMember): void {
    const members = this.getAllMembers();
    const index = members.findIndex(
      (m) => m.groupId === member.groupId && m.pubkey === member.pubkey
    );

    if (index >= 0) {
      members[index] = member;
    } else {
      members.push(member);
    }

    this.saveAllMembers(members);

    // Update group member count
    const group = this.getGroup(member.groupId);
    if (group) {
      group.memberCount = this.getMembersForGroup(member.groupId).length;
      this.saveGroup(group);
    }
  }

  removeMember(groupId: string, pubkey: string): void {
    const members = this.getAllMembers().filter(
      (m) => !(m.groupId === groupId && m.pubkey === pubkey)
    );
    this.saveAllMembers(members);

    // Update group member count
    const group = this.getGroup(groupId);
    if (group) {
      group.memberCount = this.getMembersForGroup(groupId).length;
      this.saveGroup(group);
    }

    this.notifyUpdate();
  }

  // ==========================================
  // Processed Events (for deduplication)
  // ==========================================

  getProcessedEventIds(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GROUP_CHAT_PROCESSED_EVENTS);
      if (!raw) return new Set();
      return new Set(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to parse processed events', e);
      return new Set();
    }
  }

  addProcessedEventId(eventId: string): void {
    const processed = this.getProcessedEventIds();
    processed.add(eventId);

    // Keep only the last 10000 event IDs to prevent unbounded growth
    const arr = Array.from(processed);
    if (arr.length > 10000) {
      arr.splice(0, arr.length - 10000);
    }

    localStorage.setItem(
      STORAGE_KEYS.GROUP_CHAT_PROCESSED_EVENTS,
      JSON.stringify(arr)
    );
  }

  isEventProcessed(eventId: string): boolean {
    return this.getProcessedEventIds().has(eventId);
  }

  // ==========================================
  // Event Notifications
  // ==========================================

  private notifyUpdate(): void {
    window.dispatchEvent(new CustomEvent('group-chat-updated'));
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  clearAllData(): void {
    localStorage.removeItem(STORAGE_KEYS.GROUP_CHAT_GROUPS);
    localStorage.removeItem(STORAGE_KEYS.GROUP_CHAT_MESSAGES);
    localStorage.removeItem(STORAGE_KEYS.GROUP_CHAT_MEMBERS);
    localStorage.removeItem(STORAGE_KEYS.GROUP_CHAT_PROCESSED_EVENTS);
    this.notifyUpdate();
  }

  /**
   * Check if the relay URL has changed since last use.
   * If changed, clear all cached group chat data to avoid stale data from old relay.
   * Also clears if any stored groups have a different relay URL than the current one.
   * @param currentRelayUrl The current configured relay URL
   * @returns true if data was cleared due to relay change, false otherwise
   */
  checkAndClearOnRelayChange(currentRelayUrl: string): boolean {
    const storedRelayUrl = localStorage.getItem(STORAGE_KEYS.GROUP_CHAT_RELAY_URL);

    // Check if stored relay URL differs
    if (storedRelayUrl && storedRelayUrl !== currentRelayUrl) {
      console.log(
        `🔄 Group chat relay URL changed from ${storedRelayUrl} to ${currentRelayUrl}, clearing cached data`
      );
      this.clearAllData();
      localStorage.setItem(STORAGE_KEYS.GROUP_CHAT_RELAY_URL, currentRelayUrl);
      return true;
    }

    // Also check if any stored groups have a different relay URL (handles edge cases)
    const groups = this.getGroups();
    const hasStaleGroups = groups.some((g) => g.relayUrl && g.relayUrl !== currentRelayUrl);
    if (hasStaleGroups) {
      console.log(
        `🔄 Found groups from different relay, clearing cached data for ${currentRelayUrl}`
      );
      this.clearAllData();
      localStorage.setItem(STORAGE_KEYS.GROUP_CHAT_RELAY_URL, currentRelayUrl);
      return true;
    }

    // Store current relay URL if not set
    if (!storedRelayUrl) {
      localStorage.setItem(STORAGE_KEYS.GROUP_CHAT_RELAY_URL, currentRelayUrl);
    }

    return false;
  }
}
