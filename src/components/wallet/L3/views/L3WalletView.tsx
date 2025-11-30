import { Plus, ArrowUpRight, Sparkles, Loader2, Coins, Layers, Bell } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { AssetRow } from '../../shared/components';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { CreateWalletFlow } from '../onboarding/CreateWalletFlow';
import { TokenRow } from '../../shared/components';
import { SendModal } from '../modals/SendModal';
import { useIncomingPaymentRequests } from '../hooks/useIncomingPaymentRequests';
import { PaymentRequestsModal } from '../modals/PaymentRequestModal';

type Tab = 'assets' | 'tokens';

export function L3WalletView({ showBalances }: { showBalances: boolean }) {
  const { identity, assets, tokens, isLoadingAssets, isLoadingIdentity, nametag } = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>('assets');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);

  const { pendingCount } = useIncomingPaymentRequests();

  const prevPendingCount = useRef(0);

  useEffect(() => {
    if (pendingCount > prevPendingCount.current) {
      console.log("🔔 New payment request received! Opening modal...");
      setIsRequestsOpen(true);
    }
    prevPendingCount.current = pendingCount;
  }, [pendingCount]);

  const totalValue = useMemo(() => {
    console.log(assets)
    return assets.reduce((sum, asset) => sum + asset.getTotalFiatValue('USD'), 0);
  }, [assets]);

  if (isLoadingIdentity) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-neutral-600" />
      </div>
    );
  }

  if (!identity || !nametag) {
    return <CreateWalletFlow />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* L2 Specific Header Stats */}
      <div className="px-6 mb-6 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-orange-300/70">AgentSphere Balance</p>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
          </div>

          <div className="flex items-center gap-3">
                 <button 
                    onClick={() => setIsRequestsOpen(true)}
                    className="relative p-1.5 rounded-lg hover:bg-white/10 transition-colors group"
                 >
                    <Bell className={`w-5 h-5 ${pendingCount > 0 ? 'text-white' : 'text-neutral-500'}`} />
                    {pendingCount > 0 && (
                        <span className="absolute top-0 right-0 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border-2 border-[#0a0a0a]"></span>
                        </span>
                    )}
                 </button>
            </div>
        </div>

        <h2 className="text-3xl text-white font-bold tracking-tight mb-4">
          {showBalances
            ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '••••••'}
        </h2>

        {/* L2 Actions - Speed focused */}
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 text-white text-sm shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 overflow-hidden"
          >
            <Plus className="w-4 h-4" />
            <span>Top Up</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsSendModalOpen(true)}
            className="relative px-4 py-3 rounded-xl bg-neutral-800/80 hover:bg-neutral-700/80 text-white text-sm border border-neutral-700/50 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Send</span>
          </motion.button>
        </div>
      </div>

      <div className="px-6 mb-4 shrink-0">
        <div className="flex p-1 bg-neutral-900/50 rounded-xl border border-neutral-800">
          <button
            onClick={() => setActiveTab('assets')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'assets' ? 'text-white' : 'text-neutral-500 hover:text-neutral-400'}`}
          >
            {activeTab === 'assets' && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-neutral-800 rounded-lg shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Layers className="w-3 h-3" /> Assets
            </span>
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'tokens' ? 'text-white' : 'text-neutral-500 hover:text-neutral-400'}`}
          >
            {activeTab === 'tokens' && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-neutral-800 rounded-lg shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Coins className="w-3 h-3" /> UTXOs
            </span>
          </button>
        </div>
      </div>

      {/* L2 Assets List */}
      <div className="p-6 pt-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <h4 className="text-sm text-neutral-400">Network Assets</h4>
          </div>
          <button className="text-xs text-orange-400 hover:text-orange-300">Manage</button>
        </div>

        {isLoadingAssets ? (
          <div className="py-10 text-center">
            <Loader2 className="w-6 h-6 text-orange-500 animate-spin mx-auto" />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'assets' ? (
              /* ASSETS VIEW */
              <motion.div
                key="assets"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                {assets.length === 0 ? (
                  <EmptyState />
                ) : (
                  assets.map((asset, index) => (
                    <AssetRow
                      key={asset.coinId}
                      asset={asset}
                      showBalances={showBalances}
                      delay={index * 0.05}
                    />
                  ))
                )}
              </motion.div>
            ) : (
              <motion.div
                key="tokens"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                {tokens.filter(t => t.type !== 'Nametag').length === 0 ? (
                  <EmptyState text="No individual tokens found." />
                ) : (
                  tokens
                    .filter(t => t.type !== 'Nametag')
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map((token, index) => (
                      <TokenRow
                        key={token.id}
                        token={token}
                        delay={index * 0.05}
                      />
                    ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
      <SendModal isOpen={isSendModalOpen} onClose={() => setIsSendModalOpen(false)} />

      <PaymentRequestsModal isOpen={isRequestsOpen} onClose={() => setIsRequestsOpen(false)} />
    </div>
  );
}

// Helper Component
function EmptyState({ text }: { text?: string }) {
  return (
    <div className="text-center py-10 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-neutral-600" />
      </div>
      <div className="text-neutral-500 text-sm">
        {text || <>Wallet is empty.<br />Mint some tokens to start!</>}
      </div>
    </div>
  );
}