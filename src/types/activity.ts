export type ActivityKind =
  | 'marketplace_post'
  | 'marketplace_offer'
  | 'token_transfer'
  | 'wallet_created'
  | 'game_started'
  | 'bet_placed'
  | 'otc_purchase'
  | 'merch_order'
  | 'pokemon_purchase';

export interface Activity {
  id: number;
  kind: ActivityKind;
  unicityId: string | null;
  data: Record<string, unknown> | null;
  isPublic: boolean | null;
  createdAt: string;
}

export interface GetActivitiesResponse {
  activities: Activity[];
  nextCursor: string | null;
}

export interface CreateActivityRequest {
  kind: ActivityKind;
  unicityId?: string;
  data?: Record<string, unknown>;
  isPublic?: boolean;
}

export interface CreateActivityResponse {
  id: number;
  createdAt: string;
}
