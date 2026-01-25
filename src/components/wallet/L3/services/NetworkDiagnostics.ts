/**
 * Network Latency Diagnostics
 *
 * Measures round-trip time (RTT) to IPFS nodes to diagnose
 * client-to-server connectivity issues. Helps identify network distance
 * contributing to IPFS operation latency.
 */

import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

/**
 * Result of measuring latency to a single node
 */
export interface NodeLatencyResult {
  url: string;
  hostname: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

/**
 * Summary of diagnostics across all nodes
 */
export interface NetworkDiagnosticsSummary {
  timestamp: number;
  nodes: NodeLatencyResult[];
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  successCount: number;
  failureCount: number;
}

/**
 * Fetch with timeout support (same pattern as IpfsHttpResolver)
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
      method: "HEAD", // Lightweight request
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Measure latency to a single IPFS node
 *
 * Uses a lightweight HEAD request to /api/v0/id endpoint.
 * Measures from start of fetch to completion of response headers.
 *
 * @param gatewayUrl - Full gateway URL (e.g., https://unicity-ipfs1.dyndns.org)
 * @param timeoutMs - Request timeout in milliseconds (default: 5000)
 * @returns Node latency result with timing and status
 */
export async function measureIpfsNodeLatency(
  gatewayUrl: string,
  timeoutMs: number = 5000
): Promise<NodeLatencyResult> {
  const hostname = new URL(gatewayUrl).hostname;
  const startTime = performance.now();

  try {
    // Use HEAD request to /api/v0/id for lightweight measurement
    // This endpoint exists on Kubo and responds quickly
    const url = `${gatewayUrl}/api/v0/id`;
    const response = await fetchWithTimeout(url, timeoutMs);
    const latencyMs = performance.now() - startTime;

    if (response.ok) {
      return {
        url: gatewayUrl,
        hostname,
        latencyMs: Math.round(latencyMs),
        success: true,
      };
    } else {
      return {
        url: gatewayUrl,
        hostname,
        latencyMs: Math.round(latencyMs),
        success: false,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const latencyMs = performance.now() - startTime;

    let errorMsg = "Unknown error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMsg = `Timeout after ${timeoutMs}ms`;
      } else {
        errorMsg = error.message;
      }
    }

    return {
      url: gatewayUrl,
      hostname,
      latencyMs: Math.round(latencyMs),
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Run network diagnostics on all configured IPFS nodes
 *
 * Measures latency to each node in parallel and returns summary statistics.
 * Useful for identifying which nodes are responsive and estimating network distance.
 *
 * @returns Diagnostic summary with per-node results and aggregate statistics
 */
export async function runNetworkDiagnostics(): Promise<NetworkDiagnosticsSummary> {
  const gateways = getAllBackendGatewayUrls();
  const timestamp = Date.now();

  if (gateways.length === 0) {
    console.log("🌐 [Network] No IPFS gateways configured");
    return {
      timestamp,
      nodes: [],
      minLatencyMs: 0,
      maxLatencyMs: 0,
      avgLatencyMs: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  console.log(`🌐 [Network] Running diagnostics on ${gateways.length} node(s)...`);

  // Measure latency to all nodes in parallel
  const results = await Promise.all(
    gateways.map((gateway) => measureIpfsNodeLatency(gateway))
  );

  // Calculate statistics
  const successResults = results.filter((r) => r.success);
  const failureResults = results.filter((r) => !r.success);

  let minLatencyMs = Infinity;
  let maxLatencyMs = 0;
  let sumLatencyMs = 0;

  for (const result of successResults) {
    minLatencyMs = Math.min(minLatencyMs, result.latencyMs);
    maxLatencyMs = Math.max(maxLatencyMs, result.latencyMs);
    sumLatencyMs += result.latencyMs;
  }

  const avgLatencyMs =
    successResults.length > 0
      ? Math.round(sumLatencyMs / successResults.length)
      : 0;

  // Normalize infinities for final result
  if (!isFinite(minLatencyMs)) {
    minLatencyMs = 0;
  }

  const summary: NetworkDiagnosticsSummary = {
    timestamp,
    nodes: results,
    minLatencyMs,
    maxLatencyMs,
    avgLatencyMs,
    successCount: successResults.length,
    failureCount: failureResults.length,
  };

  // Log results
  console.log(
    `🌐 [Network] Diagnostics complete: ${summary.successCount}/${results.length} nodes responding`
  );

  for (const result of results) {
    if (result.success) {
      console.log(
        `   ✅ ${result.hostname}: RTT=${result.latencyMs}ms`
      );
    } else {
      console.log(
        `   ❌ ${result.hostname}: ${result.error} (${result.latencyMs}ms)`
      );
    }
  }

  if (successResults.length > 0) {
    console.log(
      `🌐 [Network] Summary: min=${minLatencyMs}ms, avg=${avgLatencyMs}ms, max=${maxLatencyMs}ms`
    );

    // Estimate sidecar overhead (based on known ALPHA response: 0.58ms local, 379ms from client)
    // The ~378ms difference is network RTT
    // TLS handshake typically adds ~15-30ms to first connection
    const estimatedServerProcessingMs = 1; // Sidecar cache ~0.58ms, we estimate ~1ms
    const estimatedNetworkMs = avgLatencyMs - estimatedServerProcessingMs;
    const estimatedTlsOverheadMs = Math.max(0, estimatedNetworkMs * 0.05); // ~5% of network latency

    console.log(`🌐 [Network] Latency breakdown (estimated):`);
    console.log(
      `   Network RTT: ~${Math.round(estimatedNetworkMs)}ms (round-trip distance)`
    );
    console.log(`   TLS overhead: ~${Math.round(estimatedTlsOverheadMs)}ms (estimate)`);
    console.log(
      `   Server processing: ~${estimatedServerProcessingMs}ms (sidecar cache)`
    );
  }

  return summary;
}

/**
 * Export a callable function for browser console/devTools
 */
export async function logNetworkDiagnostics(): Promise<void> {
  await runNetworkDiagnostics();
}
