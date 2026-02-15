/**
 * UI helper functions for SDK group chat plain data interfaces.
 * Replaces the class methods from the old Group/GroupMessage/GroupMember models.
 */
import type { GroupData, GroupMessageData, GroupMemberData } from '@unicitylabs/sphere-sdk';

// =============================================================================
// Group Helpers
// =============================================================================

export function getGroupDisplayName(group: GroupData): string {
  return group.name || group.id.slice(0, 8) + '...';
}

export function getGroupFormattedLastMessageTime(group: GroupData): string {
  const time = group.lastMessageTime;
  if (!time) return '';
  const date = new Date(time);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return date.toLocaleDateString();
}

// =============================================================================
// Message Helpers
// =============================================================================

export function getMessageFormattedTime(message: GroupMessageData): string {
  return new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getMessageFormattedDate(message: GroupMessageData): string {
  const date = new Date(message.timestamp);
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

export function getMessageSenderDisplayName(message: GroupMessageData): string {
  if (message.senderNametag) {
    return `@${message.senderNametag.replace('@', '')}`;
  }
  return message.senderPubkey.slice(0, 8) + '...';
}

export function getMessageSenderAvatar(message: GroupMessageData): string {
  const name = message.senderNametag || message.senderPubkey;
  return name.slice(0, 2).toUpperCase();
}

// =============================================================================
// Member Helpers
// =============================================================================

export function getMemberAvatar(member: GroupMemberData): string {
  const name = member.nametag || member.pubkey;
  return name.slice(0, 2).toUpperCase();
}
