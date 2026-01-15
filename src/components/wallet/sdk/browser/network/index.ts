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
