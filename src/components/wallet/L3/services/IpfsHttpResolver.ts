/**
 * IPFS HTTP Resolver (L3 Wrapper)
 *
 * Thin wrapper around SDK IpfsHttpResolver that injects
 * gateway configuration from ipfs.config.ts.
 */

import {
  IpfsHttpResolver as SdkIpfsHttpResolver,
  computeCidFromContent as sdkComputeCidFromContent,
  type IpnsResolutionResult,
} from "../../sdk/browser/ipfs";
import type { TxfStorageData } from "./types/TxfTypes";
import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

// Re-export types for backwards compatibility
export type { IpnsResolutionResult };

// Re-export computeCidFromContent with L3 type
export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  return sdkComputeCidFromContent(content);
}

/**
 * L3-configured HTTP resolver
 */
export class IpfsHttpResolver extends SdkIpfsHttpResolver<TxfStorageData> {
  constructor() {
    super({
      getGatewayUrls: getAllBackendGatewayUrls,
    });
  }
}

// Singleton instance
let resolverInstance: IpfsHttpResolver | null = null;

/**
 * Get or create the singleton resolver instance
 */
export function getIpfsHttpResolver(): IpfsHttpResolver {
  if (!resolverInstance) {
    resolverInstance = new IpfsHttpResolver();
  }
  return resolverInstance;
}
