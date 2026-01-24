import { useEffect, useRef, useCallback, useState } from 'react';
import { ActivityService } from '../services/ActivityService';
import type { Activity } from '../types/activity';

// Check if Activity API is explicitly configured (not using default localhost)
const isActivityApiConfigured = !!import.meta.env.VITE_ACTIVITY_API_URL;

interface UseActivityStreamOptions {
  onActivity: (activity: Activity) => void;
  enabled?: boolean;
  lastId?: string;
}

// Max reconnection attempts before giving up
const MAX_RECONNECT_ATTEMPTS = 3;
// Initial backoff delay in ms
const INITIAL_BACKOFF_MS = 1000;

export function useActivityStream(options: UseActivityStreamOptions) {
  const { onActivity, enabled = true, lastId } = options;
  const eventSourceRef = useRef<EventSource | null>(null);
  const onActivityRef = useRef(onActivity);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Keep callback ref updated
  onActivityRef.current = onActivity;

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Don't connect if Activity API is not configured
    if (!isActivityApiConfigured) {
      return;
    }

    clearReconnectTimeout();

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = ActivityService.createEventSource(lastId);

    eventSource.onopen = () => {
      // Reset reconnect attempts on successful connection
      reconnectAttempts.current = 0;
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const activity = JSON.parse(event.data) as Activity;
        onActivityRef.current(activity);
      } catch (err) {
        console.error('Failed to parse activity:', err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);

      // Close the current connection to prevent browser auto-reconnect
      eventSource.close();
      eventSourceRef.current = null;

      // Log only on first failure, then retry silently
      if (reconnectAttempts.current === 0) {
        console.warn('Activity SSE connection failed, will retry...');
      }

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current++;
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, reconnectAttempts.current - 1);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, backoffMs);
      } else {
        console.warn('Activity SSE: giving up after max attempts');
      }
    };

    eventSourceRef.current = eventSource;
  }, [lastId, clearReconnectTimeout]);

  useEffect(() => {
    // Don't connect if disabled or Activity API not configured
    if (!enabled || !isActivityApiConfigured) {
      return;
    }

    connect();

    return () => {
      clearReconnectTimeout();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connect, clearReconnectTimeout]);

  return {
    reconnect: connect,
    isConnected,
  };
}
