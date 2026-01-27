/**
 * IPNS Client (Browser-specific)
 *
 * Low-level IPNS operations that can be used independently of Helia.
 * Provides HTTP-based IPNS publishing and resolution through gateways.
 */

import { createIPNSRecord, marshalIPNSRecord, unmarshalIPNSRecord } from "ipns";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import type { PrivateKey } from "@libp2p/interface";

import { deriveEd25519KeyMaterial, IPNS_HKDF_INFO } from '../../ipns';
import type {
  IpnsGatewayResult,
  IpnsProgressiveResult,
  IpnsPublishResult,
} from './ipfs-types';

// ==========================================
// IPNS Key Derivation
// ==========================================

/**
 * Derive IPNS key pair from a secp256k1 private key
 */
export async function deriveIpnsKeyPair(
  privateKeyHex: string
): Promise<{ keyPair: PrivateKey; ipnsName: string }> {
  const derivedKey = deriveEd25519KeyMaterial(privateKeyHex, IPNS_HKDF_INFO);
  const keyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);
  const peerId = peerIdFromPrivateKey(keyPair);

  return {
    keyPair,
    ipnsName: peerId.toString(),
  };
}

// ==========================================
// IPNS Record Creation
// ==========================================

/**
 * Create a signed IPNS record
 */
export async function createSignedIpnsRecord(
  keyPair: PrivateKey,
  cid: string,
  sequenceNumber: bigint,
  lifetimeMs: number = 99 * 365 * 24 * 60 * 60 * 1000 // 99 years
): Promise<Uint8Array> {
  const record = await createIPNSRecord(
    keyPair,
    `/ipfs/${cid}`,
    sequenceNumber,
    lifetimeMs
  );

  return marshalIPNSRecord(record);
}

// ==========================================
// HTTP Gateway Publishing
// ==========================================

/**
 * Publish IPNS record to a single gateway via HTTP
 */
export async function publishIpnsToGateway(
  gatewayUrl: string,
  ipnsName: string,
  marshalledRecord: Uint8Array,
  timeoutMs: number = 30000
): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(marshalledRecord)]),
      "record"
    );

    const response = await fetch(
      `${gatewayUrl}/api/v0/routing/put?arg=/ipns/${ipnsName}&allow-offline=true`,
      {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 100)}`);
    }

    return true;
  } catch (error) {
    console.warn(`IPNS publish to ${gatewayUrl} failed:`, error);
    return false;
  }
}

/**
 * Publish IPNS record to multiple gateways in parallel
 */
export async function publishIpnsToGateways(
  gatewayUrls: string[],
  ipnsName: string,
  marshalledRecord: Uint8Array,
  timeoutMs: number = 30000
): Promise<IpnsPublishResult> {
  if (gatewayUrls.length === 0) {
    return {
      success: false,
      error: "No gateways configured",
    };
  }

  const results = await Promise.allSettled(
    gatewayUrls.map((url) =>
      publishIpnsToGateway(url, ipnsName, marshalledRecord, timeoutMs)
    )
  );

  const successfulGateways: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      successfulGateways.push(gatewayUrls[index]);
    }
  });

  return {
    success: successfulGateways.length > 0,
    ipnsName,
    successfulGateways,
    error: successfulGateways.length === 0
      ? "All gateways failed"
      : undefined,
  };
}

// ==========================================
// HTTP Gateway Resolution
// ==========================================

/**
 * Resolve IPNS from a single gateway
 */
export async function resolveIpnsFromGateway(
  gatewayUrl: string,
  ipnsName: string,
  timeoutMs: number = 10000
): Promise<IpnsGatewayResult | null> {
  try {
    const response = await fetch(
      `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    // Response is NDJSON - each line is a JSON object
    const text = await response.text();
    const lines = text.trim().split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);

        // Look for "Extra" field which contains base64-encoded IPNS record
        if (obj.Extra) {
          const recordData = base64ToUint8Array(obj.Extra);
          const record = unmarshalIPNSRecord(recordData);

          // Extract CID from the value field (may be Uint8Array or string depending on ipns version)
          const valueBytes = typeof record.value === 'string'
            ? new TextEncoder().encode(record.value)
            : record.value as Uint8Array;
          const valueStr = new TextDecoder().decode(valueBytes);
          const cidMatch = valueStr.match(/\/ipfs\/([a-zA-Z0-9]+)/);

          if (cidMatch) {
            return {
              cid: cidMatch[1],
              sequence: record.sequence,
              gateway: gatewayUrl,
              recordData,
            };
          }
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return null;
  } catch (error) {
    console.warn(`IPNS resolution from ${gatewayUrl} failed:`, error);
    return null;
  }
}

