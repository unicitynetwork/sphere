/**
 * ChatHistoryRepository - localStorage-based persistent storage for agent chat history
 * with IPFS sync support for cross-device synchronization
 *
 * Storage structure:
 * - Key: `sphere_agent_chat_sessions` - Array of all chat sessions metadata
 * - Key: `sphere_agent_chat_messages:${sessionId}` - Messages for each session
 *
 * Features:
 * - Automatic cleanup when storage limit is approached
 * - Session management (create, continue, delete)
 * - Search through chat history
 * - IPFS sync for cross-device synchronization (when enabled)
 */

import type { ChatMessage } from '../../../hooks/useAgentChat';
import {
  ChatHistoryIpfsService,
  type ChatSessionData as IpfsChatSessionData,
  type SyncResult,
} from './ChatHistoryIpfsService';

// Maximum storage size (in bytes) before cleanup is triggered - ~4MB to leave room
const MAX_STORAGE_SIZE = 4 * 1024 * 1024;
// Maximum number of sessions to keep per agent
const MAX_SESSIONS_PER_AGENT = 50;
// Storage keys
const SESSIONS_KEY = 'sphere_agent_chat_sessions';
const MESSAGES_KEY_PREFIX = 'sphere_agent_chat_messages';

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
  private ipfsService: ChatHistoryIpfsService;
  private ipfsSyncEnabled = false;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSync = false;

  private constructor() {
    this.ipfsService = ChatHistoryIpfsService.getInstance();
  }

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
    return `${MESSAGES_KEY_PREFIX}:${sessionId}`;
  }

  // ==========================================
  // Session Management
  // ==========================================

  getAllSessions(): ChatSession[] {
    if (!this.isLocalStorageAvailable()) return [];

    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
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
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
      if (e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn('[ChatHistory] Storage quota exceeded, triggering cleanup');
        this.cleanupOldSessions();
        // Retry once
        try {
          localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
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
    localStorage.removeItem(SESSIONS_KEY);
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

    // Check storage size before saving
    if (this.getStorageSize() > MAX_STORAGE_SIZE) {
      this.cleanupOldSessions();
    }

    try {
      localStorage.setItem(this.getMessagesKey(sessionId), JSON.stringify(messages));

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
          localStorage.setItem(this.getMessagesKey(sessionId), JSON.stringify(messages));
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

    let sessions = agentId ? this.getSessionsForAgent(agentId, userId) : this.getAllSessions();

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
    // Schedule IPFS sync if enabled
    this.scheduleIpfsSync();
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

  // ==========================================
  // IPFS Sync Methods
  // ==========================================

  /**
   * Initialize IPFS sync for a user
   * @param seedPhrase - User's seed phrase for IPFS key derivation
   * @param userId - User identifier (nametag)
   */
  async initializeIpfsSync(seedPhrase: string, userId: string): Promise<boolean> {
    try {
      const success = await this.ipfsService.initialize(seedPhrase, userId);
      if (success) {
        this.ipfsSyncEnabled = true;
        console.log('[ChatHistory] IPFS sync initialized');
      }
      return success;
    } catch (error) {
      console.error('[ChatHistory] Failed to initialize IPFS sync:', error);
      return false;
    }
  }

  /**
   * Check if IPFS sync is enabled
   */
  isIpfsSyncEnabled(): boolean {
    return this.ipfsSyncEnabled && this.ipfsService.isInitialized();
  }

  /**
   * Get IPFS service status
   */
  getIpfsStatus() {
    return this.ipfsService.getStatus();
  }

  /**
   * Sync local history with IPFS
   * Called automatically on changes when IPFS is enabled
   */
  async syncWithIpfs(): Promise<SyncResult | null> {
    if (!this.isIpfsSyncEnabled()) {
      return null;
    }

    try {
      // Get all sessions with messages for current user
      const userId = this.ipfsService.getCurrentUserId();
      if (!userId) return null;

      const sessions = this.getAllSessions()
        .filter(s => s.userId === userId)
        .map(s => this.getSessionWithMessages(s.id))
        .filter((s): s is IpfsChatSessionData => s !== null);

      // Sync with IPFS
      const { sessions: mergedSessions, synced } = await this.ipfsService.sync(sessions);

      if (synced && mergedSessions.length > 0) {
        // Update local storage with merged data
        this.importFromIpfs(mergedSessions);
      }

      return this.ipfsService.getStatus().lastSync;
    } catch (error) {
      console.error('[ChatHistory] IPFS sync failed:', error);
      return null;
    }
  }

  /**
   * Schedule a debounced IPFS sync
   */
  private scheduleIpfsSync(): void {
    if (!this.isIpfsSyncEnabled()) return;

    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = setTimeout(async () => {
      if (this.pendingSync) return;
      this.pendingSync = true;

      try {
        await this.syncWithIpfs();
      } finally {
        this.pendingSync = false;
      }
    }, 5000); // 5 second debounce
  }

  /**
   * Force an immediate IPFS sync (for manual sync button)
   */
  async forceIpfsSync(): Promise<SyncResult | null> {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }

    return this.syncWithIpfs();
  }

  /**
   * Restore history from IPFS (initial load)
   */
  async restoreFromIpfs(): Promise<boolean> {
    if (!this.isIpfsSyncEnabled()) {
      return false;
    }

    try {
      const result = await this.ipfsService.restore();
      if (result.success && result.sessions) {
        this.importFromIpfs(result.sessions);
        console.log(`[ChatHistory] Restored ${result.sessions.length} sessions from IPFS`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[ChatHistory] Failed to restore from IPFS:', error);
      return false;
    }
  }

  /**
   * Import sessions from IPFS into local storage
   */
  private importFromIpfs(sessions: IpfsChatSessionData[]): void {
    if (!this.isLocalStorageAvailable()) return;

    const existingSessions = this.getAllSessions();
    const existingIds = new Set(existingSessions.map(s => s.id));

    // Merge sessions
    for (const session of sessions) {
      if (existingIds.has(session.id)) {
        // Update existing session if remote is newer
        const existing = existingSessions.find(s => s.id === session.id);
        if (existing && session.updatedAt > existing.updatedAt) {
          // Update session metadata
          const idx = existingSessions.findIndex(s => s.id === session.id);
          if (idx >= 0) {
            existingSessions[idx] = {
              id: session.id,
              agentId: session.agentId,
              userId: session.userId,
              title: session.title,
              preview: session.preview,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              messageCount: session.messageCount,
            };
          }
          // Update messages
          localStorage.setItem(
            this.getMessagesKey(session.id),
            JSON.stringify(session.messages)
          );
        }
      } else {
        // Add new session
        existingSessions.push({
          id: session.id,
          agentId: session.agentId,
          userId: session.userId,
          title: session.title,
          preview: session.preview,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messageCount,
        });
        // Add messages
        localStorage.setItem(
          this.getMessagesKey(session.id),
          JSON.stringify(session.messages)
        );
      }
    }

    // Sort by updatedAt and save
    existingSessions.sort((a, b) => b.updatedAt - a.updatedAt);
    this.saveSessions(existingSessions);
    this.notifyUpdate();
  }

  /**
   * Disable IPFS sync (e.g., on logout)
   */
  disableIpfsSync(): void {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    this.ipfsSyncEnabled = false;
    ChatHistoryIpfsService.resetInstance();
    this.ipfsService = ChatHistoryIpfsService.getInstance();
  }
}

// Export singleton instance
export const chatHistoryRepository = ChatHistoryRepository.getInstance();
