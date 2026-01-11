import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { STORAGE_KEYS, STORAGE_KEY_GENERATORS } from "../../../../../src/config/storageKeys";

// ==========================================
// Mock Setup
// ==========================================

// Mock ChatHistoryIpfsService before importing ChatHistoryRepository
vi.mock("../../../../../src/components/agents/shared/ChatHistoryIpfsService", () => ({
  getChatHistoryIpfsService: vi.fn(() => ({
    syncImmediately: vi.fn().mockResolvedValue({ success: true }),
    scheduleSync: vi.fn(),
    recordSessionDeletion: vi.fn(),
    recordBulkDeletion: vi.fn(),
  })),
}));

// Import after mocking
import {
  ChatHistoryRepository,
  chatHistoryRepository,
  type ChatSession,
} from "../../../../../src/components/agents/shared/ChatHistoryRepository";
import type { ChatMessage } from "../../../../../src/hooks/useAgentChat";

// ==========================================
// Test Fixtures
// ==========================================

const createMockMessage = (
  id: string,
  role: "user" | "assistant" = "user",
  content: string = "Test message"
): ChatMessage => ({
  id,
  role,
  content,
  timestamp: Date.now(),
});

const createMockSession = (
  id: string,
  agentId: string = "agent-1",
  userId: string = "user-1"
): ChatSession => ({
  id,
  agentId,
  userId,
  title: "Test Session",
  preview: "Test preview",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messageCount: 0,
});

// ==========================================
// ChatHistoryRepository Tests
// ==========================================

