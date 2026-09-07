import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Sphere,
  TokenRegistry,
  NETWORKS,
  logger,
  isSphereError,
  getPublicKey,
  STORAGE_KEYS_GLOBAL,
  validateMnemonic,
  decryptMnemonic,
} from '@unicitylabs/sphere-sdk';
import { sendWelcomeDM } from './welcomeDM';
import { adoptOrDiscardInstance } from './adoptOrDiscardInstance';
import { classifyInitFailure } from './walletLock/classifyInitFailure';
import { useIdleTimer } from './walletLock/useIdleTimer';
import {
  decodeLockSettings,
  encodeLockSettings,
  autoLockMs,
  DEFAULT_AUTO_LOCK_MINUTES,
  type AutoLockValue,
} from './walletLock/lockSettings';
import { broadcastLock, subscribeLockBroadcast } from './walletLock/lockBroadcast';
import { broadcastLogout, subscribeLogoutBroadcast } from './walletLock/logoutBroadcast';
import { markLockEpoch, clearLockEpoch, isLockPending } from './walletLock/lockEpoch';
import {
  savePersistedUnlock,
  loadPersistedUnlock,
  clearPersistedUnlock,
  touchPersistedUnlock,
} from './walletLock/persistedUnlock';
import { reencryptStoredMnemonic } from './walletLock/reencryptMnemonic';
import { forEachConnectHost } from './connectHostRegistry';
import { isUiOnlyQuery } from '../config/uiQueryKeys';
import type { InitProgress, NetworkType } from '@unicitylabs/sphere-sdk';
import { getErrorMessage } from './errors';
import {
  createBrowserProviders,
  createUnicityAggregatorProvider,
  type BrowserProviders,
} from '@unicitylabs/sphere-sdk/impl/browser';
import {
  createSphereProviders,
  createWalletApiProviders,
} from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import { SphereContext, type SphereAppProviders } from './SphereContext';
import {
  getEngineOverride,
  getWalletApiBaseUrl,
  isWalletApiEnabled,
} from '../config/walletApi';
import { getActiveOracleApiKey } from './oracleKey';
import { SUBSCRIPTION_ENABLED } from '../config/subscription';
import { allowsSharedAggregatorKey } from '../config/networkCapabilities';
import { resolveActiveKey, saveWalletKey, saveAddressKey, loadWalletKey, persistKeyDurably } from './subscription/keyVault';
import { validatePastedKey } from './subscription/keyCheck';
import { isPaidPlan } from './subscription/usage';
import type { SubscriptionKeyStatus } from './subscription/keyStatus';
import { provisionOrRecoverKey, getUtilization } from '../services/subscriptionApi';

/** How often user activity may refresh the remembered unlock's expiry. */
const PERSIST_TOUCH_INTERVAL_MS = 60_000;

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
import {
  clearAllSphereData,
  getOrCreateWalletApiDeviceId,
  STORAGE_KEYS,
} from '../config/storageKeys';
import { setStoredSubscriptionKey } from '../config/subscriptionKeyCache';
import { migrateApprovedSessions } from '../utils/connected-sites';

// One-time migration from old approved sessions format (idempotent)
migrateApprovedSessions();

