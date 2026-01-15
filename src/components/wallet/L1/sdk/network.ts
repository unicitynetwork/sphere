/**
 * Browser Network Provider - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/BrowserNetworkProvider.ts
 */

// Re-export everything from SDK browser module
export {
  BrowserNetworkProvider,
  getBrowserProvider,
  disposeBrowserProvider,
} from '../../sdk/browser';

// Create backwards-compatible singleton
import { getBrowserProvider, disposeBrowserProvider } from '../../sdk/browser';

/**
 * Singleton instance for backwards compatibility
 * @deprecated Use getBrowserProvider() instead
 */
export const browserProvider = getBrowserProvider();

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeBrowserProvider();
  });
}
