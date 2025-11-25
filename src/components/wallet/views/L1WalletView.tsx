import { ArrowDownLeft, ArrowUpRight, Fuel, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { l1Assets } from '../../../data/mockData';
import { AssetRow } from '../components/AssetRow';
import { useMemo } from 'react';

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const totalValue = useMemo(() => l1Assets.reduce((sum, asset) => sum + asset.value, 0), []);

  return (
    <div className="flex flex-col h-full">
      {/* L1 Specific Header Stats */}
      <div className="px-6 mb-6">
        <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-blue-300/70">Mainnet Balance</p>
            {/* Unique L1 Feature: Gas Indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20">
                <Fuel className="w-3 h-3 text-blue-400" />
                <span className="text-xs text-blue-300 font-mono">15 Gwei</span>
            </div>
        </div>
        
        <h2 className="text-3xl text-white font-bold tracking-tight mb-4">
          {showBalances 
            ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
            : '••••••'}
        </h2>

        {/* L1 Actions - Bridge focused */}
        <div className="grid grid-cols-2 gap-3">
          <motion.button 
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-blue-600 to-blue-700 text-white text-sm shadow-xl shadow-blue-500/20 flex items-center justify-center gap-2 overflow-hidden"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Receive</span>
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="relative px-4 py-3 rounded-xl bg-neutral-800/80 hover:bg-neutral-700/80 text-white text-sm border border-neutral-700/50 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Bridge</span>
          </motion.button>
        </div>
      </div>

      {/* L1 Assets List */}
      <div className="p-6 pt-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-blue-500" />
            <h4 className="text-sm text-neutral-400">Ethereum Assets</h4>
        </div>
        
        <div className="space-y-2">
            {l1Assets.map((asset, index) => (
                <AssetRow key={asset.id} asset={asset} showBalances={showBalances} delay={index * 0.05} />
            ))}
        </div>
      </div>
    </div>
  );
}