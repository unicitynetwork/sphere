import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sphere, TokenRegistry, NETWORKS } from '@unicitylabs/sphere-sdk';
import type { InitProgress, NetworkType } from '@unicitylabs/sphere-sdk';
import {
  createBrowserProviders,
  type BrowserProviders,
} from '@unicitylabs/sphere-sdk/impl/browser';
import { SphereContext } from './SphereContext';
import { SPHERE_KEYS } from './queryKeys';

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

// =============================================================================
// Shared helpers (pure functions, no React state)
// =============================================================================

/** Disconnect transport so SDK can reconnect with the real identity */
async function disconnectTransport(providers: BrowserProviders): Promise<void> {
  if (providers.transport.isConnected()) {
    await providers.transport.disconnect();
  }
}

/** Add IPFS storage provider and trigger initial sync (fire-and-forget) */
function setupIpfsSync(instance: Sphere, providers: BrowserProviders): void {
  if (providers.ipfsTokenStorage) {
    instance.addTokenStorageProvider(providers.ipfsTokenStorage)
      .then(() => instance.sync())
      .catch(err => console.warn('[SphereProvider] IPFS sync failed:', err));
  }
}

/** Notify kbbot of new/imported wallet (fire-and-forget) */
function notifyKbbot(instance: Sphere): void {
  const kbbotUrl = import.meta.env.VITE_KBBOT_URL as string | undefined;
  if (!kbbotUrl || !instance.identity) return;
  fetch(`${kbbotUrl}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pubkey: instance.identity.chainPubkey,
      nametag: instance.identity.nametag,
    }),
  })
    .then(res => {
      if (!res.ok) console.error(`[kbbot] notify failed: ${res.status}`);
    })
    .catch(err => console.error('[kbbot] notify error:', err));
}

/** Clean up persisted wallet data on creation/import failure */
async function cleanupOnError(providers: BrowserProviders): Promise<void> {
  const clearDone = Sphere.clear({
    storage: providers.storage,
    tokenStorage: providers.tokenStorage,
  });
  await Promise.race([clearDone, new Promise(r => setTimeout(r, 3000))]);
}

// =============================================================================
// Provider component
// =============================================================================

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
  const [ipfsEnabled, setIpfsEnabled] = useState(isIpfsEnabled);
  const [isDiscoveringAddresses, setIsDiscoveringAddresses] = useState(false);
  const [initProgress, setInitProgress] = useState<InitProgress | null>(null);
  const sphereRef = useRef<Sphere | null>(null);

  const initialize = useCallback(async (attempt = 0, skipLoading = false) => {
    try {
      // Destroy previous instance to release IndexedDB connections
      if (sphereRef.current) {
        await sphereRef.current.destroy();
        sphereRef.current = null;
      }

      if (!skipLoading) setIsLoading(true);
      setError(null);

      const browserProviders = createBrowserProviders({
        network,
        price: { platform: 'coingecko', baseUrl: COINGECKO_BASE_URL, cacheTtlMs: 5 * 60_000 },
        groupChat: true,
        market: true,
        ...getIpfsConfig(),
      });
      setProviders(browserProviders);

      // Configure our bundle's TokenRegistry singleton — the SDK configures
      // its own internal copy during Sphere.init(), but due to separate
      // bundle entry points the singleton we import is a different instance.
      const netConfig = NETWORKS[network] ?? NETWORKS.testnet;
      TokenRegistry.configure({
        remoteUrl: netConfig.tokenRegistryUrl,
        storage: browserProviders.storage,
      });

      const exists = await Sphere.exists(browserProviders.storage);
      setWalletExists(exists);

      if (exists) {
        setInitProgress({ step: 'initializing', message: 'Loading wallet...' });
        const { sphere: instance } = await Sphere.init({
          ...browserProviders,
          l1: {},
          discoverAddresses: false, // Run separately below for UX
          onProgress: setInitProgress,
        });
        setupIpfsSync(instance, browserProviders);
        setInitProgress(null);
        sphereRef.current = instance;
        setSphere(instance);

        // Run address discovery in background after wallet is visible
        setIsDiscoveringAddresses(true);
        instance.discoverAddresses({ autoTrack: true, includeL1Scan: false }).then(result => {
          if (result.addresses.length > 0) {
            console.log(`[SphereProvider] Discovered ${result.addresses.length} address(es)`);
          }
        }).catch(err => {
          console.warn('[SphereProvider] Address discovery failed:', err);
        }).finally(() => {
          setIsDiscoveringAddresses(false);
        });
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
        return initialize(attempt + 1, skipLoading);
      }

      console.error('[SphereProvider] Initialization failed:', err);
      setError(err instanceof Error ? err : new Error(message));
    } finally {
      setInitProgress(null);
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
      await disconnectTransport(providers);

      try {
        setInitProgress({ step: 'initializing', message: 'Creating wallet...' });
        const { sphere: instance, generatedMnemonic } = await Sphere.init({
          ...providers,
          autoGenerate: true,
          nametag: options?.nametag,
          l1: {},
          onProgress: setInitProgress,
        });
        setInitProgress(null);
        setupIpfsSync(instance, providers);
        notifyKbbot(instance);

        if (!generatedMnemonic) {
          throw new Error('Failed to generate mnemonic');
        }

        // Don't set walletExists/sphere here — let finalizeWallet() handle it
        // so the onboarding flow can show the completion screen first.
        return { mnemonic: generatedMnemonic, sphere: instance };
      } catch (err) {
        setInitProgress(null);
        await cleanupOnError(providers);
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
      await disconnectTransport(providers);

      setInitProgress({ step: 'initializing', message: 'Importing wallet...' });
      const instance = await Sphere.import({
        ...providers,
        mnemonic,
        nametag: options?.nametag,
        l1: {},
        onProgress: setInitProgress,
      });
      setInitProgress(null);

      // Don't setSphere/setWalletExists here — the onboarding flow calls
      // finalizeWallet(sphere) after address selection / nametag are done.
      return instance;
    },
    [providers],
  );

  const importFromFile = useCallback(
    async (options: ImportFromFileOptions): Promise<ImportFromFileResult> => {
      if (!providers) throw new Error('Providers not initialized');
      await disconnectTransport(providers);

      try {
        setInitProgress({ step: 'initializing', message: 'Importing file...' });
        const result = await Sphere.importFromLegacyFile({
          ...providers,
          fileContent: options.fileContent,
          fileName: options.fileName,
          password: options.password,
          nametag: options.nametag,
          l1: {},
          onProgress: setInitProgress,
        });
        setInitProgress(null);

        // Don't setSphere here — the onboarding flow calls finalizeWallet(sphere)
        // after address selection / nametag are done.
        return {
          success: result.success,
          sphere: result.sphere,
          mnemonic: result.mnemonic,
          needsPassword: result.needsPassword,
          error: result.error,
        };
      } catch (err) {
        setInitProgress(null);
        await cleanupOnError(providers);
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

    // Clear React Query cache so old balances/tokens don't leak to new wallet
    queryClient.removeQueries({ queryKey: SPHERE_KEYS.all });

    // Reset React state
    setSphere(null);
    setWalletExists(false);
    setError(null);

    // Reinitialize with fresh providers (skip loading spinner — onboarding UI is already visible)
    await initialize(0, true);
  }, [providers, initialize, queryClient]);

  const finalizeWallet = useCallback((importedSphere?: Sphere) => {
    if (importedSphere) {
      if (providers) setupIpfsSync(importedSphere, providers);
      sphereRef.current = importedSphere;
      setSphere(importedSphere);
      notifyKbbot(importedSphere);
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
    isDiscoveringAddresses,
    initProgress,
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
