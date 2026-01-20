/**
 * IPFS Metrics Collector
 *
 * Tracks performance metrics for IPFS operations to identify
 * bottlenecks and validate sub-2-second sync target.
 *
 * Metrics tracked:
 * - Operation latency (resolve, publish, fetch)
 * - Success/failure rates by source
 * - Cache hit rates
 * - Node performance
 */

export type IpfsOperation = "resolve" | "publish" | "fetch" | "cache";
export type IpfsSource =
  | "http-gateway"
  | "http-routing"
  | "dht"
  | "cache"
  | "none";

export interface IpfsOperationMetric {
  operation: IpfsOperation;
  source: IpfsSource;
  latencyMs: number;
  success: boolean;
  timestamp: number;
  nodeCount?: number;
  failedNodes?: number;
  cacheHit?: boolean;
  error?: string;
}

export interface IpfsMetricsSnapshot {
  totalOperations: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  cacheHitRate: number;
  operationBreakdown: Record<IpfsOperation, number>;
  sourceBreakdown: Record<IpfsSource, number>;
  slowOperations: IpfsOperationMetric[];
}

export class IpfsMetricsCollector {
  private metrics: IpfsOperationMetric[] = [];
  private readonly maxMetrics = 1000;
  private readonly slowOperationThresholdMs = 1000;

  /**
   * Record an IPFS operation
   */
  recordOperation(metric: IpfsOperationMetric): void {
    this.metrics.push(metric);

    // Keep only recent metrics (sliding window)
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log warnings for slow operations
    if (metric.latencyMs > this.slowOperationThresholdMs) {
      console.warn(
        `Slow IPFS operation: ${metric.operation} via ${metric.source} took ${metric.latencyMs}ms`,
        {
          success: metric.success,
          nodeCount: metric.nodeCount,
          error: metric.error,
        }
      );
    }
  }

  /**
   * Get comprehensive metrics snapshot
   */
  getSnapshot(): IpfsMetricsSnapshot {
    if (this.metrics.length === 0) {
      return {
        totalOperations: 0,
        successRate: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        maxLatencyMs: 0,
        minLatencyMs: 0,
        cacheHitRate: 0,
        operationBreakdown: {
          resolve: 0,
          publish: 0,
          fetch: 0,
          cache: 0,
        },
        sourceBreakdown: {
          "http-gateway": 0,
          "http-routing": 0,
          dht: 0,
          cache: 0,
          none: 0,
        },
        slowOperations: [],
      };
    }

    // Calculate latency percentiles
    const latencies = this.metrics
      .map((m) => m.latencyMs)
      .sort((a, b) => a - b);

    const successCount = this.metrics.filter((m) => m.success).length;
    const cacheHits = this.metrics.filter((m) => m.cacheHit).length;

    // Count by operation type
    const operationBreakdown: Record<IpfsOperation, number> = {
      resolve: 0,
      publish: 0,
      fetch: 0,
      cache: 0,
    };

    for (const m of this.metrics) {
      operationBreakdown[m.operation]++;
    }

    // Count by source
    const sourceBreakdown: Record<IpfsSource, number> = {
      "http-gateway": 0,
      "http-routing": 0,
      dht: 0,
      cache: 0,
      none: 0,
    };

    for (const m of this.metrics) {
      sourceBreakdown[m.source]++;
    }

    // Find slow operations
    const slowOperations = this.metrics
      .filter((m) => m.latencyMs > this.slowOperationThresholdMs)
      .slice(-10); // Last 10 slow ops

    return {
      totalOperations: this.metrics.length,
      successRate: successCount / this.metrics.length,
      avgLatencyMs:
        latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)],
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)],
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)],
      maxLatencyMs: Math.max(...latencies),
      minLatencyMs: Math.min(...latencies),
      cacheHitRate: cacheHits / this.metrics.length,
      operationBreakdown,
      sourceBreakdown,
      slowOperations,
    };
  }

  /**
   * Get metrics for specific operation
   */
  getOperationMetrics(operation: IpfsOperation): {
    count: number;
    avgLatencyMs: number;
    successRate: number;
    preferredSource: IpfsSource;
  } {
    const relevant = this.metrics.filter((m) => m.operation === operation);

    if (relevant.length === 0) {
      return {
        count: 0,
        avgLatencyMs: 0,
        successRate: 0,
        preferredSource: "none",
      };
    }

    const latencies = relevant.map((m) => m.latencyMs);
    const successCount = relevant.filter((m) => m.success).length;

    // Find most successful source
    const sourceSuccess = new Map<IpfsSource, number>();
    for (const m of relevant) {
      if (m.success) {
        sourceSuccess.set(m.source, (sourceSuccess.get(m.source) || 0) + 1);
      }
    }

    const preferredSource = Array.from(sourceSuccess.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] || "none";

    return {
      count: relevant.length,
      avgLatencyMs:
        latencies.reduce((a, b) => a + b, 0) / latencies.length,
      successRate: successCount / relevant.length,
      preferredSource,
    };
  }

  /**
   * Get node performance metrics (if tracking)
   */
  getNodePerformance(): Record<
    string,
    {
      successRate: number;
      avgLatencyMs: number;
      operationCount: number;
    }
  > {
    const byNode = new Map<
      string,
      { latencies: number[]; successCount: number; totalCount: number }
    >();

    for (const m of this.metrics) {
      if (!m.nodeCount) continue;

      const key = `node-${m.timestamp}`;
      if (!byNode.has(key)) {
        byNode.set(key, { latencies: [], successCount: 0, totalCount: 0 });
      }

      const node = byNode.get(key)!;
      node.latencies.push(m.latencyMs);
      node.totalCount++;
      if (m.success) node.successCount++;
    }

    const result: Record<
      string,
      {
        successRate: number;
        avgLatencyMs: number;
        operationCount: number;
      }
    > = {};

    for (const [key, data] of byNode) {
      result[key] = {
        successRate: data.successCount / data.totalCount,
        avgLatencyMs:
          data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length,
        operationCount: data.totalCount,
      };
    }

    return result;
  }

  /**
   * Reset metrics (on logout or clear)
   */
  reset(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as JSON
   */
  export(): {
    snapshot: IpfsMetricsSnapshot;
    rawMetrics: IpfsOperationMetric[];
  } {
    return {
      snapshot: this.getSnapshot(),
      rawMetrics: [...this.metrics],
    };
  }

  /**
   * Get target achievement status
   */
  getTargetStatus(): {
    targetMet: boolean;
    p95AboveTarget: boolean;
    message: string;
  } {
    const snapshot = this.getSnapshot();
    const target = 2000; // 2 seconds

    const p95AboveTarget = snapshot.p95LatencyMs > target;

    return {
      targetMet: !p95AboveTarget && snapshot.successRate > 0.95,
      p95AboveTarget,
      message: p95AboveTarget
        ? `P95 latency (${snapshot.p95LatencyMs}ms) exceeds target (${target}ms)`
        : `Target achieved: P95=${snapshot.p95LatencyMs.toFixed(0)}ms, Success=${(snapshot.successRate * 100).toFixed(1)}%`,
    };
  }
}

// Singleton instance
let metricsInstance: IpfsMetricsCollector | null = null;

/**
 * Get or create the singleton metrics collector
 */
export function getIpfsMetrics(): IpfsMetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new IpfsMetricsCollector();
  }
  return metricsInstance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetIpfsMetrics(): void {
  if (metricsInstance) {
    metricsInstance.reset();
  }
}
