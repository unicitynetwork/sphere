/**
 * HTTP Client Implementations (Platform-Independent)
 *
 * Provides default HTTP client implementation using fetch API.
 * Can be replaced with axios or other clients in specific environments.
 */

import type {
  HttpClient,
  HttpResponse,
  HttpRequestOptions,
} from './types';

// ==========================================
// Fetch-based HTTP Client
// ==========================================

/**
 * Create a fetch-based HTTP client
 * Works in browser and Node.js 18+
 */
export function createFetchHttpClient(): HttpClient {
  return {
    async get<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
      const queryParams = options?.params
        ? "?" + new URLSearchParams(
            Object.entries(options.params).map(([k, v]) => [k, String(v)])
          ).toString()
        : "";

      const controller = new AbortController();
      const timeoutId = options?.timeout
        ? setTimeout(() => controller.abort(), options.timeout)
        : undefined;

      try {
        const response = await fetch(url + queryParams, {
          method: "GET",
          headers: options?.headers,
          signal: controller.signal,
        });

        let data: T;
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = (await response.text()) as unknown as T;
        }

        return {
          data,
          status: response.status,
          ok: response.ok,
        };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}

// ==========================================
// Axios Adapter
// ==========================================

/**
 * Create an HTTP client from an axios instance
 * Use this when axios is already in your project
 *
 * @param axiosInstance - Axios instance
 * @returns HTTP client wrapping axios
 */
export function createAxiosHttpClient(
  axiosInstance: {
    get: <T>(url: string, config?: {
      params?: Record<string, unknown>;
      timeout?: number;
      headers?: Record<string, string>;
    }) => Promise<{ data: T; status: number }>;
  }
): HttpClient {
  return {
    async get<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
      try {
        const response = await axiosInstance.get<T>(url, {
          params: options?.params,
          timeout: options?.timeout,
          headers: options?.headers,
        });

        return {
          data: response.data,
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
        };
      } catch (error) {
        // Handle axios errors
        const axiosError = error as {
          response?: { data: T; status: number };
          message?: string;
        };

        if (axiosError.response) {
          return {
            data: axiosError.response.data,
            status: axiosError.response.status,
            ok: false,
          };
        }

        throw error;
      }
    },
  };
}

// ==========================================
// Default Client
// ==========================================

let defaultClient: HttpClient | null = null;

/**
 * Get the default HTTP client (fetch-based)
 */
export function getDefaultHttpClient(): HttpClient {
  if (!defaultClient) {
    defaultClient = createFetchHttpClient();
  }
  return defaultClient;
}

/**
 * Set a custom default HTTP client
 */
export function setDefaultHttpClient(client: HttpClient): void {
  defaultClient = client;
}
