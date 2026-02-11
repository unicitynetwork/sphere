import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sphere } from '@unicitylabs/sphere-sdk';
import {
  createBrowserProviders,
  type BrowserProviders,
} from '@unicitylabs/sphere-sdk/impl/browser';
import type { NetworkType } from '@unicitylabs/sphere-sdk';
import { SphereContext } from './SphereContext';
import type {
  SphereContextValue,
  CreateWalletOptions,
  ImportWalletOptions,
  ImportFromFileOptions,
  ImportFromFileResult,
} from './SphereContext';
import { clearAllSphereData } from '../config/storageKeys';

interface SphereProviderProps {
  children: ReactNode;
  network?: NetworkType;
}

export function SphereProvider({
  children,
  network = 'testnet',
}: SphereProviderProps) {
  const queryClient = useQueryClient();
  const [sphere, setSphere] = useState<Sphere | null>(null);
  const [providers, setProviders] = useState<BrowserProviders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialize = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const browserProviders = createBrowserProviders({
        network,
        price: { platform: 'coingecko', baseUrl: '/coingecko', cacheTtlMs: 5 * 60_000 },
      });
      setProviders(browserProviders);

      const exists = await Sphere.exists(browserProviders.storage);
      setWalletExists(exists);

      if (exists) {
        const { sphere: instance } = await Sphere.init({
          ...browserProviders,
          l1: {},
        });
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
      console.error('[SphereProvider] Initialization failed:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [network]);

  useEffect(() => {
    initialize();
    return () => {
      // Cleanup on unmount
      sphere?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        setSphere(instance);
        setWalletExists(true);

        if (!generatedMnemonic) {
          throw new Error('Failed to generate mnemonic');
        }

        return generatedMnemonic;
      } catch (err) {
        // If nametag was taken or any other error during init,
        // wallet data may already be persisted — clean it up
        await Sphere.clear({
          storage: providers.storage,
          tokenStorage: providers.tokenStorage,
        });
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

      // Connect transport if not already connected (needed before wallet exists)
      if (!transport.isConnected()) {
        await transport.connect();
        // Set dummy identity for read-only queries (resolveNametagInfo only queries, never signs)
        transport.setIdentity({
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
    async (mnemonic: string, options?: ImportWalletOptions) => {
      if (!providers) throw new Error('Providers not initialized');

      // Disconnect transport so Sphere.init can reconnect with the real identity.
      if (providers.transport.isConnected()) {
        await providers.transport.disconnect();
      }

      // Clear existing wallet first
      await Sphere.clear({
        storage: providers.storage,
        tokenStorage: providers.tokenStorage,
      });

      const { sphere: instance } = await Sphere.init({
        ...providers,
        mnemonic,
        nametag: options?.nametag,
        l1: {},
      });

      setSphere(instance);
      setWalletExists(true);
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

      // Ensure storage is connected (it may have been disconnected by a
      // previous import → Sphere.clear() → destroy() cycle)
      if (!providers.storage.isConnected()) {
        await providers.storage.connect();
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
        // Clean up on failure
        await Sphere.clear({
          storage: providers.storage,
          tokenStorage: providers.tokenStorage,
        });
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
    // Clear SDK storage before destroying (destroy disconnects providers)
    if (providers) {
      await Sphere.clear({
        storage: providers.storage,
        tokenStorage: providers.tokenStorage,
      });
    }
    if (sphere) {
      await sphere.destroy();
    }
    clearAllSphereData(true);
    queryClient.clear();
    setSphere(null);
    setWalletExists(false);
    setError(null);

    // Create fresh providers WITHOUT connecting transport.
    // Don't call initialize() here — it pre-connects transport with a dummy
    // identity which races with the real connection inside Sphere.import/init,
    // causing the subsequent import to hang. The SDK handles the full
    // connection lifecycle (connect, setIdentity, subscribe) internally.
    // resolveNametag() also connects transport on demand when needed.
    const freshProviders = createBrowserProviders({
      network,
      price: { platform: 'coingecko', baseUrl: '/coingecko' },
    });
    setProviders(freshProviders);
  }, [sphere, providers, queryClient, network]);

  const finalizeWallet = useCallback((importedSphere?: Sphere) => {
    if (importedSphere) {
      setSphere(importedSphere);
    }
    setWalletExists(true);
  }, []);

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
  };

  return (
    <SphereContext.Provider value={value}>{children}</SphereContext.Provider>
  );
}
