/**
 * IPNS Nametag Fetcher
 *
 * Fetches nametag data from IPFS via IPNS resolution without requiring
 * full IpfsStorageService initialization. Uses dual-path racing for optimal speed:
 *
 * Two resolution methods raced in parallel:
 * 1. Gateway path (/ipns/{name}?format=dag-json) - Fast (~30ms with cache)
 * 2. Routing API (/api/v0/routing/get) - Slower (~5s) but more reliable
 *
 * Flow:
 *   1. Derive IPNS name from private key
 *   2. Race both methods - gateway path and routing API
 *   3. Return first successful result
 *   4. Parse TXF content and extract _nametag.name
 */

import { deriveIpnsNameFromPrivateKey } from "./IpnsUtils";
import { unmarshalIPNSRecord } from "ipns";
import { getBackendGatewayUrl, getAllBackendGatewayUrls, IPNS_RESOLUTION_CONFIG } from "../../../../config/ipfs.config";

export interface IpnsNametagResult {
  ipnsName: string;
  nametag: string | null;
  nametagData?: {
    name: string;
    token: object;
    timestamp?: number;
    format?: string;
  };
  source: "http" | "none";
  error?: string;
}

/**
 * Fetch nametag from IPFS using IPNS resolution
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @returns Result containing IPNS name and resolved nametag (if found)
 */
