/**
 * Proof Provider (Platform-Independent)
 *
 * Abstracts fetching of inclusion proofs from aggregator.
 * Platform implementations provide HTTP client abstraction.
 */

import type { ProofProvider } from './types';
import type { TxfInclusionProof } from '../types/txf';

// ==========================================
// Types
// ==========================================

/**
 * HTTP client abstraction for making requests
 */
export interface HttpClient {
  /**
   * Make a POST request
   * @param url - URL to request
   * @param body - Request body (will be JSON stringified)
   * @param options - Additional options
   * @returns Response data
   */
  post<T = unknown>(
    url: string,
    body: unknown,
    options?: HttpClientOptions
  ): Promise<T>;
}

/**
 * Options for HTTP requests
 */
export interface HttpClientOptions {
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * JSON-RPC request structure
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
  id: number | string;
}

/**
 * JSON-RPC response structure
 */
interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: number | string;
}

/**
 * Result of fetching a proof
 */
export interface ProofFetchResult {
  proof: TxfInclusionProof | null;
  error?: string;
}

/**
 * Configuration for AggregatorProofProvider
 */
export interface AggregatorProofProviderConfig {
  /** Aggregator URL (e.g., "https://alpha-aggregator.unicity.network") */
  aggregatorUrl: string;
  /** HTTP client for making requests */
  httpClient: HttpClient;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

// ==========================================
// Default HTTP Client (Fetch-based)
// ==========================================

/**
 * Default HTTP client using fetch API
 * Works in browser and Node.js 18+
 */
export class FetchHttpClient implements HttpClient {
  async post<T = unknown>(
    url: string,
    body: unknown,
    options?: HttpClientOptions
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = options?.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

// ==========================================
// AggregatorProofProvider
// ==========================================

/**
 * Fetches inclusion proofs from Unicity aggregator
 */
export class AggregatorProofProvider implements ProofProvider {
  private aggregatorUrl: string;
  private httpClient: HttpClient;
  private timeoutMs: number;

  constructor(config: AggregatorProofProviderConfig) {
    this.aggregatorUrl = config.aggregatorUrl.replace(/\/$/, ''); // Remove trailing slash
    this.httpClient = config.httpClient;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /**
   * Fetch inclusion proof from aggregator by state hash
   */
  async fetchProof(stateHash: string): Promise<unknown | null> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'getInclusionProof',
      params: { stateHash },
      id: Date.now(),
    };

    try {
      const response = await this.httpClient.post<JsonRpcResponse>(
        `${this.aggregatorUrl}/proof`,
        request,
        { timeoutMs: this.timeoutMs }
      );

      if (response.error) {
        console.warn(`📦 Proof fetch error for ${stateHash.slice(0, 12)}...: ${response.error.message}`);
        return null;
      }

      if (!response.result) {
        return null;
      }

      return response.result;
    } catch (error) {
      console.warn(
        `📦 Failed to fetch proof for ${stateHash.slice(0, 12)}...:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Fetch proofs for multiple state hashes
   * Returns a map of stateHash -> proof (null if not found)
   */
  async fetchProofBatch(
    stateHashes: string[]
  ): Promise<Map<string, unknown | null>> {
    const results = new Map<string, unknown | null>();

    // Fetch in parallel
    const promises = stateHashes.map(async (stateHash) => {
      const proof = await this.fetchProof(stateHash);
      return { stateHash, proof };
    });

    const settled = await Promise.allSettled(promises);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.set(result.value.stateHash, result.value.proof);
      } else {
        // Find the corresponding stateHash (based on order)
        const index = settled.indexOf(result);
        if (index >= 0 && index < stateHashes.length) {
          results.set(stateHashes[index], null);
        }
      }
    }

    return results;
  }

  /**
   * Check if aggregator is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to fetch proof for a dummy hash - we expect it to fail gracefully
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'getInclusionProof',
        params: { stateHash: '0000' + '0'.repeat(60) },
        id: Date.now(),
      };

      await this.httpClient.post<JsonRpcResponse>(
        `${this.aggregatorUrl}/proof`,
        request,
        { timeoutMs: 5000 }
      );

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the aggregator URL (for logging/debugging)
   */
  getAggregatorUrl(): string {
    return this.aggregatorUrl;
  }
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Fetch proof from aggregator using default fetch client
 * Convenience function for simple use cases
 */
export async function fetchProofFromAggregator(
  aggregatorUrl: string,
  stateHash: string,
  timeoutMs: number = 30000
): Promise<unknown | null> {
  const provider = new AggregatorProofProvider({
    aggregatorUrl,
    httpClient: new FetchHttpClient(),
    timeoutMs,
  });
  return provider.fetchProof(stateHash);
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an AggregatorProofProvider with default fetch client
 */
export function createAggregatorProofProvider(
  aggregatorUrl: string,
  timeoutMs?: number
): AggregatorProofProvider {
  return new AggregatorProofProvider({
    aggregatorUrl,
    httpClient: new FetchHttpClient(),
    timeoutMs,
  });
}
