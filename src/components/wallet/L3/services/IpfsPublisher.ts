/**
 * IPFS Publisher
 *
 * Handles fast publishing of token data to all configured IPFS nodes
 * using parallel multi-node strategy.
 *
 * Publishing flow:
 * 1. Store content on all nodes in parallel (~50-200ms)
 * 2. Publish IPNS records on all nodes in parallel (~100-300ms)
 * 3. Return after any successful publish
 *
 * Target: Complete publish in under 500ms
 */

import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";
import type { TxfStorageData } from "./types/TxfTypes";

/**
 * Race to first success: Returns immediately when ANY promise succeeds,
 * while letting remaining promises continue in the background.
 *
 * This is critical for IPFS sync performance - we don't need to wait for
 * all nodes when one has already succeeded. IPFS nodes sync between themselves.
 */
async function raceToFirstSuccess<T>(
  promises: Promise<{ success: boolean; result: T; gateway: string }>[]
): Promise<{
  success: boolean;
  result: T | null;
  gateway: string | null;
  backgroundPromises: Promise<{ success: boolean; result: T | null; gateway: string }>[];
}> {
  return new Promise((resolve) => {
    let resolved = false;

    // Track all promises for the fallback case
    const allPromises = promises.map((p) =>
      p.catch(() => ({ success: false, result: null as T, gateway: "" }))
    );

    // Attach success handlers to each promise
    promises.forEach((promise) => {
      promise
        .then((outcome) => {
          if (!resolved && outcome.success) {
            resolved = true;
            resolve({
              success: true,
              result: outcome.result,
              gateway: outcome.gateway,
              backgroundPromises: allPromises,
            });
          }
        })
        .catch(() => {
          // Individual failures are fine - we just need ONE success
        });
    });

    // Fallback: if ALL fail, resolve with failure after all complete
    Promise.allSettled(allPromises).then(() => {
      if (!resolved) {
        resolve({
          success: false,
          result: null,
          gateway: null,
          backgroundPromises: [],
        });
      }
    });
  });
}

export interface PublishResult {
  success: boolean;
  cid?: string;
  ipnsName?: string;
  publishedNodes: number;
  totalNodes: number;
  failedNodes: string[];
  latencyMs: number;
}

/**
 * Store content on a single gateway
 */
