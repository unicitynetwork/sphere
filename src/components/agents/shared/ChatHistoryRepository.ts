/**
 * ChatHistoryRepository - localStorage-based persistent storage for agent chat history
 *
 * Storage structure:
 * - Key: `sphere_agent_chat_sessions` - Array of all chat sessions metadata
 * - Key: `sphere_agent_chat_messages:${sessionId}` - Messages for each session
 *
 * Features:
 * - Automatic cleanup when storage limit is approached
 * - Session management (create, continue, delete)
 * - Search through chat history
 * - Per-user history (bound to nametag)
 */

import type { ChatMessage } from '../../../hooks/useAgentChat';
import { STORAGE_KEYS, STORAGE_KEY_GENERATORS } from '../../../config/storageKeys';

// Maximum storage size (in bytes) before cleanup is triggered - ~4MB to leave room
const MAX_STORAGE_SIZE = 4 * 1024 * 1024;
// Maximum number of sessions to keep per agent
const MAX_SESSIONS_PER_AGENT = 50;
// Maximum messages per session in localStorage (full history on IPFS)
const MAX_MESSAGES_PER_SESSION = 100;

export interface ChatSession {
  id: string;
  agentId: string;
  userId: string; // nametag - each user has their own history
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatSessionData extends ChatSession {
  messages: ChatMessage[];
}

export class ChatHistoryRepository {
  private static instance: ChatHistoryRepository;

  private constructor() {}

  static getInstance(): ChatHistoryRepository {
    if (!ChatHistoryRepository.instance) {
      ChatHistoryRepository.instance = new ChatHistoryRepository();
    }
    return ChatHistoryRepository.instance;
  }

  // ==========================================
  // Storage Utilities
  // ==========================================

  private isLocalStorageAvailable(): boolean {
    try {
      const test = '__localStorage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  private getStorageSize(): number {
    let total = 0;
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        total += localStorage.getItem(key)?.length || 0;
      }
    }
    return total * 2; // UTF-16 characters are 2 bytes each
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private getMessagesKey(sessionId: string): string {
    return STORAGE_KEY_GENERATORS.agentChatMessages(sessionId);
  }

  // ==========================================
  // Session Management
  // ==========================================

