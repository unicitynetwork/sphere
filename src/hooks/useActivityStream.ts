import { useEffect, useRef, useCallback } from 'react';
import { ActivityService } from '../services/ActivityService';
import type { Activity } from '../types/activity';

interface UseActivityStreamOptions {
  onActivity: (activity: Activity) => void;
  enabled?: boolean;
  lastId?: string;
}

export function useActivityStream(options: UseActivityStreamOptions) {
  const { onActivity, enabled = true, lastId } = options;
  const eventSourceRef = useRef<EventSource | null>(null);
  const onActivityRef = useRef(onActivity);

  // Keep callback ref updated
  onActivityRef.current = onActivity;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = ActivityService.createEventSource(lastId);

    eventSource.onmessage = (event) => {
      try {
        const activity = JSON.parse(event.data) as Activity;
        onActivityRef.current(activity);
      } catch (err) {
        console.error('Failed to parse activity:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      // EventSource will auto-reconnect
    };

    eventSourceRef.current = eventSource;
  }, [lastId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connect]);

  return {
    reconnect: connect,
  };
}
