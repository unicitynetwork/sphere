import { Wallet, Clock, Bell, MoreVertical, Tag, Loader2, RefreshCw } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { L3WalletView } from './L3/views/L3WalletView';
import { useIdentity, useWalletStatus, useSphereContext } from '../../sdk';
import { useIncomingPaymentRequests } from './L3/hooks/useIncomingPaymentRequests';
import { useUIState } from '../../hooks/useUIState';
import { RegisterNametagModal } from './shared/components/RegisterNametagModal';
import { NewAddressModal } from './shared/modals/NewAddressModal';
import { AddressSelector } from './shared/components';
import { CreateWalletFlow } from './onboarding/CreateWalletFlow';
import { NETWORKS } from '@unicitylabs/sphere-sdk';
import {
  DEFAULT_NETWORK,
  SPHERE_NETWORK,
  SUPPORTED_NETWORKS,
  isMainnetAnnounced,
  resetActiveNetwork,
  shouldAnnounceMainnet,
} from '../../config/network';
import { MainnetAnnouncementModal } from './L3/modals/MainnetAnnouncementModal';
import { UnlockScreen } from './onboarding/components/UnlockScreen';

const PANEL_SHELL = "bg-white dark:bg-modal-bg/50 backdrop-blur-xl overflow-hidden h-full relative lg:border-l lg:border-neutral-100 dark:lg:border-brand-orange-border flex flex-col rounded-2xl";

