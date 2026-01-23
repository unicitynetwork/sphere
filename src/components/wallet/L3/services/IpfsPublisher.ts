/**
 * IPFS Publisher (L3 Wrapper)
 *
 * Thin wrapper around SDK IpfsPublisher that injects
 * gateway configuration from ipfs.config.ts.
 */

import {
  IpfsPublisher as SdkIpfsPublisher,
  type PublishResult,
} from "../../sdk/browser/ipfs";
import type { TxfStorageData } from "./types/TxfTypes";
import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

// Re-export types for backwards compatibility
export type { PublishResult };

/**
 * L3-configured publisher
 */
export class IpfsPublisher extends SdkIpfsPublisher {
  constructor() {
    super({
      getGatewayUrls: getAllBackendGatewayUrls,
    });
  }

  /**
   * Publish token data with L3 type
   */
  async publishTokenData(
    tokenData: TxfStorageData,
    options: {
      lifetime?: string;
      timeoutMs?: number;
    } = {}
  ): Promise<PublishResult> {
    return super.publishTokenData(tokenData, options);
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
