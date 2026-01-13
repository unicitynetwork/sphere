import { Wallet, Clock, Bell, MoreVertical } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { L3WalletView } from './L3/views/L3WalletView';
import { useWallet } from './L3/hooks/useWallet';
import { useIncomingPaymentRequests } from './L3/hooks/useIncomingPaymentRequests';
import { L1WalletModal } from './L1/modals/L1WalletModal';
import { AddressSelector } from './shared/components';

export function WalletPanel() {
  const [showBalances, setShowBalances] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isL1WalletOpen, setIsL1WalletOpen] = useState(false);
  const { identity, nametag, isLoadingIdentity } = useWallet();
  const { pendingCount, requests } = useIncomingPaymentRequests();

  // Track previous pending count to detect new requests
  const prevPendingCountRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Auto-open PaymentRequestsModal when new pending request arrives
  useEffect(() => {
    console.log('🔔 WalletPanel useEffect:', {
      pendingCount,
      requestsLength: requests.length,
      prevCount: prevPendingCountRef.current,
      isInitialized: isInitializedRef.current
    });

    // Skip the very first render - wait for initial data load
    if (!isInitializedRef.current) {
      // Initialize after first real data arrives
      if (requests.length > 0 || pendingCount === 0) {
        prevPendingCountRef.current = pendingCount;
        isInitializedRef.current = true;
        console.log('🔔 WalletPanel initialized with pendingCount:', pendingCount);
      }
      return;
    }

    // Only open if pending count increased (new request arrived)
    if (prevPendingCountRef.current !== null && pendingCount > prevPendingCountRef.current) {
      console.log('💰 New payment request detected, opening modal...');
      setIsRequestsOpen(true);
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, requests.length]);

  // Don't render wallet panel if not authenticated - WalletGate handles onboarding
  if (isLoadingIdentity || !identity || !nametag) {
    return null;
  }

  return (
    <div className="bg-white/60 dark:bg-neutral-900/90 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden h-full relative lg:shadow-xl dark:lg:shadow-2xl flex flex-col transition-all duration-500 theme-transition">

      {/* Background Gradients - Orange theme */}
      <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full blur-3xl bg-orange-500/5 dark:bg-orange-500/10" />
      <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full blur-3xl bg-purple-500/5 dark:bg-purple-500/10" />

      {/* TOP BAR: Title & Actions */}
      <div className="p-3 sm:p-4 lg:p-6 pb-2 relative shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="relative"
            >
              <div className="absolute inset-0 rounded-lg sm:rounded-xl blur-lg opacity-50 bg-orange-500" />
              <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl">
                <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            </motion.div>

            <div className="flex flex-col">
              <span className="text-sm sm:text-base text-neutral-900 dark:text-white font-medium tracking-wide">Wallet</span>
              <AddressSelector currentNametag={nametag} compact />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsHistoryOpen(true)}
              className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              title="Transaction history"
            >
              <Clock className="w-5 h-5" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsRequestsOpen(true)}
              className="relative p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
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
              className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              title="Settings"
            >
              <MoreVertical className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* CONTENT AREA - L3 Only */}
      <div className="flex-1 relative overflow-hidden">
        <L3WalletView
          showBalances={showBalances}
          setShowBalances={setShowBalances}
          isHistoryOpen={isHistoryOpen}
          setIsHistoryOpen={setIsHistoryOpen}
          isRequestsOpen={isRequestsOpen}
          setIsRequestsOpen={setIsRequestsOpen}
          isSettingsOpen={isSettingsOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          isL1WalletOpen={isL1WalletOpen}
          setIsL1WalletOpen={setIsL1WalletOpen}
        />
      </div>

      {/* L1 Wallet Modal - renders over entire panel including header */}
      <L1WalletModal
        isOpen={isL1WalletOpen}
        onClose={() => setIsL1WalletOpen(false)}
        showBalances={showBalances}
      />
    </div>
  );
}