export function WalletPanel({ autoFocusUnlock = false }: { autoFocusUnlock?: boolean }) {
  const [showBalances, setShowBalances] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNametagModalOpen, setIsNametagModalOpen] = useState(false);
  // #413: derive-address flow — hosted at panel level (like RegisterNametagModal)
  // so the slide-in screen paints above the wallet content in DOM order.
  const [isNewAddressOpen, setIsNewAddressOpen] = useState(false);
  // Mainnet invitation — decided once, at mount, from values that only change
  // on reload anyway (the network is fixed for a page's lifetime). Reading the
  // "already asked" flag in the initialiser keeps it out of the render path.
  const [isMainnetAnnouncementOpen, setIsMainnetAnnouncementOpen] = useState(() =>
    shouldAnnounceMainnet({
      active: SPHERE_NETWORK,
      networks: SUPPORTED_NETWORKS,
      announced: isMainnetAnnounced(),
      defaultNetwork: DEFAULT_NETWORK,
    }),
  );

  // #449: once the user picks "forgot password → restore from recovery
  // phrase" on the UnlockScreen, drop them straight into onboarding's restore
  // flow instead of the unlock prompt. Reset when the wallet unlocks/restores
  // (isLocked flips false) so a future lock starts fresh at the unlock screen.
  const [restoreFromLock, setRestoreFromLock] = useState(false);
  const { isLoading: isWalletLoading, walletExists, error: walletError } = useWalletStatus();
  const { identity, nametag, isLoading: isLoadingIdentity } = useIdentity();
  const { initProgress, isLocked } = useSphereContext();
  const { pendingCount, requests, reject, pay, clearProcessed } = useIncomingPaymentRequests();
  const { setFullscreen } = useUIState();

  // Track previous pending count to detect new requests
  const prevPendingCountRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Auto-open PaymentRequestsModal when new pending request arrives
  useEffect(() => {
    // Skip the very first render - wait for initial data load
    if (!isInitializedRef.current) {
      // Initialize after first real data arrives
      if (requests.length > 0 || pendingCount === 0) {
        prevPendingCountRef.current = pendingCount;
        isInitializedRef.current = true;
      }
      return;
    }

    // Only open if pending count increased (new request arrived)
    if (prevPendingCountRef.current !== null && pendingCount > prevPendingCountRef.current) {
      // Exit fullscreen so the modal is visible
      setFullscreen(false);
      setIsRequestsOpen(true);
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, requests.length, setFullscreen]);

  // Reset the "restore from lock" escape once the wallet is no longer locked
  // (unlocked with the correct password, or a restore just finalized it).
  useEffect(() => {
    if (!isLocked) setRestoreFromLock(false);
  }, [isLocked]);

  // Initialization error (e.g. IndexedDB timeout after retry)
  if (walletError) {
    return (
      <div className={PANEL_SHELL}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 text-red-500" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-neutral-900 dark:text-[#fefefe]">Initialization error</p>
            {/* Show the actual message: composition asserts (#351) name the
                misconfigured env vars — a generic "reload" hides the cause. */}
            <p className="text-xs text-neutral-500 dark:text-[rgba(255,255,255,0.45)] break-words">
              {walletError.message || 'Please reload the page'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => window.location.reload()}
              className="px-5 py-2 bg-linear-to-r from-orange-500 to-orange-600 dark:from-brand-orange dark:to-brand-orange-dark text-white text-sm font-medium rounded-xl"
            >
              Reload
            </motion.button>

            {/* A wallet stranded on a network that cannot start has no way back:
                reloading only repeats the failure, and the Settings screen that
                would switch networks lives behind this very panel. The switcher
                gate cannot prevent every case either — it can only check what
                the SDK advertises, while the refusal can come from deeper (a
                missing trust base). So offer the way out here. */}
            {SPHERE_NETWORK !== DEFAULT_NETWORK && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => resetActiveNetwork()}
                className="px-5 py-2 bg-neutral-100 dark:bg-white/6 hover:bg-neutral-200 dark:hover:bg-white/10 text-neutral-700 dark:text-white text-sm font-medium rounded-xl"
              >
                Switch to {NETWORKS[DEFAULT_NETWORK].name}
              </motion.button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Wallet system still initializing
  if (isWalletLoading) {
    return (
      <div className={PANEL_SHELL}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="relative w-20 h-20">
            <motion.div
              className="absolute inset-0 border-3 border-neutral-200 dark:border-[rgba(255,255,255,0.05)] rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-1.5 border-3 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
              animate={{ rotate: -360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-3 bg-orange-500/20 rounded-full blur-xl" />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <Loader2 className="w-7 h-7 text-orange-500 dark:text-brand-orange animate-spin" />
              </motion.div>
            </div>
          </div>
          {initProgress && (
            <motion.p
              key={initProgress.message}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs text-neutral-500 dark:text-[rgba(255,255,255,0.45)] font-medium"
            >
              {initProgress.message}
            </motion.p>
          )}
        </div>
      </div>
    );
  }

  // Encrypted wallet exists on disk but hasn't been unlocked this session
  // (#449). Gate on `isLocked` ONLY — an existing plaintext wallet always has
  // isLocked === false and must never see this screen (no-wallet-loss
  // constraint). Checked before the `!walletExists` branch below purely for
  // clarity; SphereProvider only ever sets isLocked true while walletExists
  // is already true, so the two branches never actually compete.
  if (isLocked) {
    return (
      <div className={PANEL_SHELL} data-wallet-panel>
        <div className="flex-1 relative overflow-y-auto flex items-center justify-center">
          {restoreFromLock ? (
            <CreateWalletFlow
              initialStep="restoreMethod"
              fromLock
              onExitToUnlock={() => setRestoreFromLock(false)}
            />
          ) : (
            <UnlockScreen autoFocus={autoFocusUnlock} onRestore={() => setRestoreFromLock(true)} />
          )}
        </div>
      </div>
    );
  }

  // No wallet — show onboarding flow inside the panel
  if (!walletExists) {
    return (
      <div className={PANEL_SHELL} data-wallet-panel>
        <div className="flex-1 relative overflow-y-auto">
          <CreateWalletFlow />
        </div>
      </div>
    );
  }

  // Wallet exists but identity still loading
  if (isLoadingIdentity || !identity) {
    return (
      <div className={PANEL_SHELL}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="relative w-20 h-20">
            <motion.div
              className="absolute inset-0 border-3 border-neutral-200 dark:border-[rgba(255,255,255,0.05)] rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-1.5 border-3 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
              animate={{ rotate: -360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-3 bg-orange-500/20 rounded-full blur-xl" />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <Loader2 className="w-7 h-7 text-orange-500 dark:text-brand-orange animate-spin" />
              </motion.div>
            </div>
          </div>
          {initProgress && (
            <motion.p
              key={initProgress.message}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs text-neutral-500 dark:text-[rgba(255,255,255,0.45)] font-medium"
            >
              {initProgress.message}
            </motion.p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={PANEL_SHELL}>

      {/* TOP BAR: Title & Actions */}
      <div className="p-3 sm:p-4 lg:p-6 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-linear-to-br from-orange-500 to-orange-600 dark:from-brand-orange dark:to-brand-orange-dark flex items-center justify-center">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-base text-neutral-900 dark:text-[#fefefe] font-medium tracking-wide" style={{ fontFamily: "'Geist', sans-serif" }}>Wallet</span>
                {!nametag && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsNametagModalOpen(true)}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] sm:text-xs bg-orange-500/10 dark:bg-[rgba(255,111,0,0.1)] hover:bg-orange-500/20 text-orange-600 dark:text-brand-orange rounded-lg transition-colors"
                  >
                    <Tag className="w-3 h-3" />
                    <span>Register ID</span>
                  </motion.button>
                )}
              </div>
              <AddressSelector compact onNewAddress={() => setIsNewAddressOpen(true)} />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsHistoryOpen(true)}
              className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-[rgba(255,255,255,0.06)] rounded-lg transition-colors text-neutral-400 dark:text-[rgba(255,255,255,0.35)] hover:text-neutral-900 dark:hover:text-white"
              title="Transaction history"
            >
              <Clock className="w-5 h-5" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsRequestsOpen(true)}
              className="relative p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-[rgba(255,255,255,0.06)] rounded-lg transition-colors text-neutral-400 dark:text-[rgba(255,255,255,0.35)] hover:text-neutral-900 dark:hover:text-white"
              title="Payment requests"
            >
              <Bell className="w-5 h-5" />
              {pendingCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-[rgba(255,255,255,0.06)] rounded-lg transition-colors text-neutral-400 dark:text-[rgba(255,255,255,0.35)] hover:text-neutral-900 dark:hover:text-white"
              title="Settings"
            >
              <MoreVertical className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* CONTENT AREA - L3 Only */}
      <div className="flex-1 overflow-hidden">
        <L3WalletView
          showBalances={showBalances}
          setShowBalances={setShowBalances}
          isHistoryOpen={isHistoryOpen}
          setIsHistoryOpen={setIsHistoryOpen}
          isRequestsOpen={isRequestsOpen}
          setIsRequestsOpen={setIsRequestsOpen}
          isSettingsOpen={isSettingsOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          paymentRequests={requests}
          paymentRequestsPendingCount={pendingCount}
          paymentRequestsReject={reject}
          paymentRequestsPay={pay}
          paymentRequestsClearProcessed={clearProcessed}
        />
      </div>

      {/* Register Nametag Modal */}
      <RegisterNametagModal
        isOpen={isNametagModalOpen}
        onClose={() => setIsNametagModalOpen(false)}
      />

      {/* New Address flow (#413) */}
      <NewAddressModal
        isOpen={isNewAddressOpen}
        onClose={() => setIsNewAddressOpen(false)}
      />

      {/* Mainnet went live and this wallet is still on a test network — invite
          once, never move it for them. */}
      <MainnetAnnouncementModal
        isOpen={isMainnetAnnouncementOpen}
        onClose={() => setIsMainnetAnnouncementOpen(false)}
      />
    </div>
  );
}
