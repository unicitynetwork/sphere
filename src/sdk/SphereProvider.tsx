import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { Sphere } from '@unicitylabs/sphere-sdk';
import {
  createBrowserProviders,
  type BrowserProviders,
} from '@unicitylabs/sphere-sdk/impl/browser';
import type { NetworkType } from '@unicitylabs/sphere-sdk';
import { SphereContext } from './SphereContext';

const COINGECKO_BASE_URL = import.meta.env.DEV
  ? '/coingecko'
  : 'https://api.coingecko.com/api/v3';
import type {
  SphereContextValue,
  CreateWalletOptions,
  ImportWalletOptions,
  ImportFromFileOptions,
  ImportFromFileResult,
} from './SphereContext';
import { clearAllSphereData, STORAGE_KEYS } from '../config/storageKeys';

const IPFS_GATEWAYS = import.meta.env.VITE_IPFS_GATEWAYS
  ? (import.meta.env.VITE_IPFS_GATEWAYS as string).split(',').map(s => s.trim())
  : ['https://unicity-ipfs1.dyndns.org'];

function isIpfsEnabled(): boolean {
  const stored = localStorage.getItem(STORAGE_KEYS.IPFS_ENABLED);
  return stored !== 'false'; // enabled by default
}

function getIpfsConfig() {
  if (!isIpfsEnabled()) return {};
  return {
    tokenSync: {
      ipfs: {
        enabled: true,
        gateways: IPFS_GATEWAYS,
      },
    },
  };
}

interface SphereProviderProps {
  children: ReactNode;
  network?: NetworkType;
}