export async function fetchNametagFromIpns(
  privateKeyHex: string
): Promise<IpnsNametagResult> {
  let ipnsName = "";

  try {
    // 1. Derive IPNS name from private key
    ipnsName = await deriveIpnsNameFromPrivateKey(privateKeyHex);

    // 2. Try HTTP gateway (fast path)
    const result = await fetchViaHttpGateway(ipnsName);
    if (result) {
      return {
        ipnsName,
        nametag: result.name,
        nametagData: {
          name: result.name,
          token: result.data.token || {},
          timestamp: result.data.timestamp,
          format: result.data.format,
        },
        source: "http",
      };
    }

    // No nametag found
    return { ipnsName, nametag: null, source: "none" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to fetch nametag for IPNS ${ipnsName}:`, errorMessage);
    return {
      ipnsName: ipnsName || "unknown",
      nametag: null,
      source: "none",
      error: errorMessage,
    };
  }
}

/**
 * Fetch with timeout support and JSON headers
 * Returns the response regardless of status code (let caller handle it)
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Request JSON format for DAG-JSON content
        Accept: "application/json, application/vnd.ipld.dag-json",
      },
    });
    // Don't throw for non-200 - let caller handle IPNS resolution failures
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch nametag via HTTP gateway using dual-path racing
 *
 * Races both methods in parallel for each gateway:
 * - Gateway path: /ipns/{name}?format=dag-json (fast ~30ms)
 * - Routing API: /api/v0/routing/get (slow ~5s, more reliable)
 *
 * Returns first successful result from any gateway.
 */
async function fetchViaHttpGateway(ipnsName: string): Promise<NametagFetchResult | null> {
  // Get all configured gateway URLs
  const gatewayUrls = getAllBackendGatewayUrls();
  if (gatewayUrls.length === 0) {
    const fallbackUrl = getBackendGatewayUrl();
    if (!fallbackUrl) {
      throw new Error("No IPFS gateway configured");
    }
    gatewayUrls.push(fallbackUrl);
  }

  // Race both methods across all gateways
  // Create promise for each gateway that races gateway path vs routing API
  const racePromises = gatewayUrls.flatMap((gatewayUrl) => [
    // Gateway path (fast)
    tryGatewayPath(gatewayUrl, ipnsName).catch(() => null),
    // Routing API (slow but reliable)
    tryRoutingApi(gatewayUrl, ipnsName).catch(() => null),
  ]);

  // Use Promise.any to return first successful result
  try {
    const result = await Promise.any(
      racePromises.map(async (p) => {
        const result = await p;
        if (result === null) {
          throw new Error("No result");
        }
        return result;
      })
    );
    return result;
  } catch {
    // All promises rejected - no result found
    return null;
  }
}

interface NametagFetchResult {
  name: string;
  data: {
    token?: object;
    timestamp?: number;
    format?: string;
  };
}

/**
 * Try fetching from a single gateway using IPNS gateway path (fast path)
 * Uses /ipns/{name}?format=dag-json which lets the gateway resolve IPNS
 * and return DAG-JSON content (since @helia/json stores in this format)
 */
async function tryGatewayPath(
  gatewayUrl: string,
  ipnsName: string
): Promise<NametagFetchResult | null> {
  // Use IPNS gateway path with dag-json format
  // The format parameter is needed because @helia/json stores content as DAG-JSON
  const ipnsUrl = `${gatewayUrl}/ipns/${ipnsName}?format=dag-json`;

  let contentResponse: Response;
  try {
    contentResponse = await fetchWithTimeout(ipnsUrl, IPNS_RESOLUTION_CONFIG.gatewayPathTimeoutMs);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("IPNS gateway path timeout");
    }
    throw error;
  }

  // Check response status - 404/500 means IPNS name not found or resolution failed
  if (!contentResponse.ok) {
    return null;
  }

  // Parse TXF content and extract nametag
  let txfData;
  try {
    txfData = await contentResponse.json();
  } catch {
    return null;
  }

  // TXF format has _nametag at top level
  if (txfData._nametag && typeof txfData._nametag.name === "string") {
    // Return full nametag data for localStorage persistence
    return {
      name: txfData._nametag.name,
      data: txfData._nametag,
    };
  }

  return null;
}

/**
 * Try fetching from a single gateway using routing API (slow but reliable)
 * Uses /api/v0/routing/get to get raw IPNS record, then fetches content via CID
 */
async function tryRoutingApi(
  gatewayUrl: string,
  ipnsName: string
): Promise<NametagFetchResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IPNS_RESOLUTION_CONFIG.perGatewayTimeoutMs
  );

  try {
    // 1. Resolve IPNS to CID via routing API
    const routingUrl = `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`;
    const routingResponse = await fetch(routingUrl, {
      method: "POST",
      signal: controller.signal,
    });

    if (!routingResponse.ok) {
      return null;
    }

    // Parse routing response to get IPNS record
    const json = await routingResponse.json() as { Extra?: string };
    if (!json.Extra) {
      return null;
    }

    // Decode base64 Extra field to get raw IPNS record
    const recordData = Uint8Array.from(atob(json.Extra), c => c.charCodeAt(0));
    const record = unmarshalIPNSRecord(recordData);

    // Extract CID from value path
    const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);
    if (!cidMatch) {
      return null;
    }

    const cid = cidMatch[1];

    // 2. Fetch content via CID
    const contentUrl = `${gatewayUrl}/ipfs/${cid}?format=dag-json`;
    const contentResponse = await fetch(contentUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.ipld.dag-json, application/json",
      },
    });

    if (!contentResponse.ok) {
      return null;
    }

    // Parse TXF content and extract nametag
    let txfData;
    try {
      txfData = await contentResponse.json();
    } catch {
      return null;
    }

    // TXF format has _nametag at top level
    if (txfData._nametag && typeof txfData._nametag.name === "string") {
      return {
        name: txfData._nametag.name,
        data: txfData._nametag,
      };
    }

    return null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("IPNS routing API timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Batch fetch nametags for multiple private keys in parallel
 *
 * @param privateKeys - Array of private keys in hex format
 * @returns Array of results (same order as input)
 */
export async function fetchNametagsForKeys(
  privateKeys: string[]
): Promise<IpnsNametagResult[]> {
  const promises = privateKeys.map((key) => fetchNametagFromIpns(key));
  return Promise.all(promises);
}
