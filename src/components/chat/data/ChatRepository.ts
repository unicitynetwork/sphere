import {
  ChatConversation,
  ChatMessage,
  MessageStatus,
  type ChatConversationData,
  type ChatMessageData,
} from './models';
import { STORAGE_KEYS } from '../../../config/storageKeys';

export class ChatRepository {
  private static instance: ChatRepository;

  private constructor() {}

  static getInstance(): ChatRepository {
    if (!ChatRepository.instance) {
      ChatRepository.instance = new ChatRepository();
    }
    return ChatRepository.instance;
  }

  // ==========================================
  // Conversations
  // ==========================================

  getConversations(): ChatConversation[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CHAT_CONVERSATIONS);
      if (!raw) return [];
      const parsed: ChatConversationData[] = JSON.parse(raw);
      return parsed
        .map((c) => ChatConversation.fromJSON(c))
        .sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    } catch (e) {
      console.error('Failed to parse conversations', e);
      return [];
    }
  }

  getConversation(id: string): ChatConversation | null {
    const conversations = this.getConversations();
    return conversations.find((c) => c.id === id) || null;
  }

  getConversationByPubkey(pubkey: string): ChatConversation | null {
    const conversations = this.getConversations();
    return conversations.find((c) => c.participantPubkey === pubkey) || null;
  }

  saveConversation(conversation: ChatConversation): void {
    const conversations = this.getConversations();
    const index = conversations.findIndex((c) => c.id === conversation.id);

    if (index >= 0) {
      conversations[index] = conversation;
    } else {
      conversations.push(conversation);
    }

    this.saveConversations(conversations);
    this.notifyUpdate();
  }

  private saveConversations(conversations: ChatConversation[]): void {
    localStorage.setItem(
      STORAGE_KEYS.CHAT_CONVERSATIONS,
      JSON.stringify(conversations.map((c) => c.toJSON()))
    );
  }

  deleteConversation(id: string): void {
    const conversations = this.getConversations().filter((c) => c.id !== id);
    this.saveConversations(conversations);

    // Also delete messages for this conversation
    const messages = this.getAllMessages().filter((m) => m.conversationId !== id);
    this.saveMessages(messages);

    this.notifyUpdate();
  }

  updateConversationLastMessage(conversationId: string, text: string, timestamp: number): void {
    const conversation = this.getConversation(conversationId);
    if (conversation) {
      // Only update if this message is newer than the current last message
      if (timestamp >= conversation.lastMessageTime) {
        conversation.lastMessageText = text;
        conversation.lastMessageTime = timestamp;
        this.saveConversation(conversation);
      }
    }
  }

  incrementUnreadCount(conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation) {
      conversation.unreadCount += 1;
      this.saveConversation(conversation);
    }
  }

  markConversationAsRead(conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation && conversation.unreadCount > 0) {
      conversation.unreadCount = 0;
      this.saveConversation(conversation);
    }
  }

  updateConversationNametag(conversationId: string, nametag: string): void {
    const conversation = this.getConversation(conversationId);
    if (conversation) {
      conversation.participantNametag = nametag;
      this.saveConversation(conversation);
    }
  }

  getTotalUnreadCount(): number {
    return this.getConversations().reduce((sum, c) => sum + c.unreadCount, 0);
  }

  // ==========================================
  // Messages
  // ==========================================

  private getAllMessages(): ChatMessage[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES);
      if (!raw) return [];
      const parsed: ChatMessageData[] = JSON.parse(raw);
      return parsed.map((m) => ChatMessage.fromJSON(m));
    } catch (e) {
      console.error('Failed to parse messages', e);
      return [];
    }
  }

  private saveMessages(messages: ChatMessage[]): void {
    localStorage.setItem(STORAGE_KEYS.CHAT_MESSAGES, JSON.stringify(messages.map((m) => m.toJSON())));
  }

  getMessagesForConversation(conversationId: string): ChatMessage[] {
    return this.getAllMessages()
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getMessage(id: string): ChatMessage | null {
    return this.getAllMessages().find((m) => m.id === id) || null;
  }

  saveMessage(message: ChatMessage): void {
    const messages = this.getAllMessages();
    const index = messages.findIndex((m) => m.id === message.id);

    if (index >= 0) {
      messages[index] = message;
    } else {
      messages.push(message);
    }

    this.saveMessages(messages);

    // Update conversation's last message
    this.updateConversationLastMessage(
      message.conversationId,
      message.content.slice(0, 100),
      message.timestamp
    );

    this.notifyUpdate();
  }

  updateMessageStatus(messageId: string, status: MessageStatus): void {
    const message = this.getMessage(messageId);
    if (message) {
      message.status = status;
      const messages = this.getAllMessages();
      const index = messages.findIndex((m) => m.id === messageId);
      if (index >= 0) {
        messages[index] = message;
        this.saveMessages(messages);
        this.notifyUpdate();
      }
    }
  }

  deleteMessage(id: string): void {
    const messages = this.getAllMessages().filter((m) => m.id !== id);
    this.saveMessages(messages);
    this.notifyUpdate();
  }

  // ==========================================
  // Event Notifications
  // ==========================================

  private notifyUpdate(): void {
    window.dispatchEvent(new CustomEvent('chat-updated'));
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  getOrCreateConversation(
    pubkey: string,
    nametag?: string,
    name?: string
  ): ChatConversation {
    let conversation = this.getConversationByPubkey(pubkey);

    if (!conversation) {
      conversation = new ChatConversation({
        participantPubkey: pubkey,
        participantNametag: nametag,
        participantName: name,
      });
      this.saveConversation(conversation);
    } else if (nametag && !conversation.participantNametag) {
      // Update nametag if we learned it
      conversation.participantNametag = nametag;
      this.saveConversation(conversation);
    }

    return conversation;
  }

  clearAllData(): void {
    localStorage.removeItem(STORAGE_KEYS.CHAT_CONVERSATIONS);
    localStorage.removeItem(STORAGE_KEYS.CHAT_MESSAGES);
    this.notifyUpdate();
  }
}