export function SphereProvider({
  children,
  network = 'testnet',
}: SphereProviderProps) {
  const [sphere, setSphere] = useState<Sphere | null>(null);
  const [providers, setProviders] = useState<BrowserProviders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [ipfsEnabled, setIpfsEnabled] = useState(isIpfsEnabled);
  const sphereRef = useRef<Sphere | null>(null);

  const initialize = useCallback(async (attempt = 0) => {
    try {
      // Destroy previous instance to release IndexedDB connections
      if (sphereRef.current) {
        await sphereRef.current.destroy();
        sphereRef.current = null;
      }

      setIsLoading(true);
      setError(null);

      const browserProviders = createBrowserProviders({
        network,
        price: { platform: 'coingecko', baseUrl: COINGECKO_BASE_URL, cacheTtlMs: 5 * 60_000 },
        groupChat: true,
        market: true,
        ...getIpfsConfig(),
      });
      setProviders(browserProviders);

      const exists = await Sphere.exists(browserProviders.storage);
      setWalletExists(exists);

      if (exists) {
        const { sphere: instance } = await Sphere.init({
          ...browserProviders,
          l1: {},
        });
        if (browserProviders.ipfsTokenStorage) {
          await instance.addTokenStorageProvider(browserProviders.ipfsTokenStorage);
          instance.sync().catch(err => console.warn('[SphereProvider] Initial IPFS sync failed:', err));
        }
        sphereRef.current = instance;
        setSphere(instance);
      } else {
        // Pre-connect transport for nametag lookups during onboarding
        const transport = browserProviders.transport;
        await transport.connect();
        transport.setIdentity({
          privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
          chainPubkey: '000000000000000000000000000000000000000000000000000000000000000000',
          l1Address: '',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // IndexedDB may be temporarily blocked after database deletion.
      // Retry once after a short delay before giving up.
      if (message.includes('IndexedDB open timed out') && attempt < 1) {
        console.warn('[SphereProvider] IndexedDB open timed out, retrying in 1s...');
        await new Promise(r => setTimeout(r, 1000));
        return initialize(attempt + 1);
      }

      console.error('[SphereProvider] Initialization failed:', err);
      setError(err instanceof Error ? err : new Error(message));
    } finally {
      setIsLoading(false);
    }
  }, [network]);

  useEffect(() => {
    initialize();
    return () => {
      // Cleanup on unmount
      sphereRef.current?.destroy();
      sphereRef.current = null;
    };
  }, [initialize]);

  const createWallet = useCallback(
    async (options?: CreateWalletOptions) => {
      if (!providers) throw new Error('Providers not initialized');

      // Disconnect transport so Sphere.init can reconnect with the real identity.
      // Without this, setIdentity() triggers an async reconnect that isn't awaited,
      // causing "NostrTransportProvider not connected" during nametag registration.
      if (providers.transport.isConnected()) {
        await providers.transport.disconnect();
      }

      try {
        const { sphere: instance, generatedMnemonic } = await Sphere.init({
          ...providers,
          autoGenerate: true,
          nametag: options?.nametag,
          l1: {},
        });
        if (providers.ipfsTokenStorage) {
          await instance.addTokenStorageProvider(providers.ipfsTokenStorage);
          instance.sync().catch(err => console.warn('[SphereProvider] Initial IPFS sync failed:', err));
        }

        sphereRef.current = instance;
        setSphere(instance);
        setWalletExists(true);

        if (!generatedMnemonic) {
          throw new Error('Failed to generate mnemonic');
        }

        return generatedMnemonic;
      } catch (err) {
        // If nametag was taken or any other error during init,
        // wallet data may already be persisted — clean it up
        const clearDone = Sphere.clear({
          storage: providers.storage,
          tokenStorage: providers.tokenStorage,
        });
        await Promise.race([clearDone, new Promise(r => setTimeout(r, 3000))]);
        sphereRef.current = null;
        setSphere(null);
        setWalletExists(false);
        throw err;
      }
    },
    [providers],
  );

  const resolveNametag = useCallback(
    async (nametag: string) => {
      if (!providers) throw new Error('Providers not initialized');

      const transport = providers.transport;

      // Connect transport if not already connected (needed before wallet exists).
      // Retry once on failure — relay may need a moment after page load.
      if (!transport.isConnected()) {
        try {
          await transport.connect();
        } catch {
          // Wait briefly and retry once
          await new Promise(r => setTimeout(r, 1000));
          await transport.connect();
        }
        // Set dummy identity for read-only queries (resolveNametagInfo only queries, never signs)
        await transport.setIdentity({
          privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
          chainPubkey: '000000000000000000000000000000000000000000000000000000000000000000',
          l1Address: '',
        });
      }

      const info = await transport.resolveNametagInfo?.(nametag);
      return info ?? null;
    },
    [providers],
  );

  const importWallet = useCallback(
    async (mnemonic: string, options?: ImportWalletOptions): Promise<Sphere> => {
      if (!providers) throw new Error('Providers not initialized');

      // Disconnect transport so Sphere.init can reconnect with the real identity.
      if (providers.transport.isConnected()) {
        await providers.transport.disconnect();
      }

      const { sphere: instance } = await Sphere.init({
        ...providers,
        mnemonic,
        nametag: options?.nametag,
        l1: {},
      });
      if (providers.ipfsTokenStorage) {
        await instance.addTokenStorageProvider(providers.ipfsTokenStorage);
        instance.sync().catch(err => console.warn('[SphereProvider] Initial IPFS sync failed:', err));
      }

      sphereRef.current = instance;
      setSphere(instance);
      setWalletExists(true);
      return instance;
    },
    [providers],
  );

  const importFromFile = useCallback(
    async (options: ImportFromFileOptions): Promise<ImportFromFileResult> => {
      if (!providers) throw new Error('Providers not initialized');

      // Disconnect transport so Sphere can reconnect with the real identity
      if (providers.transport.isConnected()) {
        await providers.transport.disconnect();
      }

      try {
        const result = await Sphere.importFromLegacyFile({
          fileContent: options.fileContent,
          fileName: options.fileName,
          password: options.password,
          nametag: options.nametag,
          storage: providers.storage,
          transport: providers.transport,
          oracle: providers.oracle,
          tokenStorage: providers.tokenStorage,
          l1: {},
          groupChat: providers.groupChat,
        });

        // Don't setSphere here — the onboarding flow calls finalizeWallet(sphere)
        // after scanning / address selection / nametag are done.
        // Setting sphere eagerly would change the context and cause premature
        // re-renders that can reset the onboarding step state.

        return {
          success: result.success,
          sphere: result.sphere,
          mnemonic: result.mnemonic,
          needsPassword: result.needsPassword,
          error: result.error,
        };
      } catch (err) {
        // Clean up on failure (with timeout to avoid hanging on blocked IDB)
        const clearDone = Sphere.clear({
          storage: providers.storage,
          tokenStorage: providers.tokenStorage,
        });
        await Promise.race([clearDone, new Promise(r => setTimeout(r, 3000))]);
        sphereRef.current = null;
        setSphere(null);
        setWalletExists(false);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Import failed',
        };
      }
    },
    [providers],
  );

  const deleteWallet = useCallback(async () => {
    // Destroy sphere to close SDK connections (Nostr, IndexedDB handles, etc.)
    if (sphereRef.current) {
      await sphereRef.current.destroy();
      sphereRef.current = null;
    }

    // Disconnect storage providers to release IndexedDB connections,
    // then delete the databases via SDK.
    if (providers) {
      await Promise.allSettled([
        providers.storage.disconnect(),
        providers.tokenStorage.disconnect(),
      ]);
      const clearDone = Sphere.clear({
        storage: providers.storage,
        tokenStorage: providers.tokenStorage,
      });
      await Promise.race([clearDone, new Promise(r => setTimeout(r, 5000))]);
    }

    // Clear localStorage regardless of whether DB deletion succeeded.
    clearAllSphereData();

    // Reset React state
    setSphere(null);
    setWalletExists(false);
    setError(null);

    // Reinitialize with fresh providers
    await initialize();
  }, [providers, initialize]);

  const finalizeWallet = useCallback((importedSphere?: Sphere) => {
    if (importedSphere) {
      if (providers?.ipfsTokenStorage) {
        importedSphere.addTokenStorageProvider(providers.ipfsTokenStorage)
          .then(() => importedSphere.sync())
          .catch(err => console.warn('[SphereProvider] IPFS sync after import failed:', err));
      }
      sphereRef.current = importedSphere;
      setSphere(importedSphere);
    }
    setWalletExists(true);
  }, [providers]);

  const toggleIpfs = useCallback(() => {
    const next = !isIpfsEnabled();
    localStorage.setItem(STORAGE_KEYS.IPFS_ENABLED, String(next));
    setIpfsEnabled(next);
    // Reinitialize so the new IPFS setting takes effect
    initialize();
  }, [initialize]);

  const value: SphereContextValue = {
    sphere,
    providers,
    isLoading,
    isInitialized: !!sphere,
    walletExists,
    error,
    resolveNametag,
    createWallet,
    importWallet,
    importFromFile,
    finalizeWallet,
    deleteWallet,
    reinitialize: initialize,
    ipfsEnabled,
    toggleIpfs,
  };

  return (
    <SphereContext.Provider value={value}>{children}</SphereContext.Provider>
  );
}
