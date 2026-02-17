import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../sdk/hooks/core/useSphere';

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
  const { sphere } = useSphereContext();
  const [realtimeListings, setRealtimeListings] = useState<FeedListing[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [newListingIds, setNewListingIds] = useState<Set<string>>(new Set());
  const unsubRef = useRef<(() => void) | null>(null);

  // Fetch initial listings via REST
  const { data: initialListings } = useQuery({
    queryKey: ['market', 'feed', 'recent'],
    queryFn: async () => {
      if (!sphere?.market) return [];
      return sphere.market.getRecentListings() as Promise<FeedListing[]>;
    },
    enabled: !!sphere?.market,
    staleTime: 60000,
  });

  // Subscribe to WebSocket feed
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
      setTimeout(() => {
        setNewListingIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.listing.id);
          return next;
        });
      }, 5000);
    }
  }, []);

  useEffect(() => {
    if (!sphere?.market) return;

    unsubRef.current = sphere.market.subscribeFeed(
      handleFeedMessage as (msg: unknown) => void,
    );
    setIsConnected(true);

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      setIsConnected(false);
    };
  }, [sphere, handleFeedMessage]);

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
