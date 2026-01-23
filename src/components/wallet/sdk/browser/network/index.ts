/**
 * Browser Network Submodule
 *
 * Browser-specific network implementations:
 * - WebSocket adapter for native WebSocket API
 * - Network provider for Fulcrum/Electrum protocol
 */

export { BrowserWSAdapter } from './BrowserWSAdapter';

export {
  BrowserNetworkProvider,
  getBrowserProvider,
  disposeBrowserProvider,
} from './BrowserNetworkProvider';

// Convenience function for getting balance using singleton provider
import { getBrowserProvider } from './BrowserNetworkProvider';

/**
 * Get balance for an address using the singleton browser provider
 * @param address - The address to get balance for
 * @returns Balance in ALPHA (whole coins, not sats)
 */
export async function getBalance(address: string): Promise<number> {
  const provider = getBrowserProvider();
  await provider.connect();
  return provider.getBalance(address);
}