  getAllSessions(): ChatSession[] {
    if (!this.isLocalStorageAvailable()) return [];

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS);
      if (!raw) return [];
      const sessions: ChatSession[] = JSON.parse(raw);
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
      console.error('[ChatHistory] Failed to parse sessions', e);
      return [];
    }
  }

  getSessionsForAgent(agentId: string, userId?: string): ChatSession[] {
    return this.getAllSessions().filter(s =>
      s.agentId === agentId && (userId ? s.userId === userId : true)
    );
  }

  getSession(sessionId: string): ChatSession | null {
    return this.getAllSessions().find(s => s.id === sessionId) || null;
  }

  private saveSessions(sessions: ChatSession[]): void {
    if (!this.isLocalStorageAvailable()) return;

    try {
      localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS, JSON.stringify(sessions));
    } catch (e) {
      if (e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn('[ChatHistory] Storage quota exceeded, triggering cleanup');
        this.cleanupOldSessions();
        // Retry once
        try {
          localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS, JSON.stringify(sessions));
        } catch {
          console.error('[ChatHistory] Failed to save sessions after cleanup');
        }
      } else {
        console.error('[ChatHistory] Failed to save sessions', e);
      }
    }
  }

  createSession(agentId: string, userId: string, initialMessage?: ChatMessage): ChatSession {
    const session: ChatSession = {
      id: this.generateId(),
      agentId,
      userId,
      title: this.generateTitle(initialMessage),
      preview: initialMessage?.content.slice(0, 100) || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: initialMessage ? 1 : 0,
    };

    console.log(`💬 [Repository] createSession: id=${session.id.slice(0, 8)}..., agentId=${agentId}, userId=${userId}`);

    const sessions = this.getAllSessions();
    sessions.unshift(session);
    this.saveSessions(sessions);

    if (initialMessage) {
      this.saveMessages(session.id, [initialMessage]);
    }

    this.notifyUpdate();
    return session;
  }

  updateSession(sessionId: string, updates: Partial<Pick<ChatSession, 'title' | 'preview' | 'messageCount'>>): void {
    const sessions = this.getAllSessions();
    const index = sessions.findIndex(s => s.id === sessionId);

    if (index >= 0) {
      sessions[index] = {
        ...sessions[index],
        ...updates,
        updatedAt: Date.now(),
      };
      this.saveSessions(sessions);
      this.notifyUpdate();
    }
  }

  deleteSession(sessionId: string): void {
    const sessions = this.getAllSessions().filter(s => s.id !== sessionId);
    this.saveSessions(sessions);

    // Delete messages for this session
    if (this.isLocalStorageAvailable()) {
      localStorage.removeItem(this.getMessagesKey(sessionId));
    }

    this.notifyUpdate();
  }

  deleteAllSessionsForAgent(agentId: string, userId?: string): void {
    const sessions = this.getAllSessions();
    const agentSessions = sessions.filter(s =>
      s.agentId === agentId && (userId ? s.userId === userId : true)
    );
    const otherSessions = sessions.filter(s =>
      !(s.agentId === agentId && (userId ? s.userId === userId : true))
    );

    // Delete messages for agent sessions
    agentSessions.forEach(s => {
      if (this.isLocalStorageAvailable()) {
        localStorage.removeItem(this.getMessagesKey(s.id));
      }
    });

    this.saveSessions(otherSessions);
    this.notifyUpdate();
  }

  clearAllHistory(): void {
    if (!this.isLocalStorageAvailable()) return;

    const sessions = this.getAllSessions();

    // Delete all message stores
    sessions.forEach(s => {
      localStorage.removeItem(this.getMessagesKey(s.id));
    });

    // Clear sessions
    localStorage.removeItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS);
    this.notifyUpdate();
  }

  /**
   * Clear all chat history from localStorage.
   * Use this when deleting wallet to clear local data.
   */
  clearAllLocalHistoryOnly(): void {
    if (!this.isLocalStorageAvailable()) return;

    const sessions = this.getAllSessions();

    // Delete all message stores
    sessions.forEach(s => {
      localStorage.removeItem(this.getMessagesKey(s.id));
    });

    // Clear sessions
    localStorage.removeItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS);

    this.notifyUpdate();
  }

  // ==========================================
  // Message Management
  // ==========================================

  getMessages(sessionId: string): ChatMessage[] {
    if (!this.isLocalStorageAvailable()) return [];

    try {
      const raw = localStorage.getItem(this.getMessagesKey(sessionId));
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.error('[ChatHistory] Failed to parse messages', e);
      return [];
    }
  }

  saveMessages(sessionId: string, messages: ChatMessage[]): void {
    if (!this.isLocalStorageAvailable()) return;

    // Get session info for logging
    const session = this.getSession(sessionId);
    const totalMessageCount = messages.length;
    console.log(`💬 [Repository] saveMessages: sessionId=${sessionId.slice(0, 8)}..., agentId=${session?.agentId || 'unknown'}, messageCount=${totalMessageCount}`);

    // Check storage size before saving
    if (this.getStorageSize() > MAX_STORAGE_SIZE) {
      this.cleanupOldSessions();
    }

    // Trim to MAX_MESSAGES_PER_SESSION for localStorage
    const messagesToStore = messages.length > MAX_MESSAGES_PER_SESSION
      ? messages.slice(-MAX_MESSAGES_PER_SESSION)
      : messages;

    if (messages.length > MAX_MESSAGES_PER_SESSION) {
      console.log(`💬 [Repository] Trimming ${messages.length} messages to ${MAX_MESSAGES_PER_SESSION} for localStorage`);
    }

    try {
      localStorage.setItem(this.getMessagesKey(sessionId), JSON.stringify(messagesToStore));

      // Update session metadata
      const lastMessage = messages[messages.length - 1];

      this.updateSession(sessionId, {
        title: this.generateTitleFromMessages(messages),
        preview: lastMessage?.content.slice(0, 100) || '',
        messageCount: messages.length,
      });
    } catch (e) {
      if (e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn('[ChatHistory] Storage quota exceeded, triggering cleanup');
        this.cleanupOldSessions();
        // Retry once
        try {
          localStorage.setItem(this.getMessagesKey(sessionId), JSON.stringify(messagesToStore));
        } catch {
          console.error('[ChatHistory] Failed to save messages after cleanup');
        }
      } else {
        console.error('[ChatHistory] Failed to save messages', e);
      }
    }
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    const messages = this.getMessages(sessionId);

    // Check if message already exists (by id)
    const existingIndex = messages.findIndex(m => m.id === message.id);
    if (existingIndex >= 0) {
      messages[existingIndex] = message;
    } else {
      messages.push(message);
    }

    this.saveMessages(sessionId, messages);
  }

  // ==========================================
  // Title Generation
  // ==========================================

  private generateTitle(message?: ChatMessage): string {
    if (!message || !message.content) {
      return 'New conversation';
    }

    // Use first user message as title, truncated
    const content = message.content.trim();
    if (content.length <= 40) {
      return content;
    }
    return content.slice(0, 37) + '...';
  }

  private generateTitleFromMessages(messages: ChatMessage[]): string {
    // Find first user message for title
    const firstUserMessage = messages.find(m => m.role === 'user');
    return this.generateTitle(firstUserMessage);
  }

  // ==========================================
  // Search
  // ==========================================

  searchSessions(query: string, agentId?: string, userId?: string): ChatSession[] {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return agentId ? this.getSessionsForAgent(agentId, userId) : this.getAllSessions();
    }

    const sessions = agentId ? this.getSessionsForAgent(agentId, userId) : this.getAllSessions();

    return sessions.filter(session => {
      // Check title and preview
      if (session.title.toLowerCase().includes(normalizedQuery) ||
          session.preview.toLowerCase().includes(normalizedQuery)) {
        return true;
      }

      // Search messages content
      const messages = this.getMessages(session.id);
      return messages.some(m => m.content.toLowerCase().includes(normalizedQuery));
    });
  }

  // ==========================================
  // Cleanup
  // ==========================================

  private cleanupOldSessions(): void {
    console.log('[ChatHistory] Running cleanup...');
    const sessions = this.getAllSessions();

    // Group by agent
    const byAgent: Record<string, ChatSession[]> = {};
    sessions.forEach(s => {
      if (!byAgent[s.agentId]) {
        byAgent[s.agentId] = [];
      }
      byAgent[s.agentId].push(s);
    });

    // Keep only MAX_SESSIONS_PER_AGENT per agent, delete oldest
    const toDelete: string[] = [];
    Object.values(byAgent).forEach(agentSessions => {
      if (agentSessions.length > MAX_SESSIONS_PER_AGENT) {
        // Sort by updatedAt, keep newest
        agentSessions.sort((a, b) => b.updatedAt - a.updatedAt);
        const toRemove = agentSessions.slice(MAX_SESSIONS_PER_AGENT);
        toRemove.forEach(s => toDelete.push(s.id));
      }
    });

    // Delete old sessions
    toDelete.forEach(id => {
      if (this.isLocalStorageAvailable()) {
        localStorage.removeItem(this.getMessagesKey(id));
      }
    });

    const remainingSessions = sessions.filter(s => !toDelete.includes(s.id));
    this.saveSessions(remainingSessions);

    console.log(`[ChatHistory] Cleaned up ${toDelete.length} old sessions`);
  }

  // ==========================================
  // Event Notifications
  // ==========================================

  private notifyUpdate(): void {
    window.dispatchEvent(new CustomEvent('agent-chat-history-updated'));
  }

  // ==========================================
  // Full Session Data
  // ==========================================

  getSessionWithMessages(sessionId: string): ChatSessionData | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    return {
      ...session,
      messages: this.getMessages(sessionId),
    };
  }
}

// Export singleton instance
export const chatHistoryRepository = ChatHistoryRepository.getInstance();
