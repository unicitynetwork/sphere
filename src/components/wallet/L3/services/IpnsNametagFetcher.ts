/**
 * IPNS Nametag Fetcher
 *
 * Fetches nametag data from IPFS via IPNS resolution without requiring
 * full IpfsStorageService initialization. Uses HTTP gateway path format
 * (/ipns/{name}) which allows the gateway to handle IPNS resolution.
 *
 * Flow:
 *   1. Derive IPNS name from private key
 *   2. Fetch content via gateway: GET /ipns/{ipnsName}
 *   3. Parse TXF content and extract _nametag.name
 */

import { deriveIpnsNameFromPrivateKey } from "./IpnsUtils";
import { getBackendGatewayUrl, getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

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

// Timeout for HTTP gateway requests (IPNS resolution via DHT can be slow)
const FETCH_TIMEOUT_MS = 30000;

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
 * Fetch nametag via HTTP gateway
 *
 * Uses the IPNS gateway path format which allows the gateway to resolve IPNS
 * and serve the content directly. Tries multiple gateways for redundancy.
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

  // Try each gateway until one succeeds
  let lastError: Error | null = null;
  for (const gatewayUrl of gatewayUrls) {
    try {
      const nametag = await tryGateway(gatewayUrl, ipnsName);
      if (nametag !== null) {
        return nametag;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next gateway
    }
  }

  // If all gateways failed, throw the last error
  if (lastError) {
    throw lastError;
  }

  return null;
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
 * Try fetching from a single gateway using IPNS gateway path
 * Uses /ipns/{name}?format=dag-json which lets the gateway resolve IPNS
 * and return DAG-JSON content (since @helia/json stores in this format)
 */
async function tryGateway(
  gatewayUrl: string,
  ipnsName: string
): Promise<NametagFetchResult | null> {
  // Use IPNS gateway path with dag-json format
  // The format parameter is needed because @helia/json stores content as DAG-JSON
  const ipnsUrl = `${gatewayUrl}/ipns/${ipnsName}?format=dag-json`;

  let contentResponse: Response;
  try {
    contentResponse = await fetchWithTimeout(ipnsUrl, FETCH_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("IPNS gateway timeout");
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
