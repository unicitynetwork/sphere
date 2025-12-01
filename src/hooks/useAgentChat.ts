import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getTriviaMockResponse, getAmaMockResponse, getDefaultMockResponse, getGamesMockResponse } from '../data/agentsMockData';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status?: string;
  thinking?: string;
}

interface UseAgentChatOptions {
  activityId: string;
  userId?: string;
  onMessage?: (message: ChatMessage) => void;
}

// Get agent mode from env (default: real)
export function getAgentMode(): 'mock' | 'real' {
  const useMock = import.meta.env.VITE_USE_MOCK_AGENTS;
  return useMock === 'true' ? 'mock' : 'real';
}

// Get API URL
export function getAgentApiUrl(): string {
  return import.meta.env.VITE_AGENT_API_URL || 'http://localhost:3000';
}

export function useAgentChat({ activityId, userId }: UseAgentChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  // Use provided userId (Unicity ID) or fallback to session UUID
  const fallbackUserIdRef = useRef<string>(uuidv4());
  const effectiveUserId = userId || fallbackUserIdRef.current;
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setCurrentStatus(null);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    const mode = getAgentMode();

    // Create user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Create placeholder for assistant response
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsStreaming(true);
    setCurrentStatus('Thinking...');

    if (mode === 'mock') {
      // Mock mode - simulate response
      await new Promise(resolve => setTimeout(resolve, 1000));

      const mockResponse = getMockResponse(activityId, content);

      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessage.id
          ? { ...msg, content: mockResponse }
          : msg
      ));
      setIsStreaming(false);
      setCurrentStatus(null);
      return;
    }

    // Real mode - call API with SSE
    try {
      abortControllerRef.current = new AbortController();
      const apiUrl = getAgentApiUrl();
      const allMessages = [...messages, userMessage].map(m => ({
        id: m.id,
        role: m.role,
        content: [{ type: 'text', text: m.content }],
        timestamp: m.timestamp,
      }));

      const response = await fetch(`${apiUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityId,
          userId: effectiveUserId,
          messages: allMessages,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));

            switch (data.type) {
              case 'text-delta':
                accumulatedText += data.text;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessage.id
                    ? { ...msg, content: accumulatedText }
                    : msg
                ));
                break;
              case 'tool-call':
                setCurrentStatus(`Using ${data.toolName}...`);
                break;
              case 'reasoning':
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessage.id
                    ? { ...msg, thinking: (msg.thinking || '') + data.text }
                    : msg
                ));
                break;
              case 'done':
                setIsStreaming(false);
                setCurrentStatus(null);
                break;
              case 'error':
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessage.id
                    ? { ...msg, content: `Error: ${data.message}` }
                    : msg
                ));
                setIsStreaming(false);
                setCurrentStatus(null);
                break;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (error) {
      // Don't show error if user aborted
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessage.id
          ? { ...msg, content: `Failed to connect to agent server. Make sure agentic-chatbot is running.` }
          : msg
      ));
      setIsStreaming(false);
      setCurrentStatus(null);
    }
  }, [activityId, messages, effectiveUserId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    setMessages,
    isStreaming,
    currentStatus,
    sendMessage,
    clearMessages,
    stopGeneration,
    agentMode: getAgentMode(),
  };
}

// Mock responses for different activities
function getMockResponse(activityId: string, userInput: string): string {
  switch (activityId) {
    case 'trivia':
      return getTriviaMockResponse(userInput);
    case 'games':
      return getGamesMockResponse(userInput);
    case 'ama':
      return getAmaMockResponse();
    default:
      return getDefaultMockResponse();
  }
}
