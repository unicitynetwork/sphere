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
import type { SphereContextValue, CreateWalletOptions, ImportWalletOptions } from './SphereContext';
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

      const browserProviders = createBrowserProviders({ network });
      setProviders(browserProviders);

      const exists = await Sphere.exists(browserProviders.storage);
      setWalletExists(exists);

      if (exists) {
        const { sphere: instance } = await Sphere.init({
          ...browserProviders,
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
      });

      setSphere(instance);
      setWalletExists(true);
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
  }, [sphere, providers, queryClient]);

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
    deleteWallet,
    reinitialize: initialize,
  };

  return (
    <SphereContext.Provider value={value}>{children}</SphereContext.Provider>
  );
}
