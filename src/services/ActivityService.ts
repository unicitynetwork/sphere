import type {
  CreateActivityRequest,
  CreateActivityResponse,
  GetActivitiesResponse,
} from '../types/activity';

const ACTIVITY_API_URL = import.meta.env.VITE_ACTIVITY_API_URL || 'http://localhost:3001/activities';

interface GetActivitiesOptions {
  limit?: number;
  cursor?: string;
  kind?: string;
}

/**
 * Record an activity with error handling (fire and forget).
 * This is a convenience wrapper that won't throw errors if the service is unavailable.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function recordActivity(..._args: unknown[]): Promise<void> {
  // Activity recording disabled — no activity service in use
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

    const url = `${ACTIVITY_API_URL}${params.toString() ? `?${params}` : ''}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.statusText}`);
    }

    return response.json();
  }

  static async postActivity(request: CreateActivityRequest): Promise<CreateActivityResponse> {
    // Browser requests are authenticated via Origin header on the backend
    // No API key needed for allowed origins
    const response = await fetch(ACTIVITY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    return new EventSource(`${ACTIVITY_API_URL}/stream${params}`);
  }
}

export const activityService = new ActivityService();
