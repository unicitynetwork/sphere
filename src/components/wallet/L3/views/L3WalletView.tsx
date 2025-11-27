import { Plus, ArrowUpRight, Sparkles, TrendingUp, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { AssetRow } from '../../shared/components';
import { useMemo } from 'react';
import { useWallet } from '../hooks/useWallet';
import { CreateWalletFlow } from '../onboarding/CreateWalletFlow';

export function L3WalletView({ showBalances }: { showBalances: boolean }) {
  const { identity, assets, isLoadingAssets, isLoadingIdentity, nametag } = useWallet();
  // const [isSendModalOpen, setIsSendModalOpen] = useState(false);

  const totalValue = useMemo(() => {
    return assets.reduce((sum, asset) => sum + asset.priceUsd, 0);
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
      <div className="px-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-orange-300/70">AgentSphere Balance</p>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
          </div>

          {/* Unique L2 Feature: Yield/APY */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">+12.5% APY</span>
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
            className="relative px-4 py-3 rounded-xl bg-neutral-800/80 hover:bg-neutral-700/80 text-white text-sm border border-neutral-700/50 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Send</span>
          </motion.button>
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
        ) : assets.length === 0 ? (
          <div className="text-center py-10 flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-neutral-600" />
            </div>
            <div className="text-neutral-500 text-sm">
              Wallet is empty.<br />Mint some tokens to start!
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {assets.map((asset, index) => (
              <AssetRow
                key={asset.coinId}
                asset={asset}
                showBalances={showBalances}
                delay={index * 0.05}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}