// SDK debug logging: off by default, opt-in via console commands.
// Print hint in dev mode so developers know how to enable it.
if (import.meta.env.DEV) {
  console.log(
    '%c[Sphere SDK] Debug logging is off. Enable with:%c\n' +
    '  logger.configure({ debug: true })          — all tags\n' +
    '  logger.setTagDebug("Nostr", true)           — Nostr only\n' +
    '  logger.setTagDebug("Payments", true)         — Payments only\n' +
    '  logger.setTagDebug("IndexedDB", true)        — IndexedDB only\n' +
    '  logger.setTagDebug("Aggregator", true)       — Aggregator only\n' +
    'Available: Nostr, Payments, IndexedDB, IndexedDBToken, LocalStorage, Aggregator, Price, Market, SphereProvider',
    'color: #888; font-weight: bold',
    'color: #888',
  );
  // Expose logger on window for easy console access
  (window as unknown as Record<string, unknown>).logger = logger;
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

/**
 * Compose the app's provider bundle (S4): the browser base, an optional
 * engine-port override (LOCAL dev stack: mock aggregator + the trustbase it
 * serves), and — when VITE_WALLET_API_URL is set — the wallet-api preset:
 * the plain `walletApi` transport config the SDK's payments vertical is
 * composed from (server custody + mailbox delivery ride it); messaging,
 * group chat and nametags stay on the Nostr transport in the base bundle.
 *
 * Fail-closed (#351): on builds with VITE_REQUIRE_WALLET_API set,
 * getWalletApiBaseUrl() throws when there is no URL for the active network —
 * the error is caught by initialize() and surfaced as a visible init error.
 * With the flag off this returns the bundle WITHOUT a `walletApi` config, and
 * Sphere.init then throws INVALID_CONFIG itself: there is no local-custody
 * composition to fall back to any more, so the flag chooses which error the
 * user sees, not whether the wallet works.
 */
function buildProviders(network: NetworkType, apiKey?: string): SphereAppProviders {
  // Fail closed on the static-key mode where it is unsafe. VITE_AGGREGATOR_API_KEY
  // is compiled into the bundle every visitor downloads, so on a real-value
  // network it would hand this deployment's aggregator quota to anyone with
  // devtools. runtime-config.sh only WARNS on a near-miss flag ('TRUE', '1'),
  // and it REQUIRES a key in that mode — so a typo'd flag plus a real key is a
  // silent leak. Throw here (like the #351 custody assert) so it surfaces as a
  // visible init error instead.
  if (!allowsSharedAggregatorKey(network) && !SUBSCRIPTION_ENABLED) {
    throw new Error(
      `Refusing to run on "${network}" with subscriptions disabled: the static ` +
        'VITE_AGGREGATOR_API_KEY ships inside the JS bundle, so it is readable by ' +
        'every visitor and is not a secret on any client. Set SUBSCRIPTION_ENABLED ' +
        "to exactly 'true' so each wallet provisions its own per-wallet key.",
    );
  }

  const base = createBrowserProviders({
    network,
    // v2 token engine: aggregator URL + trust base come from the network
    // preset; `apiKey` is already fully resolved by getActiveOracleApiKey()
    // (per-wallet subscription key when subscriptions are on, else the static
    // env key when off). Do NOT add an `?? env` fallback here — that would
    // resurrect VITE_AGGREGATOR_API_KEY while subscriptions are enabled, which
    // must ignore it entirely (see src/sdk/oracleKey.ts).
    oracle: { apiKey },
    price: { platform: 'coingecko', baseUrl: COINGECKO_BASE_URL, cacheTtlMs: 5 * 60_000 },
    groupChat: true,
    market: true,
  });

  const engineOverride = getEngineOverride(network);
  const withEngine = engineOverride
    ? createSphereProviders(base, {
        engine: createUnicityAggregatorProvider({
          url: engineOverride.aggregatorUrl,
          trustBaseUrl: engineOverride.trustBaseUrl,
          network,
        }),
      })
    : base;

  const walletApiBaseUrl = getWalletApiBaseUrl(network);
  if (!walletApiBaseUrl) return withEngine;
  // Post-flip (sdk 0.14.1): createWalletApiProviders attaches a plain
  // `walletApi` transport CONFIG (WalletApiTransportConfig) — the session,
  // retries and timeouts are composed inside the SDK's payments vertical.
  // The old S1 client options (requestTimeoutMs/retry) no longer exist here.
  return createWalletApiProviders(withEngine, {
    baseUrl: walletApiBaseUrl,
    network,
    deviceId: getOrCreateWalletApiDeviceId(),
  });
}

/** Clean up persisted wallet data on creation/import failure */
async function cleanupOnError(providers: BrowserProviders): Promise<void> {
  // Post-flip: tokens are server-custody — Sphere.clear takes { storage } only
  // (it also wipes the pv2:* scoped KV and sweeps orphaned pre-flip token DBs).
  const clearDone = Sphere.clear({ storage: providers.storage });
  await Promise.race([clearDone, new Promise(r => setTimeout(r, 3000))]);
}

/**
 * Read the auto-lock timeout currently in effect so it can be carried across
 * a Set/Change password operation (#449 review fix — correctness). The
 * persisted blob (STORAGE_KEYS.AUTO_LOCK_TIMEOUT) is encrypted with whatever
 * password was active BEFORE the change, so decoding it needs THAT password,
 * not the new one. `oldPassword` is `null` for Set (no session password
 * exists yet — the wallet was plaintext), in which case there is nothing
 * decryptable and this simply returns the secure default, same as
 * decodeLockSettings' own fallback.
 */
function readCurrentAutoLockMinutes(oldPassword: string | null): AutoLockValue {
  if (!oldPassword) return DEFAULT_AUTO_LOCK_MINUTES;
  const blob = localStorage.getItem(STORAGE_KEYS.AUTO_LOCK_TIMEOUT);
  return blob ? decodeLockSettings(blob, oldPassword) : DEFAULT_AUTO_LOCK_MINUTES;
}

/**
 * Serialize Set/Change/Remove password operations (#449 review fix —
 * re-entrancy): reencryptStoredMnemonic does a non-atomic read → write →
 * read-back-verify cycle against the SAME storage key, so two overlapping
 * calls (a rapid double-submit / Enter-mash getting past the UI's `busy`
 * guard) could interleave and stomp on each other. This ref-based mutex is
 * the actual load-bearing guarantee, independent of any UI guard: it rejects
 * a second call outright instead of letting it run concurrently.
 */
async function withPasswordOpLock(
  busyRef: { current: boolean },
  fn: () => Promise<void>,
): Promise<void> {
  if (busyRef.current) {
    throw new Error('A password change is already in progress');
  }
  busyRef.current = true;
  try {
    await fn();
  } finally {
    busyRef.current = false;
  }
}

// =============================================================================
// Provider component
// =============================================================================

interface SphereProviderProps {
  children: ReactNode;
  /**
   * The active network. Required: a default here would be a SECOND build
   * default that can silently drift from the one src/config/network.ts
   * resolves — and module-scope consts (the SGW base URL, the SGW challenge
   * pin, per-network wallet-api resolution) all derive from that one.
   */
  network: NetworkType;
}

export function SphereProvider({ children, network }: SphereProviderProps) {
  const queryClient = useQueryClient();
  const [sphere, setSphere] = useState<Sphere | null>(null);
  const [providers, setProviders] = useState<SphereAppProviders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // True when an encrypted wallet exists on disk but hasn't been unlocked with
  // its password this session — locked, not broken (#449). The SDK signals
  // this as SphereError('Failed to decrypt mnemonic', 'STORAGE_ERROR') on a
  // passwordless init of an encrypted wallet (see isDecryptionError.ts for the
  // code-verified detail); only that real signal may flip this true.
  const [isLocked, setIsLocked] = useState(false);
  const [isDiscoveringAddresses, setIsDiscoveringAddresses] = useState(false);
  const [initProgress, setInitProgress] = useState<InitProgress | null>(null);
  // Readiness of the subscription key on the live oracle — gates the send path
  // so a send can't race async provisioning and go out keyless (→ 401).
  const [subscriptionKeyStatus, setSubscriptionKeyStatus] = useState<SubscriptionKeyStatus>(
    SUBSCRIPTION_ENABLED ? 'provisioning' : 'not-required',
  );
  const sphereRef = useRef<Sphere | null>(null);
  // Session-only wallet password (#449 Task 8a): held ONLY in memory while the
  // wallet is unlocked, NEVER persisted anywhere (no localStorage/IndexedDB).
  // Set on a successful unlock() and on createWallet()/importWallet() when the
  // caller chose an at-rest password; cleared on lock() and deleteWallet().
  const passwordRef = useRef<string | null>(null);
  // Re-entrancy guard for setWalletPassword/changeWalletPassword/
  // removeWalletPassword (#449 review fix) — see withPasswordOpLock above.
  const passwordOpBusyRef = useRef(false);
  // Idle-auto-lock config derived from the password, computed ONCE per
  // setSessionPassword() call rather than on every render: decodeLockSettings
  // runs a PBKDF2 derivation (100k iterations — see sphere-sdk
  // core/encryption.ts), deliberately slow, and must not re-run on every
  // unrelated SphereProvider re-render. CRITICAL invariant: a wallet with NO
  // password (passwordRef.current falsy) always resolves `enabled: false`
  // here — see the `null`-password branch below.
  // Mirrored into a ref because unlock() reads it in the same tick it is set — the state
  // variable there is still the pre-unlock value.
  const idleLockConfigRef = useRef<{ enabled: boolean; timeoutMs: number | null }>({
    enabled: false,
    timeoutMs: null,
  });
  const [idleLockConfig, setIdleLockConfig] = useState<{ enabled: boolean; timeoutMs: number | null }>({
    enabled: false,
    timeoutMs: null,
  });
  // Settings → Security (#449 Task 8b): whether the wallet CURRENTLY has an
  // at-rest password. True the instant a session password is held
  // (passwordRef), OR — for the cold-start/locked case where no session
  // password exists yet — when the on-disk mnemonic itself isn't a valid
  // plaintext mnemonic (i.e. it's the SDK's encrypted form). Kept as its own
  // state (not derived inline) because the storage check is async.
  const [hasWalletPassword, setHasWalletPassword] = useState(false);
  // Auto-lock timeout shown/edited in Settings → Security. Only meaningful
  // while a session password is held (the stored blob is encrypted with it);
  // reset to the secure default whenever there is no password.
  const [autoLockMinutes, setAutoLockMinutesState] = useState<AutoLockValue>(DEFAULT_AUTO_LOCK_MINUTES);
  const setSessionPassword = useCallback((password: string | null) => {
    passwordRef.current = password;
    if (!password) {
      idleLockConfigRef.current = { enabled: false, timeoutMs: null };
    setIdleLockConfig({ enabled: false, timeoutMs: null });
      setAutoLockMinutesState(DEFAULT_AUTO_LOCK_MINUTES);
      return;
    }
    const storedBlob = localStorage.getItem(STORAGE_KEYS.AUTO_LOCK_TIMEOUT);
    const minutes = storedBlob ? decodeLockSettings(storedBlob, password) : DEFAULT_AUTO_LOCK_MINUTES;
    idleLockConfigRef.current = { enabled: true, timeoutMs: autoLockMs(minutes) };
    setIdleLockConfig({ enabled: true, timeoutMs: autoLockMs(minutes) });
    setAutoLockMinutesState(minutes);
  }, []);
  // Recompute hasWalletPassword from the on-disk mnemonic — used at cold
  // start (initialize()) where no session password exists yet to short-circuit
  // on. A truthy passwordRef always wins without touching storage.
  const refreshHasWalletPassword = useCallback(async (storage: { get(key: string): Promise<string | null> }) => {
    if (passwordRef.current) {
      setHasWalletPassword(true);
      return;
    }
    try {
      const stored = await storage.get(STORAGE_KEYS_GLOBAL.MNEMONIC);
      setHasWalletPassword(!!stored && !validateMnemonic(stored));
    } catch {
      setHasWalletPassword(false);
    }
  }, []);
  // Monotonic init generation: only the LATEST initialize() run may adopt its
  // Sphere; a run superseded mid-flight (StrictMode double-mount, network
  // toggle, unmount) destroys the instance it built instead of leaking it. See
  // #453 and adoptOrDiscardInstance.
  const initGenRef = useRef(0);
  // Re-entrancy guard for lock(). broadcastLock() now fires from INSIDE lock(),
  // and a same-name BroadcastChannel receives its own tab's postMessage, so the
  // cross-tab subscription re-enters lock() in the triggering tab; without this
  // ref that re-entry broadcasts again, unboundedly. A manual lock racing a
  // cross-tab lock does the same. Combined with the `sphereRef.current === null`
  // check inside lock(), this makes a lock exactly-once — which matters now that
  // lock() has observable side effects (one wire event per host, and a
  // queryClient.clear()).
  const lockingRef = useRef(false);
  // When this tab's CURRENT decrypted session started. Compared against the
  // persisted lock epoch on resume — a bfcached tab never re-runs initialize()
  // and never sees the lock BroadcastChannel message it slept through.
  const sessionStartedAtRef = useRef<number | null>(null);
  // Mirrors isLocked for lock()'s idempotency guard: lock() is a useCallback captured by the
  // cross-tab subscription and the idle timer, so reading the state variable there would read
  // whatever it was when the callback was created.
  const isLockedRef = useRef(false);
  /** Rate-limits the persisted-unlock timestamp write; see the idle timer's onActivity. */
  const lastTouchRef = useRef(0);

  // Marks a usable Sphere as live in this tab and drops any stale lock marker.
  const markSessionStart = useCallback(() => {
    sessionStartedAtRef.current = Date.now();
    clearLockEpoch();
  }, []);
  // Subscription-key reconcile bookkeeping (SUBSCRIPTION_ENABLED only):
  // - subKeyGenRef: monotonic generation so only the LATEST reconcile (initial
  //   load or a live address switch) may apply its key + flip status; stale
  //   overlapping reconciles abort at their generation check (no last-writer-wins
  //   drift when the user switches addresses quickly).
  // - appliedOracleKeyRef: the key the LIVE token engine actually carries. The
  //   send gate flips 'ready' off THIS — never the boot-cache slot, which is
  //   written ahead of the async engine rebuild — so 'ready' can't race an
  //   in-flight re-key and open a keyless-send window.
  const subKeyGenRef = useRef(0);
  const appliedOracleKeyRef = useRef<string | null>(null);
  // Serialize live oracle re-keys so overlapping engine rebuilds from rapid
  // address switches COMMIT in order — the live engine ends on the latest
  // requested key, matching appliedOracleKeyRef (no wrong-key drift). A key whose
  // generation was already superseded is skipped. This chain holds ONLY the fast,
  // local setOracleApiKey rebuild; the (possibly hanging) network provisioning
  // stays outside it, so an SGW stall can never block re-keying.
  const applyChainRef = useRef<Promise<void>>(Promise.resolve());
  const applyOracleKey = useCallback(
    (instance: Sphere, key: string, gen: number): Promise<void> => {
      const next = applyChainRef.current
        .then(async () => {
          if (gen !== subKeyGenRef.current) return; // superseded before we ran
          if (key === appliedOracleKeyRef.current) return; // engine already carries it
          await instance.setOracleApiKey(key);
          if (gen !== subKeyGenRef.current) return; // superseded during the rebuild
          appliedOracleKeyRef.current = key;
        })
        .catch(() => {});
      applyChainRef.current = next;
      return next;
    },
    [],
  );

  // Wire the per-wallet subscription (oracle) key onto a LIVE Sphere instance
  // WITHOUT a full re-init: resolve/provision the key, apply it to the live
  // oracle via setOracleApiKey, drive the send-gate status, and attach the
  // identity:changed listener that re-keys on a live address switch. Shared by
  // initialize() (existing wallet) AND finalizeWallet() (freshly onboarded
  // wallet) so BOTH get per-address reconcile + provisioning retry + terminal
  // status — not just a one-shot re-key. `builtWithKey` is the key the instance's
  // oracle was constructed with (undefined for the keyless onboarding oracle);
  // it seeds appliedOracleKeyRef so an unchanged key skips a needless rebuild.
  const setupSubscriptionKey = useCallback(
    (instance: Sphere, builtWithKey: string | undefined) => {
      if (!SUBSCRIPTION_ENABLED) return;
      appliedOracleKeyRef.current = builtWithKey ?? null;

      // Apply a resolved key to the live oracle (via the serialized apply chain),
      // then mark the gate ready — but only while this reconcile is still the
      // latest (gen guard) and only once the engine actually carries THIS key
      // (appliedOracleKeyRef), never off the boot-cache slot alone.
      const applyResolved = async (key: string, gen: number, source: 'wallet' | 'own') => {
        if (gen !== subKeyGenRef.current) return;
        setStoredSubscriptionKey(key);
        await applyOracleKey(instance, key, gen);
        if (gen !== subKeyGenRef.current) return;
        if (appliedOracleKeyRef.current === key) {
          setSubscriptionKeyStatus('ready');
          // Background sanity check of the resolved key against the gateway —
          // without it a revoked/foreign vault key surfaces only as 401s at
          // send time. Only a DEFINITIVE unknown/revoked verdict acts
          // (validatePastedKey fails open on lookup errors / pre-key-info
          // gateways); recovery re-provisions the identity's free key for the
          // same scope, and a revoked identity key (which the gateway refuses
          // to re-mint) lands on the existing terminal 'failed' + Settings
          // recovery UX.
          void validatePastedKey(key).then((verdict) => {
            if (verdict.valid || gen !== subKeyGenRef.current) return;
            console.warn('stored subscription key is unknown/revoked on the gateway — re-provisioning');
            void provisionOwn(source === 'wallet' ? 'wallet' : 'address', gen);
          });
        } else if (appliedOracleKeyRef.current === null) {
          // The engine rebuild did not land and the oracle is still keyless →
          // block the send gate (terminal 'failed') rather than leave it stuck
          // 'provisioning'. A non-null ref means a valid bearer key is loaded, so
          // leave the status untouched.
          setSubscriptionKeyStatus('failed');
        }
      };

      const provisionOwn = async (scope: 'wallet' | 'address', gen: number) => {
        try {
          const result = await provisionOrRecoverKey(instance, { scope });
          if (gen !== subKeyGenRef.current) return;
          await (scope === 'wallet'
            ? saveWalletKey(instance, network, result.apiKey)
            : saveAddressKey(instance, network, result.apiKey)); // both set the boot cache
          await applyOracleKey(instance, result.apiKey, gen);
          if (gen !== subKeyGenRef.current) return;
          if (appliedOracleKeyRef.current === result.apiKey) {
            setSubscriptionKeyStatus('ready');
          } else if (appliedOracleKeyRef.current === null) {
            // Applying the key to the engine did not land and it is still keyless →
            // block the send gate (terminal 'failed') rather than leave it stuck.
            setSubscriptionKeyStatus('failed');
          }
        } catch (err) {
          if (gen !== subKeyGenRef.current) return;
          // Provisioning failed. Block the send gate ('failed') while the oracle is
          // still keyless (initial load, OR a live switch that superseded an initial
          // reconcile which never keyed the engine). A non-null ref means a valid
          // bearer key is already loaded, so leave the status untouched (still 'ready').
          if (appliedOracleKeyRef.current === null) setSubscriptionKeyStatus('failed');
          console.warn('subscription auto-provisioning failed; sends are gated until it recovers', err);
        }
      };

      // Reconciles the boot cache (a single global slot — config/storageKeys.ts)
      // against the active address's resolved key:
      // - resolved 'own'/'wallet' with a key → use it;
      // - index 0 with no key yet → provision the wallet (index-0) free key;
      // - any other address with no key → give it its OWN free key, EXCEPT when
      //   index 0 is on a PAID plan and undecided, where a one-time prompt first
      //   offers to share that paid plan (inherit).
      const reconcileSubscriptionKey = async (initialLoad: boolean) => {
        const gen = ++subKeyGenRef.current;
        const resolved = await resolveActiveKey(instance, network);
        if (gen !== subKeyGenRef.current) return;
        if (resolved.key) {
          await applyResolved(resolved.key, gen, resolved.source === 'wallet' ? 'wallet' : 'own');
          return;
        }
        // needs-own: index 0 → wallet key; else this address's own key.
        const isRoot = instance.identity?.chainPubkey === getPublicKey(instance.deriveAddress(0).privateKey);
        if (isRoot) {
          await provisionOwn('wallet', gen);
          return;
        }
        // Offer inheriting index 0's plan only when it's PAID and undecided
        // (only on a live switch — never during the initial load).
        if (!initialLoad && resolved.undecided) {
          const walletKey = await loadWalletKey(instance, network);
          if (gen !== subKeyGenRef.current) return;
          if (walletKey) {
            try {
              if (isPaidPlan((await getUtilization(walletKey)).activeUntil)) {
                if (gen !== subKeyGenRef.current) return;
                window.dispatchEvent(new Event('subscription-address-prompt'));
                return; // wait for the user's choice
              }
            } catch {
              // metering unavailable → fall through to an own free key
            }
          }
        }
        await provisionOwn('address', gen);
      };

      void reconcileSubscriptionKey(true).catch(() => {});
      // Re-resolve on a live address switch — the per-address key applies
      // immediately via setOracleApiKey (no re-init, no reconnect). The listener
      // dies with the instance on the next full re-init (instance.destroy()).
      instance.on('identity:changed', () => {
        void reconcileSubscriptionKey(false).catch(() => {});
      });
    },
    [network, applyOracleKey],
  );

  const initialize = useCallback(async (attempt = 0, skipLoading = false) => {
    // Claim this generation; any later initialize() (or the unmount cleanup)
    // supersedes us. Checked after every await so a stale run stops touching
    // state and, crucially, never adopts the instance it built.
    const gen = ++initGenRef.current;
    const isStale = () => gen !== initGenRef.current;
    try {
      // Destroy previous instance to release IndexedDB connections
      if (sphereRef.current) {
        await sphereRef.current.destroy();
        sphereRef.current = null;
      }
      if (isStale()) return;

      if (!skipLoading) setIsLoading(true);
      setError(null);

      // Snapshot the resolved oracle key: when subscriptions are on it is the
      // stored per-wallet key (or undefined if not provisioned yet), and it
      // decides whether the live oracle is 'ready' vs still 'provisioning'.
      const oracleApiKey = getActiveOracleApiKey();
      const browserProviders = buildProviders(network, oracleApiKey);
      // Debug logging is off by default; enable at runtime via: logger.configure({ debug: true })
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
      if (isStale()) return;
      setWalletExists(exists);

      if (exists) {
        setInitProgress({ step: 'initializing', message: 'Loading wallet...' });
        // A remembered unlock, if one is still within its idle window. Reading it here — before
        // the deliberately passwordless attempt below — is what makes a reload not re-lock the
        // wallet. A plaintext wallet never wrote one, so it is unaffected.
        if (!passwordRef.current) {
          const remembered = await loadPersistedUnlock();
          if (isStale()) return;
          if (remembered) setSessionPassword(remembered);
        }
        // Password policy on this path:
        //  - COLD load (no session password held): pass none. An existing
        //    plaintext wallet must keep loading exactly as before; an encrypted
        //    one is MEANT to throw SphereError('Failed to decrypt mnemonic',
        //    'STORAGE_ERROR'), which we read as "locked", not a fatal error
        //    (#449) — see isDecryptionError.ts.
        //  - RE-INIT while unlocked (the exported `reinitialize`):
        //    carry passwordRef.current. Omitting it relocked a wallet the user
        //    had just unlocked — one click in permanent chrome (graceful lock
        //    §8.5).
        let instance: Sphere;
        try {
          ({ sphere: instance } = await Sphere.init({
            ...browserProviders,
            network, // ensure the SDK configures TokenRegistry for THIS network (not the testnet default)
            ...(passwordRef.current ? { password: passwordRef.current } : {}),
            discoverAddresses: false, // Run separately below for UX
            onProgress: setInitProgress,
          }));
        } catch (initErr) {
          if (classifyInitFailure(initErr) === 'locked') {
            // A superseded run's lock signal isn't ours to act on — the
            // latest run (or unmount) already owns the outcome (#453).
            if (isStale()) return;
            setIsLocked(true);
            isLockedRef.current = true;
            // The wallet is definitely password-protected (that's WHY the
            // passwordless init just threw the decrypt-mnemonic STORAGE_ERROR)
            // — no need for the storage round-trip, but reuse the shared
            // setter for a single source of truth.
            void refreshHasWalletPassword(browserProviders.storage);
            return;
          }
          throw initErr;
        }
        // Adopt only if we're still the latest init; otherwise destroy the
        // instance we just built so it can't linger as a zombie (#453).
        const outcome = await adoptOrDiscardInstance(instance, isStale, (inst) => {
          sphereRef.current = inst;
          setSphere(inst);
          markSessionStart();
        });
        if (outcome === 'discarded') return;
        setInitProgress(null);
        void refreshHasWalletPassword(browserProviders.storage);

        // Readiness for the send gate: 'ready' iff this oracle was built WITH a
        // subscription key. With no key yet we provision below and stay
        // 'provisioning' until setupSubscriptionKey applies one (covers the whole
        // provisioning gap, not just "no key in storage"). Subs off → the env key
        // is the oracle credential, so sends are always allowed ('not-required').
        setSubscriptionKeyStatus(
          !SUBSCRIPTION_ENABLED ? 'not-required' : oracleApiKey ? 'ready' : 'provisioning',
        );

        // Wire the per-wallet subscription key onto this live instance: resolve /
        // provision it, apply via setOracleApiKey (no re-init), drive the send-gate
        // status, and attach the identity:changed re-key listener. Shared with
        // finalizeWallet so onboarded wallets get the same reconcile + provisioning
        // retry. Full algorithm in setupSubscriptionKey (defined above).
        setupSubscriptionKey(instance, oracleApiKey);
        // Send welcome DMs after relay delivers historical messages (EOSE)
        {
          let welcomed = false;
          const trigger = () => {
            if (welcomed) return;
            welcomed = true;
            sendWelcomeDM(instance);
          };
          const unsubReady = instance.on("communications:ready", () => { unsubReady(); trigger(); });
          // Fallback if EOSE never fires (relay issues)
          setTimeout(() => { unsubReady(); trigger(); }, 20000);
        }

        // Run address discovery in background after wallet is visible
        setIsDiscoveringAddresses(true);
        instance.discoverAddresses({ autoTrack: true }).then(result => {
          if (result.addresses.length > 0) {
            logger.debug('SphereProvider', `Discovered ${result.addresses.length} address(es)`);
          }
        }).catch(err => {
          logger.warn('SphereProvider', 'Address discovery failed', err);
        }).finally(() => {
          setIsDiscoveringAddresses(false);
        });
      } else {
        // Pre-connect transport for nametag lookups during onboarding
        const transport = browserProviders.transport;
        await transport.connect();
        if (isStale()) return;
        transport.setIdentity({
          privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
          chainPubkey: '000000000000000000000000000000000000000000000000000000000000000000',
        });
      }
    } catch (err) {
      // A superseded run's failure is not the user's problem — a newer init
      // owns the outcome. Don't surface its error or retry.
      if (isStale()) return;

      // IndexedDB may be temporarily blocked after database deletion.
      // Retry once after a short delay before giving up.
      if (isSphereError(err) && err.code === 'STORAGE_ERROR' && attempt < 1) {
        logger.warn('SphereProvider', 'Storage error, retrying in 1s...', err);
        await new Promise(r => setTimeout(r, 1000));
        return initialize(attempt + 1, skipLoading);
      }

      logger.error('SphereProvider', 'Initialization failed', err);
      setError(err instanceof Error ? err : new Error(getErrorMessage(err)));
    } finally {
      // Only the latest run owns the shared loading/progress UI.
      if (!isStale()) {
        setInitProgress(null);
        setIsLoading(false);
      }
    }
  }, [network, setupSubscriptionKey, refreshHasWalletPassword, markSessionStart]);

  useEffect(() => {
    initialize();
    return () => {
      // Supersede any in-flight init so it destroys its instance instead of
      // adopting it after unmount, then tear down the live one. Reading the
      // LIVE ref values at cleanup time is intentional here (not a snapshot).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      initGenRef.current++;
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
          network,
          autoGenerate: true,
          nametag: options?.nametag,
          password: options?.password,
          onProgress: setInitProgress,
        });
        setInitProgress(null);

        if (!generatedMnemonic) {
          throw new Error('Failed to generate mnemonic');
        }

        // Memory-only (#449 Task 8a) — never persisted. Powers idle auto-lock
        // for a freshly-created wallet the same way unlock() does for an
        // existing one; a wallet created with NO password stays un-armed.
        if (options?.password) setSessionPassword(options.password);

        // Don't set walletExists/sphere here — let finalizeWallet() handle it
        // so the onboarding flow can show the completion screen first.
        return { mnemonic: generatedMnemonic, sphere: instance };
      } catch (err) {
        setInitProgress(null);
        // #449 no-wallet-loss guard: Sphere.init({autoGenerate:true}) only
        // creates a fresh wallet when NONE exists on disk — if the storage
        // already holds an encrypted wallet, Sphere.init delegates to
        // Sphere.load(), which throws SphereError('Failed to decrypt
        // mnemonic', 'STORAGE_ERROR') when (as here) no password was
        // supplied. That is a LOCKED, still-recoverable wallet,
        // not a broken create — never run the destructive cleanup for it.
        // The onboarding UI's lock-escape routing (CreateWalletFlow's
        // fromLock/goToStart) should prevent "Create New Wallet" from ever
        // being reachable while such a wallet is present; this is the last
        // line of defense against a stray/future path reaching it anyway.
        if (classifyInitFailure(err) === 'locked') {
          throw err;
        }
        await cleanupOnError(providers);
        sphereRef.current = null;
        setSphere(null);
        setWalletExists(false);
        throw err;
      }
    },
    [providers, network, setSessionPassword],
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
        network,
        mnemonic,
        nametag: options?.nametag,
        password: options?.password,
        onProgress: setInitProgress,
      });
      setInitProgress(null);

      // Memory-only (#449 Task 8a) — never persisted. Same as createWallet():
      // an import with NO password stays un-armed for idle auto-lock.
      if (options?.password) setSessionPassword(options.password);

      // Don't setSphere/setWalletExists here — the onboarding flow calls
      // finalizeWallet(sphere) after address selection / nametag are done.
      return instance;
    },
    [providers, network, setSessionPassword],
  );

  const importFromFile = useCallback(
    async (options: ImportFromFileOptions): Promise<ImportFromFileResult> => {
      if (!providers) throw new Error('Providers not initialized');
      await disconnectTransport(providers);

      try {
        setInitProgress({ step: 'initializing', message: 'Importing file...' });
        const result = await Sphere.importFromLegacyFile({
          ...providers,
          network,
          fileContent: options.fileContent,
          fileName: options.fileName,
          password: options.password,
          nametag: options.nametag,
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
          error: getErrorMessage(err),
        };
      }
    },
    [providers, network],
  );

  const deleteWallet = useCallback(async () => {
    // Notify connected dApps before destroying — ConnectPage/IframeAgent listen for this
    window.dispatchEvent(new CustomEvent('sphere:wallet-logout'));
    // And every OTHER tab: this function wipes IndexedDB and localStorage but
    // never reloads, so a neighbouring tab would keep operating a live
    // decrypted Sphere over a wiped database (graceful lock §8.1).
    broadcastLogout();
    // The remembered unlock belongs to a wallet that no longer exists.
    void clearPersistedUnlock();

    // wallet-api sign-out is SDK-internal post-flip (sdk 0.14.1): the old S1
    // WalletApiClient (providers.walletApi.logout()) is deleted — providers.
    // walletApi is now a plain transport CONFIG. The session lifecycle lives
    // inside the payments vertical: sphere.destroy() below stops it
    // (FacadeSession.stop), and Sphere.clear() wipes the pv2:* scoped KV that
    // holds the refresh token, so no reusable credential outlives deletion.

    // Destroy sphere to close SDK connections (Nostr, IndexedDB handles, etc.)
    if (sphereRef.current) {
      await sphereRef.current.destroy();
      sphereRef.current = null;
    }

    // Clear all SDK-owned data (wallet keys, tokens, DMs, etc.) from IndexedDB.
    // Sphere.clear() handles reconnecting storage internally, so we just
    // disconnect first to release stale handles.
    if (providers) {
      await providers.storage.disconnect().catch(() => {});
      try {
        // Post-flip: { storage } only — also wipes the pv2:* scoped KV and
        // sweeps orphaned pre-flip sphere-token-storage-* databases.
        await Sphere.clear({ storage: providers.storage });
      } catch (err) {
        logger.warn('SphereProvider', 'Sphere.clear() failed, sweeping IndexedDB directly', err);
      }
      // Sweep ALL Sphere IndexedDB databases by prefix. The token DB is now per-network
      // (sphere-token-storage-{network}-{chainPubkey}), so a fixed-name delete would miss
      // both the active per-network DB and any orphaned-network DBs. Run this always (not
      // just on clear() failure): Sphere.clear() closes its own handles, so deletion is not
      // blocked. Falls back to the known base names where indexedDB.databases() is missing.
      try {
        const dbs = (await indexedDB.databases?.()) ?? [];
        const toDelete = dbs
          .map((d) => d.name)
          .filter((n): n is string => !!n && (n === 'sphere-storage' || n.startsWith('sphere-token-storage')));
        for (const name of toDelete) {
          try { indexedDB.deleteDatabase(name); } catch { /* best effort */ }
        }
      } catch {
        for (const dbName of ['sphere-storage', 'sphere-token-storage']) {
          try { indexedDB.deleteDatabase(dbName); } catch { /* best effort */ }
        }
      }
    }

    // Clear localStorage regardless of whether DB deletion succeeded.
    clearAllSphereData();

    // Clear all React Query caches so stale data doesn't leak to new wallet
    queryClient.clear();

    // Reset React state
    setSphere(null);
    setWalletExists(false);
    setError(null);
    // The deleted wallet's password (if any) must not linger in memory, and —
    // just as important — must not leave the idle-lock timer armed against a
    // wallet that no longer exists (it would otherwise fire mid-onboarding and
    // wrongly gate the onboarding UI behind an unlock screen). See #449.
    setSessionPassword(null);
    // The deleted wallet's on-disk password state is gone with it — a fresh
    // onboarding starts with no password until the user (re-)sets one.
    setHasWalletPassword(false);

    // Reinitialize with fresh providers (skip loading spinner — onboarding UI is already visible)
    await initialize(0, true);
  }, [providers, initialize, queryClient, setSessionPassword]);

  // Unlock an encrypted wallet with its password. Re-runs Sphere.init WITH the
  // password (the only place a password is ever passed for an EXISTING
  // wallet); a wrong password throws the same decrypt-mnemonic STORAGE_ERROR
  // as the cold-start check, which we let propagate so the caller
  // (UnlockScreen) can show "wrong password" via isDecryptionError. Reuses the same
  // initGenRef/adoptOrDiscardInstance re-entrancy guard as initialize() (#453)
  // so an unlock superseded mid-flight destroys its instance instead of
  // adopting it.
  const unlock = useCallback(async (password: string) => {
    if (!providers) throw new Error('Providers not initialized');
    const gen = ++initGenRef.current;
    // Snapshot the resolved oracle key exactly like initialize() does, for the
    // post-adopt subscription-key wiring below.
    const oracleApiKey = getActiveOracleApiKey();
    const { sphere: instance } = await Sphere.init({
      ...providers,
      network,
      password,
      discoverAddresses: false,
    });
    const outcome = await adoptOrDiscardInstance(instance, () => gen !== initGenRef.current, (inst) => {
      sphereRef.current = inst;
      setSphere(inst);
      markSessionStart();
    });
    if (outcome !== 'adopted') return;
    // Powers idle auto-lock. Held in memory here; separately REMEMBERED below so a page reload
    // does not demand it again — the remembered copy is encrypted under a non-extractable key
    // and expires with the idle timeout (walletLock/persistedUnlock.ts).
    setSessionPassword(password);
    setIsLocked(false);
    isLockedRef.current = false;
    // Remember the unlock, bounded by this wallet's own auto-lock timeout. Read AFTER
    // setSessionPassword, which is what decodes the encrypted lock settings.
    void savePersistedUnlock(password, idleLockConfigRef.current.timeoutMs);
    // A successful unlock proves the wallet has a password (that's WHY it was locked).
    setHasWalletPassword(true);

    // Mirror initialize()'s existing-wallet success branch (review parity, #449):
    // the destroyed instance took its `identity:changed` reconcile listener with
    // it, so without re-attaching it here a post-unlock address switch would
    // silently stop reconciling the per-wallet subscription key. Deliberately
    // does NOT call sendWelcomeDM — a re-unlock must not re-welcome the user.
    setSubscriptionKeyStatus(
      !SUBSCRIPTION_ENABLED ? 'not-required' : oracleApiKey ? 'ready' : 'provisioning',
    );
    setupSubscriptionKey(instance, oracleApiKey);

    // Run address discovery in background after wallet is visible, same as initialize().
    setIsDiscoveringAddresses(true);
    instance.discoverAddresses({ autoTrack: true }).then(result => {
      if (result.addresses.length > 0) {
        logger.debug('SphereProvider', `Discovered ${result.addresses.length} address(es)`);
      }
    }).catch(err => {
      logger.warn('SphereProvider', 'Address discovery failed', err);
    }).finally(() => {
      setIsDiscoveringAddresses(false);
    });
  }, [providers, network, setupSubscriptionKey, setSessionPassword, markSessionStart]);

  // Lock the wallet: destroy the live Sphere instance (keys leave memory — a
  // real lock, not just a UI gate) and require unlock() again. The dApp SESSION
  // SURVIVES: hosts are told with setLocked(), which preserves the session and
  // answers every subsequent request WALLET_LOCKED (4009) until updateSphere()
  // re-arms them. For a logout use revokeSession() instead; for a non-lock loss
  // of Sphere, setUnavailable().
  const lock = useCallback(async () => {
    // Idempotent — see lockingRef.
    //
    // `sphereRef.current === null` is NOT a reason to bail. That is exactly the state a re-init
    // leaves behind (reinitialize), and a cross-tab lock arriving in that window
    // used to do nothing at all: the tab stayed unlocked, its hosts kept reporting 'live', the
    // lock epoch was never written, and the in-flight init went on to adopt a fully usable
    // Sphere. Bumping initGenRef below is what supersedes that init, so the lock must run.
    //
    // Only an already-locked tab has nothing to do.
    if (lockingRef.current) return;
    if (sphereRef.current === null && isLockedRef.current) return;
    lockingRef.current = true;
    try {
      initGenRef.current++; // supersede any in-flight init
      // EVERY lock path broadcasts (PR #456): the Connect popup is a separate
      // window with its own SphereProvider, so a manual "Lock Wallet" that did
      // not broadcast left it serving RPCs from a fully unlocked Sphere. The
      // loopback this creates terminates on the guard above.
      broadcastLock();
      // Tell every live host BEFORE destroying the instance (ordering
      // contract). ConnectHost drops its Sphere reference inside setLocked()
      // and settles anything already in flight with 4009 — calling destroy()
      // first would leave those requests reading a dead instance (-32603, or
      // `undefined` returned AS SUCCESS from sphere_getIdentity).
      //
      // A fan-out, not a single slot: DesktopLayout keeps every open tab
      // mounted, so a wallet with three framed dApps has three live hosts, and
      // locking only the last-registered one leaves the other two talking to a
      // wallet they believe is unlocked. `forEachConnectHost` reads the
      // module-scoped registry in connectHostRegistry.ts — SphereProvider is an
      // ANCESTOR of ConnectProvider in the tree (see main.tsx), so it can't
      // `useConnectContext()` directly; see that file for why.
      forEachConnectHost((host) => host.setLocked());
      await sphereRef.current?.destroy();
      sphereRef.current = null;
      setSphere(null);
      // Cached balances, history and DMs must not stay readable behind the lock screen.
      //
      // NOT queryClient.clear(): React Query also holds this app's UI state (open desktop
      // tabs, whether the wallet panel is out, app order). DesktopLayout consumes no Sphere
      // hook, so a lock never re-renders it — wiping ['desktop','state'] left its observer
      // bound to a discarded Query and the next setWalletOpen(true) wrote to an instance
      // nobody reads, killing the Wallet button, fullscreen and Escape until a reload. That
      // also killed the "Unlock Wallet" button the locked screens offer. See uiQueryKeys.ts.
      queryClient.removeQueries({ predicate: (q) => !isUiOnlyQuery(q) });
      queryClient.getMutationCache().clear();
      // Memory-only password never survives a lock (#449).
      setSessionPassword(null);
      // Persist the lock so a bfcached / hidden tab that never re-runs
      // initialize() can catch up on resume (graceful lock §8.4).
      markLockEpoch();
      sessionStartedAtRef.current = null;
      // A lock means "ask me again": every lock path forgets the remembered unlock, so the
      // idle timer, a manual lock and a cross-tab lock all really do lock.
      void clearPersistedUnlock();
      setIsLocked(true);
      isLockedRef.current = true;
    } finally {
      lockingRef.current = false;
    }
  }, [queryClient, setSessionPassword]);

  // Settings → Security (#449 Task 8b): set/change/remove the wallet's at-rest
  // password via the VERIFIED-SAFE in-place mnemonic re-encryption
  // (reencryptStoredMnemonic — src/sdk/walletLock/reencryptMnemonic.ts).
  // CRITICAL: never call Sphere.import()/Sphere.clear() to do this — those
  // wipe the token DB. This touches ONLY the mnemonic storage key.
  const setWalletPassword = useCallback(async (newPassword: string) => {
    if (!providers) throw new Error('Providers not initialized');
    await withPasswordOpLock(passwordOpBusyRef, async () => {
      // Read BEFORE re-encrypting: preserve whatever auto-lock timeout is
      // currently in effect so it survives this password change instead of
      // silently resetting to the default (#449 review fix). There is no
      // session password yet on the Set path (passwordRef.current is null),
      // so this resolves to the secure default unless a stray blob exists.
      const preservedMinutes = readCurrentAutoLockMinutes(passwordRef.current);
      await reencryptStoredMnemonic(providers.storage, {
        currentPassword: passwordRef.current,
        newPassword,
      });
      // Re-persist the preserved timeout under the NEW password BEFORE
      // arming the session, so setSessionPassword's own blob read below
      // decodes correctly on the first try instead of falling back to the
      // default (order matters here).
      localStorage.setItem(STORAGE_KEYS.AUTO_LOCK_TIMEOUT, encodeLockSettings(preservedMinutes, newPassword));
      setSessionPassword(newPassword); // memory-only; arms idle auto-lock with the preserved value
      setHasWalletPassword(true);
    });
  }, [providers, setSessionPassword]);

  const changeWalletPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!providers) throw new Error('Providers not initialized');
    await withPasswordOpLock(passwordOpBusyRef, async () => {
      // Same preserve-across-change fix as setWalletPassword, using the
      // caller-verified currentPassword to decode the existing blob (#449
      // review fix).
      const preservedMinutes = readCurrentAutoLockMinutes(currentPassword);
      // reencryptStoredMnemonic itself verifies currentPassword (decrypts +
      // validateMnemonic) and throws "Incorrect current password" on mismatch —
      // nothing is written unless it matches.
      await reencryptStoredMnemonic(providers.storage, {
        currentPassword,
        newPassword,
      });
      localStorage.setItem(STORAGE_KEYS.AUTO_LOCK_TIMEOUT, encodeLockSettings(preservedMinutes, newPassword));
      setSessionPassword(newPassword); // re-arms the idle timer with the preserved value
      setHasWalletPassword(true);
    });
  }, [providers, setSessionPassword]);

  const removeWalletPassword = useCallback(async (currentPassword: string) => {
    if (!providers) throw new Error('Providers not initialized');
    await withPasswordOpLock(passwordOpBusyRef, async () => {
      await reencryptStoredMnemonic(providers.storage, {
        currentPassword,
        newPassword: null,
      });
      // Deliberately does NOT preserve the auto-lock timeout blob: removing
      // the password disarms auto-lock entirely (no password left to
      // encrypt it with), so the stale blob is simply orphaned until a
      // future Set writes a fresh one.
      setSessionPassword(null); // memory-only; disarms idle auto-lock
      setHasWalletPassword(false);
    });
  }, [providers, setSessionPassword]);

  // In-wallet backup gate (#449): read-only password check used by
  // BackupWalletModal before it reveals "Export Wallet File" / "Show
  // Recovery Phrase" (both expose the seed). Deliberately independent of
  // passwordRef/setSessionPassword — this must work purely by re-deriving
  // from on-disk storage, never mutates anything, and never persists the
  // candidate password anywhere. Any failure (missing providers, no stored
  // mnemonic, wrong password, corrupt blob) resolves false — never throws to
  // the caller.
  const verifyWalletPassword = useCallback(async (password: string): Promise<boolean> => {
    if (!providers) return false;
    try {
      const stored = await providers.storage.get(STORAGE_KEYS_GLOBAL.MNEMONIC);
      if (!stored) return false;
      const decrypted = decryptMnemonic(stored, password);
      return validateMnemonic(decrypted);
    } catch {
      return false;
    }
  }, [providers]);

  // Settings → Security auto-lock timeout selector. Only meaningful while a
  // session password is held (the persisted blob is encrypted with it) — a
  // no-op without one, since there's nothing to arm.
  const setAutoLockTimeout = useCallback((value: AutoLockValue) => {
    const password = passwordRef.current;
    if (!password) return;
    localStorage.setItem(STORAGE_KEYS.AUTO_LOCK_TIMEOUT, encodeLockSettings(value, password));
    // Re-read the (now-updated) blob and re-arm the idle timer with it.
    setSessionPassword(password);
  }, [setSessionPassword]);

  useIdleTimer({
    timeoutMs: idleLockConfig.timeoutMs,
    // CRITICAL invariant: a wallet with NO password (existing plaintext
    // wallets, or a fresh create/import where the user skipped the password
    // step) must NEVER auto-lock — `idleLockConfig.enabled` is only ever set
    // true inside setSessionPassword()'s truthy-password branch, and is
    // forced back to false by lock()/deleteWallet() (via setSessionPassword
    // (null)) and by the initial state. `!isLocked` is redundant-but-safe:
    // every path that sets isLocked true (lock(), and initialize()'s
    // classifyInitFailure() === 'locked' branch) also clears/never-set the
    // password.
    enabled: idleLockConfig.enabled && !isLocked,
    // The remembered unlock expires from the last ACTIVITY, not from the unlock, so half an
    // hour of work followed by a reload does not demand the password again. Throttled by
    // useIdleTimer's own activity throttle; a write per rearm is far too often, hence the gate.
    onActivity: () => {
      const now = Date.now();
      if (now - lastTouchRef.current < PERSIST_TOUCH_INTERVAL_MS) return;
      lastTouchRef.current = now;
      void touchPersistedUnlock();
    },
    onIdle: () => {
      // lock() broadcasts for us now — from EVERY lock path, not just this one.
      // A same-name BroadcastChannel receives its own tab's postMessage, so the
      // subscription below re-enters lock() in this tab too; lock()'s
      // exactly-once ref is what makes that a no-op instead of a loop.
      void lock();
    },
  });

  // Another tab deleted the wallet. This one is still holding a live decrypted
  // Sphere over storage that no longer exists — and, now that a Connect session
  // survives a lock, is still serving dApps from it. Tear the instance down and
  // re-init against the (now empty) storage. Deliberately does NOT repeat the
  // destructive work: the originating tab already wiped IndexedDB/localStorage.
  const handleRemoteLogout = useCallback(async () => {
    if (!sphereRef.current) return;
    // The same in-window signal deleteWallet() fires, so every ConnectHost in
    // THIS tab revokes its session (logout ≠ lock).
    window.dispatchEvent(new CustomEvent('sphere:wallet-logout'));
    void clearPersistedUnlock();
    initGenRef.current++;
    await sphereRef.current.destroy();
    sphereRef.current = null;
    setSphere(null);
    setWalletExists(false);
    queryClient.clear();
    setSessionPassword(null);
    setHasWalletPassword(false);
    await initialize(0, true);
  }, [initialize, queryClient, setSessionPassword]);

  useEffect(
    () => subscribeLogoutBroadcast(undefined, () => { void handleRemoteLogout(); }),
    [handleRemoteLogout],
  );

  // Cross-tab lock (#449 Task 8a): a lock triggered in ANY tab — idle timeout
  // or an explicit lock() — must lock this one too, so a decrypted Sphere
  // instance never stays alive in one tab after another tab locked.
  useEffect(() => subscribeLockBroadcast(undefined, () => { void lock(); }), [lock]);

  // Resume gate: a tab restored from the bfcache resumes with its decrypted
  // Sphere intact and never re-runs initialize(); a hidden tab may simply have
  // missed the lock BroadcastChannel message. Both must lock themselves if a
  // lock is on record newer than this tab's session. `pageshow` and
  // `visibilitychange` can both fire for one resume — lock() is idempotent.
  useEffect(() => {
    const check = () => {
      if (!sphereRef.current) return;
      if (isLockPending(sessionStartedAtRef.current)) void lock();
    };
    check();
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [lock]);

  const finalizeWallet = useCallback((importedSphere?: Sphere) => {
    markSessionStart();
    if (importedSphere) {
      sphereRef.current = importedSphere;
      setSphere(importedSphere);
      sendWelcomeDM(importedSphere);
    }
    setWalletExists(true);
    // Clear a stale lock flag: finalizeWallet() is also the exit of the
    // UnlockScreen's "forgot password → restore from recovery phrase" path
    // (#449). Without this, isLocked would stay true forever after a
    // successful restore and the shell gate would keep showing the lock
    // screen instead of the freshly-restored wallet.
    setIsLocked(false);
    isLockedRef.current = false;
    // Reflect whatever createWallet()/importWallet() decided: they already
    // called setSessionPassword() (passwordRef) iff the user chose a password
    // during onboarding/import — mirror that into hasWalletPassword now that
    // the wallet is live in Settings.
    setHasWalletPassword(!!passwordRef.current);
    // The onboarding oracle was built KEYLESS. Wire the subscription key onto this
    // live instance exactly like initialize() does for an existing wallet: resolve
    // / provision it + apply via setOracleApiKey (no full re-init), attach the
    // identity:changed re-key listener, and drive the send gate to a terminal
    // 'ready'/'failed'. (A bare setOracleApiKey here would skip the per-address
    // re-key listener AND the provisioning retry — see #420 review.)
    const inst = importedSphere ?? sphereRef.current;
    if (inst) setupSubscriptionKey(inst, undefined);
  }, [providers, setupSubscriptionKey, markSessionStart]);

  const applySubscriptionKey = useCallback(async (apiKey: string, opts?: { walletWide?: boolean }) => {
    setStoredSubscriptionKey(apiKey);
    const instance = sphereRef.current;
    // No instance (locked, or not initialised yet) means the key lives ONLY in
    // the plaintext boot cache: not durable, and the caller must be told so.
    let durable = false;
    if (instance) {
      // Supersede any in-flight reconcile (bump the generation) so a stale
      // reconcile can't clobber this explicit, user-chosen key.
      const gen = ++subKeyGenRef.current;
      // Bookkeeping (best-effort — the vault entry is a durability upgrade,
      // not a gate): while on the root address (or when explicitly asked) the
      // key becomes WALLET-wide; on any other address it becomes that
      // address's OWN key.
      const rootPubkey = (() => {
        try { return getPublicKey(instance.deriveAddress(0).privateKey); } catch { return null; }
      })();
      const walletWide = opts?.walletWide ?? (rootPubkey !== null && instance.identity?.chainPubkey === rootPubkey);
      durable = await persistKeyDurably(instance, network, apiKey, walletWide);
      // Apply the new key to the LIVE oracle (serialized apply chain — no full
      // re-init, rebuilds only the token engine). Flip 'ready' only once the
      // engine actually carries it.
      await applyOracleKey(instance, apiKey, gen);
      if (gen !== subKeyGenRef.current) return { durable }; // a newer reconcile/apply superseded us
      if (appliedOracleKeyRef.current === apiKey) setSubscriptionKeyStatus('ready');
    }
    return { durable };
  }, [network, applyOracleKey]);

  const value: SphereContextValue = {
    sphere,
    providers,
    network,
    isLoading,
    isInitialized: !!sphere,
    walletExists,
    error,
    isLocked,
    unlock,
    lock,
    hasWalletPassword,
    setWalletPassword,
    changeWalletPassword,
    removeWalletPassword,
    verifyWalletPassword,
    autoLockMinutes,
    setAutoLockTimeout,
    isDiscoveringAddresses,
    initProgress,
    resolveNametag,
    createWallet,
    importWallet,
    importFromFile,
    finalizeWallet,
    deleteWallet,
    reinitialize: initialize,
    applySubscriptionKey,
    subscriptionKeyStatus,
    walletApiEnabled: isWalletApiEnabled(network),
  };

  return (
    <SphereContext.Provider value={value}>{children}</SphereContext.Provider>
  );
}