describe("ChatHistoryRepository", () => {
  let localStorageMock: Record<string, string>;
  let repository: ChatHistoryRepository;

  beforeEach(() => {
    localStorageMock = {};

    // Mock localStorage
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn((index: number) => Object.keys(localStorageMock)[index] || null),
      get length() {
        return Object.keys(localStorageMock).length;
      },
    });

    // Mock window.dispatchEvent
    vi.stubGlobal("window", {
      ...globalThis.window,
      dispatchEvent: vi.fn(),
    });

    // Get fresh instance for each test
    repository = ChatHistoryRepository.getInstance();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================
  // Singleton Tests
  // ==========================================

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = ChatHistoryRepository.getInstance();
      const instance2 = ChatHistoryRepository.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should export chatHistoryRepository as singleton", () => {
      expect(chatHistoryRepository).toBe(ChatHistoryRepository.getInstance());
    });
  });

  // ==========================================
  // Session Management Tests
  // ==========================================

  describe("getAllSessions", () => {
    it("should return empty array when no sessions exist", () => {
      const sessions = repository.getAllSessions();

      expect(sessions).toEqual([]);
    });

    it("should return sessions sorted by updatedAt descending", () => {
      const now = Date.now();
      const sessions: ChatSession[] = [
        { ...createMockSession("1"), updatedAt: now - 2000 },
        { ...createMockSession("2"), updatedAt: now },
        { ...createMockSession("3"), updatedAt: now - 1000 },
      ];

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.getAllSessions();

      expect(result[0].id).toBe("2"); // Most recent
      expect(result[1].id).toBe("3");
      expect(result[2].id).toBe("1"); // Oldest
    });

    it("should return empty array on parse error", () => {
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = "invalid json";

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const sessions = repository.getAllSessions();

      expect(sessions).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("getSessionsForAgent", () => {
    it("should filter sessions by agentId", () => {
      const sessions: ChatSession[] = [
        createMockSession("1", "agent-1", "user-1"),
        createMockSession("2", "agent-2", "user-1"),
        createMockSession("3", "agent-1", "user-2"),
      ];

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.getSessionsForAgent("agent-1");

      expect(result).toHaveLength(2);
      expect(result.every(s => s.agentId === "agent-1")).toBe(true);
    });

    it("should filter by both agentId and userId when userId provided", () => {
      const sessions: ChatSession[] = [
        createMockSession("1", "agent-1", "user-1"),
        createMockSession("2", "agent-1", "user-2"),
        createMockSession("3", "agent-2", "user-1"),
      ];

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.getSessionsForAgent("agent-1", "user-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });
  });

  describe("getSession", () => {
    it("should return session by id", () => {
      const sessions: ChatSession[] = [
        createMockSession("session-1"),
        createMockSession("session-2"),
      ];

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.getSession("session-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-1");
    });

    it("should return null for non-existent session", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.getSession("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("createSession", () => {
    it("should create new session with generated id", () => {
      const session = repository.createSession("agent-1", "user-1");

      expect(session.id).toBeDefined();
      expect(session.agentId).toBe("agent-1");
      expect(session.userId).toBe("user-1");
      expect(session.title).toBe("New conversation");
    });

    it("should create session with initial message", () => {
      const initialMessage = createMockMessage("msg-1", "user", "Hello!");

      const session = repository.createSession("agent-1", "user-1", initialMessage);

      expect(session.title).toBe("Hello!");
      expect(session.preview).toBe("Hello!");
      expect(session.messageCount).toBe(1);
    });

    it("should truncate long titles", () => {
      const longContent = "A".repeat(50);
      const initialMessage = createMockMessage("msg-1", "user", longContent);

      const session = repository.createSession("agent-1", "user-1", initialMessage);

      expect(session.title.length).toBeLessThanOrEqual(40);
      expect(session.title).toContain("...");
    });

    it("should dispatch update event", () => {
      repository.createSession("agent-1", "user-1");

      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });

  describe("updateSession", () => {
    it("should update session properties", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      repository.updateSession("session-1", {
        title: "Updated Title",
        messageCount: 5,
      });

      const updated = repository.getSession("session-1");
      expect(updated?.title).toBe("Updated Title");
      expect(updated?.messageCount).toBe(5);
    });

    it("should update updatedAt timestamp", () => {
      const oldTime = Date.now() - 10000;
      const sessions: ChatSession[] = [
        { ...createMockSession("session-1"), updatedAt: oldTime },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      repository.updateSession("session-1", { title: "New Title" });

      const updated = repository.getSession("session-1");
      expect(updated?.updatedAt).toBeGreaterThan(oldTime);
    });

    it("should not throw for non-existent session", () => {
      expect(() => {
        repository.updateSession("non-existent", { title: "Test" });
      }).not.toThrow();
    });
  });

  describe("deleteSession", () => {
    it("should remove session from storage", () => {
      const sessions: ChatSession[] = [
        createMockSession("session-1"),
        createMockSession("session-2"),
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      repository.deleteSession("session-1");

      const remaining = repository.getAllSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("session-2");
    });

    it("should remove messages for deleted session", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] = "[]";

      repository.deleteSession("session-1");

      expect(localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")]).toBeUndefined();
    });
  });

  describe("deleteAllSessionsForAgent", () => {
    it("should delete all sessions for specific agent", () => {
      const sessions: ChatSession[] = [
        createMockSession("1", "agent-1", "user-1"),
        createMockSession("2", "agent-2", "user-1"),
        createMockSession("3", "agent-1", "user-1"),
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      repository.deleteAllSessionsForAgent("agent-1");

      const remaining = repository.getAllSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].agentId).toBe("agent-2");
    });

    it("should only delete sessions for specific user when userId provided", () => {
      const sessions: ChatSession[] = [
        createMockSession("1", "agent-1", "user-1"),
        createMockSession("2", "agent-1", "user-2"),
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      repository.deleteAllSessionsForAgent("agent-1", "user-1");

      const remaining = repository.getAllSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].userId).toBe("user-2");
    });
  });

  describe("clearAllHistory", () => {
    it("should remove all sessions and messages", () => {
      const sessions: ChatSession[] = [
        createMockSession("session-1"),
        createMockSession("session-2"),
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] = "[]";
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-2")] = "[]";

      repository.clearAllHistory();

      expect(localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS]).toBeUndefined();
      expect(localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")]).toBeUndefined();
      expect(localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-2")]).toBeUndefined();
    });
  });

  describe("clearAllLocalHistoryOnly", () => {
    it("should clear sessions without IPFS sync", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({});

      repository.clearAllLocalHistoryOnly();

      expect(localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS]).toBeUndefined();
      expect(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]).toBeUndefined();
    });
  });

  // ==========================================
  // Message Management Tests
  // ==========================================

  describe("getMessages", () => {
    it("should return empty array when no messages exist", () => {
      const messages = repository.getMessages("session-1");

      expect(messages).toEqual([]);
    });

    it("should return messages for session", () => {
      const mockMessages: ChatMessage[] = [
        createMockMessage("1", "user", "Hello"),
        createMockMessage("2", "assistant", "Hi there"),
      ];
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] =
        JSON.stringify(mockMessages);

      const messages = repository.getMessages("session-1");

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Hello");
    });
  });

  describe("saveMessages", () => {
    it("should save messages to localStorage", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const messages: ChatMessage[] = [
        createMockMessage("1", "user", "Test"),
      ];

      repository.saveMessages("session-1", messages);

      const saved = JSON.parse(
        localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")]
      );
      expect(saved).toHaveLength(1);
    });

    it("should trim messages exceeding MAX_MESSAGES_PER_SESSION", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      // Create 150 messages (exceeds limit of 100)
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 150; i++) {
        messages.push(createMockMessage(`msg-${i}`, "user", `Message ${i}`));
      }

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      repository.saveMessages("session-1", messages);

      const saved = JSON.parse(
        localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")]
      );

      // Should only store 100 most recent messages
      expect(saved).toHaveLength(100);
      // Should be the last 100 messages (msg-50 to msg-149)
      expect(saved[0].id).toBe("msg-50");
      expect(saved[99].id).toBe("msg-149");

      consoleSpy.mockRestore();
    });

    it("should update session metadata with full message count", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      // Create 150 messages
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 150; i++) {
        messages.push(createMockMessage(`msg-${i}`, "user", `Message ${i}`));
      }

      repository.saveMessages("session-1", messages);

      const session = repository.getSession("session-1");
      // messageCount should be full count, not trimmed
      expect(session?.messageCount).toBe(150);
    });

    it("should generate title from first user message", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const messages: ChatMessage[] = [
        createMockMessage("1", "user", "What is the weather?"),
        createMockMessage("2", "assistant", "I can help with that"),
      ];

      repository.saveMessages("session-1", messages);

      const session = repository.getSession("session-1");
      expect(session?.title).toBe("What is the weather?");
    });
  });

  describe("appendMessage", () => {
    it("should append new message to session", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const existingMessages: ChatMessage[] = [
        createMockMessage("1", "user", "Hello"),
      ];
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] =
        JSON.stringify(existingMessages);

      const newMessage = createMockMessage("2", "assistant", "Hi!");
      repository.appendMessage("session-1", newMessage);

      const messages = repository.getMessages("session-1");
      expect(messages).toHaveLength(2);
    });

    it("should update existing message by id", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const existingMessages: ChatMessage[] = [
        createMockMessage("msg-1", "assistant", "Original content"),
      ];
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] =
        JSON.stringify(existingMessages);

      const updatedMessage = createMockMessage("msg-1", "assistant", "Updated content");
      repository.appendMessage("session-1", updatedMessage);

      const messages = repository.getMessages("session-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Updated content");
    });
  });

  // ==========================================
  // Search Tests
  // ==========================================

  describe("searchSessions", () => {
    it("should return all sessions for empty query", () => {
      const sessions: ChatSession[] = [
        createMockSession("1"),
        createMockSession("2"),
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.searchSessions("");

      expect(result).toHaveLength(2);
    });

    it("should filter by query in title", () => {
      const sessions: ChatSession[] = [
        { ...createMockSession("1"), title: "Weather question" },
        { ...createMockSession("2"), title: "Coding help" },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.searchSessions("weather");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("should filter by query in preview", () => {
      const sessions: ChatSession[] = [
        { ...createMockSession("1"), title: "Chat", preview: "Tell me about weather" },
        { ...createMockSession("2"), title: "Chat", preview: "Help with code" },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.searchSessions("weather");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("should search in message content", () => {
      const sessions: ChatSession[] = [
        { ...createMockSession("session-1"), title: "Chat", preview: "..." },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const messages: ChatMessage[] = [
        createMockMessage("1", "user", "What is Python programming?"),
      ];
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] =
        JSON.stringify(messages);

      const result = repository.searchSessions("python");

      expect(result).toHaveLength(1);
    });

    it("should be case-insensitive", () => {
      const sessions: ChatSession[] = [
        { ...createMockSession("1"), title: "WEATHER Question" },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.searchSessions("weather");

      expect(result).toHaveLength(1);
    });

    it("should filter by agentId when provided", () => {
      const sessions: ChatSession[] = [
        { ...createMockSession("1", "agent-1"), title: "Weather" },
        { ...createMockSession("2", "agent-2"), title: "Weather" },
      ];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const result = repository.searchSessions("weather", "agent-1");

      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe("agent-1");
    });
  });

  // ==========================================
  // Full Session Data Tests
  // ==========================================

  describe("getSessionWithMessages", () => {
    it("should return session with messages", () => {
      const sessions: ChatSession[] = [createMockSession("session-1")];
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_SESSIONS] = JSON.stringify(sessions);

      const messages: ChatMessage[] = [
        createMockMessage("1", "user", "Hello"),
      ];
      localStorageMock[STORAGE_KEY_GENERATORS.agentChatMessages("session-1")] =
        JSON.stringify(messages);

      const result = repository.getSessionWithMessages("session-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-1");
      expect(result?.messages).toHaveLength(1);
    });

    it("should return null for non-existent session", () => {
      const result = repository.getSessionWithMessages("non-existent");

      expect(result).toBeNull();
    });
  });
});
