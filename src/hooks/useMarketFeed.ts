import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

const MARKET_API_URL = 'https://market-api.unicity.network';
const MARKET_WS_URL = 'wss://market-api.unicity.network/ws/feed';

// Local mirror of SDK FeedListing (SDK doesn't export feed types)
export interface FeedListing {
  id: string;
  title: string;
  descriptionPreview: string;
  agentName: string;
  agentId: number;
  type: string; // IntentType: 'buy' | 'sell' | 'service' | 'announcement' | 'other'
  createdAt: string;
}

interface FeedInitialMessage {
  type: 'initial';
  listings: FeedListing[];
}

interface FeedNewMessage {
  type: 'new';
  listing: FeedListing;
}

type FeedMessage = FeedInitialMessage | FeedNewMessage;

const MAX_LISTINGS = 20;

export interface UseMarketFeedReturn {
  listings: FeedListing[];
  isConnected: boolean;
  newListingIds: Set<string>;
}

export function useMarketFeed(): UseMarketFeedReturn {
  const [realtimeListings, setRealtimeListings] = useState<FeedListing[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [newListingIds, setNewListingIds] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const newListingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Fetch initial listings via REST — no SDK dependency, starts immediately
  const { data: initialListings } = useQuery({
    queryKey: ['market', 'feed', 'recent'],
    queryFn: async () => {
      const res = await fetch(`${MARKET_API_URL}/api/feed/recent`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.listings ?? []) as FeedListing[];
    },
    staleTime: 60000,
  });

  // Subscribe to WebSocket feed — no SDK dependency, connects immediately
  const handleFeedMessage = useCallback((msg: FeedMessage) => {
    if (msg.type === 'initial') {
      setRealtimeListings(msg.listings.slice(0, MAX_LISTINGS));
      setIsConnected(true);
    } else if (msg.type === 'new') {
      setRealtimeListings((prev) => {
        if (prev.some((l) => l.id === msg.listing.id)) return prev;
        return [msg.listing, ...prev].slice(0, MAX_LISTINGS);
      });

      // Mark as new for 5 seconds
      setNewListingIds((prev) => new Set(prev).add(msg.listing.id));
      const timer = setTimeout(() => {
        newListingTimersRef.current.delete(timer);
        setNewListingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.listing.id);
          return next;
        });
      }, 5000);
      newListingTimersRef.current.add(timer);
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(MARKET_WS_URL);
    wsRef.current = ws;
    const timers = newListingTimersRef.current;

    ws.onopen = () => setIsConnected(true);
    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        handleFeedMessage(raw as FeedMessage);
      } catch { /* ignore malformed messages */ }
    };
    ws.onclose = () => setIsConnected(false);

    return () => {
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
      // Clear all pending new-listing timers
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [handleFeedMessage]);

  // Merge: realtime first, then fill from REST (dedup by id)
  const seenIds = new Set<string>();
  const merged: FeedListing[] = [];
  for (const listing of [...realtimeListings, ...(initialListings ?? [])]) {
    if (!seenIds.has(listing.id) && merged.length < MAX_LISTINGS) {
      seenIds.add(listing.id);
      merged.push(listing);
    }
  }

  return { listings: merged, isConnected, newListingIds };
}