/**
 * Resolve IPNS from gateway path (simpler, uses /ipns/<name> path)
 */
export async function resolveIpnsViaPath(
  gatewayUrl: string,
  ipnsName: string,
  timeoutMs: number = 15000
): Promise<{ cid: string; content?: unknown } | null> {
  try {
    const response = await fetch(
      `${gatewayUrl}/ipns/${ipnsName}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    const content = await response.json();

    // Try to extract CID from response headers or content
    const cidHeader = response.headers.get("X-Ipfs-Path");
    if (cidHeader) {
      const match = cidHeader.match(/\/ipfs\/([a-zA-Z0-9]+)/);
      if (match) {
        return { cid: match[1], content };
      }
    }

    // If no CID header, we still have the content
    return { cid: "", content };
  } catch (error) {
    console.warn(`IPNS path resolution from ${gatewayUrl} failed:`, error);
    return null;
  }
}

/**
 * Resolve IPNS progressively from multiple gateways
 * Returns best result (highest sequence number)
 */
export async function resolveIpnsProgressively(
  gatewayUrls: string[],
  ipnsName: string,
  options?: {
    timeoutMs?: number;
    minResponses?: number;
    earlyExitDelayMs?: number;
  }
): Promise<IpnsProgressiveResult> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  const minResponses = options?.minResponses ?? 1;
  const earlyExitDelayMs = options?.earlyExitDelayMs ?? 2000;

  const results: IpnsGatewayResult[] = [];
  let respondedCount = 0;

  // Start all requests in parallel
  const promises = gatewayUrls.map(async (url) => {
    const result = await resolveIpnsFromGateway(url, ipnsName, timeoutMs);
    if (result) {
      results.push(result);
    }
    respondedCount++;
    return result;
  });

  // Wait for minimum responses or early exit
  await Promise.race([
    // Wait for all to complete
    Promise.allSettled(promises),
    // Or early exit after delay if we have enough responses
    new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (respondedCount >= minResponses && results.length > 0) {
          // Wait a bit more for potentially better results
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, earlyExitDelayMs);
        }
      }, 100);

      // Cleanup interval after timeout
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, timeoutMs + 1000);
    }),
  ]);

  // Find best result (highest sequence)
  let best: IpnsGatewayResult | null = null;
  for (const result of results) {
    if (!best || result.sequence > best.sequence) {
      best = result;
    }
  }

  return {
    best,
    allResults: results,
    respondedCount,
    totalGateways: gatewayUrls.length,
  };
}

// ==========================================
// Content Fetching
// ==========================================

/**
 * Fetch JSON content from IPFS via gateway
 */
export async function fetchIpfsContent<T = unknown>(
  gatewayUrl: string,
  cid: string,
  timeoutMs: number = 15000
): Promise<T | null> {
  try {
    const response = await fetch(
      `${gatewayUrl}/ipfs/${cid}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.warn(`IPFS content fetch from ${gatewayUrl} failed:`, error);
    return null;
  }
}

/**
 * Upload JSON content to IPFS via gateway
 */
export async function uploadIpfsContent(
  gatewayUrl: string,
  content: unknown,
  timeoutMs: number = 30000
): Promise<{ cid: string } | null> {
  try {
    const formData = new FormData();
    const jsonBlob = new Blob(
      [JSON.stringify(content)],
      { type: "application/json" }
    );
    formData.append("file", jsonBlob, "data.json");

    const response = await fetch(
      `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
      {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    return { cid: result.Hash };
  } catch (error) {
    console.warn(`IPFS upload to ${gatewayUrl} failed:`, error);
    return null;
  }
}

// ==========================================
// Utilities
// ==========================================

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