async function storeContentOnGateway(
  content: TxfStorageData,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(content)], {
      type: "application/json",
    });
    formData.append("file", blob);

    const response = await fetch(`${gatewayUrl}/api/v0/add`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Failed to store on ${gatewayUrl}: ${response.status}`);
      return null;
    }

    const json = (await response.json()) as { Hash?: string };
    return json.Hash || null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`Store content timeout on ${gatewayUrl}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Publish IPNS record on a single gateway
 */
async function publishIpnsOnGateway(
  cid: string,
  gatewayUrl: string,
  options: {
    keyName?: string;
    lifetime?: string; // e.g., "87660h" for 10 years
  } = {},
  timeoutMs: number = 5000
): Promise<{
  name: string;
  value: string;
} | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const lifetime = options.lifetime ?? "87660h";
    const keyParam = options.keyName ? `&key=${options.keyName}` : "";

    const url =
      `${gatewayUrl}/api/v0/name/publish?arg=/ipfs/${cid}` +
      `&lifetime=${lifetime}${keyParam}`;

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Failed to publish IPNS on ${gatewayUrl}: ${response.status}`);
      return null;
    }

    const json = (await response.json()) as {
      Name?: string;
      Value?: string;
    };

    if (!json.Name || !json.Value) {
      console.warn(`Invalid IPNS publish response from ${gatewayUrl}`);
      return null;
    }

    return {
      name: json.Name,
      value: json.Value,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`IPNS publish timeout on ${gatewayUrl}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Main publisher using parallel multi-node strategy
 */
export class IpfsPublisher {
  /**
   * Publish token data to all configured IPFS nodes in parallel
   *
   * Flow:
   * 1. Store content on all nodes in parallel
   * 2. Check if any succeeded
   * 3. Publish IPNS to all nodes using the stored CID
   * 4. Return result after any successful publish
   */
  async publishTokenData(
    tokenData: TxfStorageData,
    options: {
      lifetime?: string; // Default: "87660h" (10 years)
      timeoutMs?: number; // Default: 5000ms
    } = {}
  ): Promise<PublishResult> {
    const startTime = performance.now();
    const gateways = getAllBackendGatewayUrls();

    if (gateways.length === 0) {
      return {
        success: false,
        publishedNodes: 0,
        totalNodes: 0,
        failedNodes: [],
        latencyMs: 0,
      };
    }

    const lifetime = options.lifetime ?? "87660h";
    const timeoutMs = options.timeoutMs ?? 5000;

    // Step 1: Store content - return immediately on first success
    const storePromises = gateways.map((gateway) =>
      storeContentOnGateway(tokenData, gateway, 3000)
        .then((cid) => ({
          result: cid,
          gateway,
          success: cid !== null,
        }))
        .catch(() => ({
          result: null as string | null,
          gateway,
          success: false,
        }))
    );

    const storeRace = await raceToFirstSuccess(storePromises);

    if (!storeRace.success || !storeRace.result) {
      const latencyMs = performance.now() - startTime;
      return {
        success: false,
        publishedNodes: 0,
        totalNodes: gateways.length,
        failedNodes: gateways,
        latencyMs,
      };
    }

    const cid = storeRace.result;
    console.log(`📦 Content stored on ${storeRace.gateway}, returning immediately`);

    // Step 2: Publish IPNS - return immediately on first success
    const publishPromises = gateways.map((gateway) =>
      publishIpnsOnGateway(cid, gateway, { lifetime }, timeoutMs)
        .then((result) => ({
          result,
          gateway,
          success: result !== null,
        }))
        .catch(() => ({
          result: null as { name: string; value: string } | null,
          gateway,
          success: false,
        }))
    );

    const publishRace = await raceToFirstSuccess(publishPromises);

    const latencyMs = performance.now() - startTime;

    if (publishRace.success && publishRace.result) {
      console.log(`📢 IPNS published on ${publishRace.gateway}, returning immediately (${latencyMs.toFixed(0)}ms)`);
    }

    return {
      success: publishRace.success,
      cid,
      ipnsName: publishRace.result?.name,
      publishedNodes: publishRace.success ? 1 : 0, // We returned on first success
      totalNodes: gateways.length,
      failedNodes: publishRace.success ? [] : gateways, // Unknown - others still running
      latencyMs,
    };
  }

  /**
   * Publish IPNS record only (content already exists)
   * Useful for re-publishing with different TTL or after recovery
   */
  async publishIpns(
    cid: string,
    options: {
      lifetime?: string;
      timeoutMs?: number;
    } = {}
  ): Promise<PublishResult> {
    const startTime = performance.now();
    const gateways = getAllBackendGatewayUrls();

    if (gateways.length === 0) {
      return {
        success: false,
        cid,
        publishedNodes: 0,
        totalNodes: 0,
        failedNodes: [],
        latencyMs: 0,
      };
    }

    const lifetime = options.lifetime ?? "87660h";
    const timeoutMs = options.timeoutMs ?? 5000;

    // Race to first success - return immediately when one node succeeds
    const publishPromises = gateways.map((gateway) =>
      publishIpnsOnGateway(cid, gateway, { lifetime }, timeoutMs)
        .then((result) => ({
          result,
          gateway,
          success: result !== null,
        }))
        .catch(() => ({
          result: null as { name: string; value: string } | null,
          gateway,
          success: false,
        }))
    );

    const publishRace = await raceToFirstSuccess(publishPromises);

    const latencyMs = performance.now() - startTime;

    if (publishRace.success && publishRace.result) {
      console.log(`📢 IPNS published on ${publishRace.gateway}, returning immediately (${latencyMs.toFixed(0)}ms)`);
    }

    return {
      success: publishRace.success,
      cid,
      ipnsName: publishRace.result?.name,
      publishedNodes: publishRace.success ? 1 : 0,
      totalNodes: gateways.length,
      failedNodes: publishRace.success ? [] : gateways,
      latencyMs,
    };
  }
}

// Singleton instance
let publisherInstance: IpfsPublisher | null = null;

/**
 * Get or create the singleton publisher instance
 */
export function getIpfsPublisher(): IpfsPublisher {
  if (!publisherInstance) {
    publisherInstance = new IpfsPublisher();
  }
  return publisherInstance;
}
