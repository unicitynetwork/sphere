import {
  createContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { Sphere } from '@unicitylabs/sphere-sdk';
import {
  createBrowserProviders,
  type BrowserProviders,
} from '@unicitylabs/sphere-sdk/impl/browser';
import type { NetworkType, Identity } from '@unicitylabs/sphere-sdk';

export interface SphereContextValue {
  sphere: Sphere | null;
  providers: BrowserProviders | null;

  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;

  createWallet: (options?: CreateWalletOptions) => Promise<string>;
  importWallet: (
    mnemonic: string,
    options?: ImportWalletOptions,
  ) => Promise<void>;
  deleteWallet: () => Promise<void>;
  reinitialize: () => Promise<void>;
}

interface CreateWalletOptions {
  nametag?: string;
}

interface ImportWalletOptions {
  nametag?: string;
}

interface SphereProviderProps {
  children: ReactNode;
  network?: NetworkType;
}

export const SphereContext = createContext<SphereContextValue | null>(null);

export function SphereProvider({
  children,
  network = 'testnet',
}: SphereProviderProps) {
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
    },
    [providers],
  );

  const importWallet = useCallback(
    async (mnemonic: string, options?: ImportWalletOptions) => {
      if (!providers) throw new Error('Providers not initialized');

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
    if (sphere) {
      await sphere.destroy();
    }
    if (providers) {
      await Sphere.clear({
        storage: providers.storage,
        tokenStorage: providers.tokenStorage,
      });
    }
    setSphere(null);
    setWalletExists(false);
  }, [sphere, providers]);

  const value: SphereContextValue = {
    sphere,
    providers,
    isLoading,
    isInitialized: !!sphere,
    walletExists,
    error,
    createWallet,
    importWallet,
    deleteWallet,
    reinitialize: initialize,
  };

  return (
    <SphereContext.Provider value={value}>{children}</SphereContext.Provider>
  );
}
