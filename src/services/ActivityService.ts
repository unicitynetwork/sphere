import type {
  Activity,
  CreateActivityRequest,
  CreateActivityResponse,
  GetActivitiesResponse,
} from '../types/activity';

const ACTIVITY_API_URL = import.meta.env.VITE_ACTIVITY_API_URL || 'http://localhost:3001';
const ACTIVITY_API_KEY = import.meta.env.VITE_ACTIVITY_API_KEY || '';

interface GetActivitiesOptions {
  limit?: number;
  cursor?: string;
  kind?: string;
}

/**
 * Record an activity with error handling (fire and forget).
 * This is a convenience wrapper that won't throw errors if the service is unavailable.
 */
export async function recordActivity(
  kind: Activity['kind'],
  options?: {
    unicityId?: string;
    data?: Record<string, unknown>;
    isPublic?: boolean;
  }
): Promise<void> {
  try {
    await ActivityService.postActivity({
      kind,
      unicityId: options?.unicityId,
      data: options?.data,
      isPublic: options?.isPublic,
    });
  } catch (error) {
    console.warn('Failed to record activity:', error);
  }
}

export class ActivityService {
  static async getActivities(options: GetActivitiesOptions = {}): Promise<GetActivitiesResponse> {
    const params = new URLSearchParams();

    if (options.limit) {
      params.set('limit', String(options.limit));
    }
    if (options.cursor) {
      params.set('cursor', options.cursor);
    }
    if (options.kind) {
      params.set('kind', options.kind);
    }

    const url = `${ACTIVITY_API_URL}/activities${params.toString() ? `?${params}` : ''}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.statusText}`);
    }

    return response.json();
  }

  static async postActivity(request: CreateActivityRequest): Promise<CreateActivityResponse> {
    if (!ACTIVITY_API_KEY) {
      console.warn('VITE_ACTIVITY_API_KEY not set, skipping activity post');
      return { id: 0, createdAt: new Date().toISOString() };
    }

    const response = await fetch(`${ACTIVITY_API_URL}/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACTIVITY_API_KEY}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Failed to post activity: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  static createEventSource(lastId?: string): EventSource {
    const params = lastId ? `?lastId=${lastId}` : '';
    return new EventSource(`${ACTIVITY_API_URL}/activities/stream${params}`);
  }
}

export const activityService = new ActivityService();
