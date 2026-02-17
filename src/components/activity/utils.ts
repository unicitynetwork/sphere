import type { Activity, ActivityKind } from '../../types/activity';
import type { FeedListing } from '../../hooks/useMarketFeed';

export function getActivityTitle(kind: ActivityKind): string {
  switch (kind) {
    case 'marketplace_post':
      return 'New Listing';
    case 'marketplace_offer':
      return 'New Offer';
    // case 'token_transfer':
    //   return 'Token Transfer';
    case 'wallet_created':
      return 'New Wallet';
    case 'game_started':
      return 'Game Started';
    case 'merch_order':
      return 'Merch Order';
    default:
      return 'Activity';
  }
}

export function getActivityDescription(activity: Activity): string {
  const data = activity.data || {};

  switch (activity.kind) {
    case 'marketplace_post':
      if (data.title) {
        return `"${data.title}" posted for ${data.price} ${data.currency || 'ALPHA'}`;
      }
      return 'A new item was listed';
    case 'marketplace_offer':
      if (data.title && data.price) {
        return `Offer: ${data.price} ${data.currency || 'ALPHA'}`;
      }
      return 'New offer received';
    // case 'token_transfer':
    //   if (data.amount && data.symbol) {
    //     return `${data.amount} ${data.symbol}`;
    //   }
    //   return 'Tokens transferred';
    case 'wallet_created':
      return 'A new wallet joined the network';
    case 'game_started':
      if (data.gameName) {
        return `Someone started playing ${data.gameName}`;
      }
      return 'A game session started';
    case 'merch_order':
      if (data.itemName) {
        return `"${data.itemName}" ordered for ${data.price} ALPHA`;
      }
      return 'Merch was ordered';
    default:
      return 'Network activity';
  }
}

// ==========================================
// Market Feed (IntentType) helpers
// ==========================================

export function getIntentTitle(type: string): string {
  switch (type) {
    case 'sell':
      return 'Selling';
    case 'buy':
      return 'Buying';
    case 'service':
      return 'Service';
    case 'announcement':
      return 'Announcement';
    default:
      return 'Intent';
  }
}

export function getIntentDescription(listing: FeedListing): string {
  return listing.title || listing.descriptionPreview || 'New intent posted';
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
