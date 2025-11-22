import { Wallet, TrendingUp, ArrowUpRight, Plus, Eye, EyeOff, Sparkles } from 'lucide-react';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { mockAssets } from '../../data/mockData';
import { AssetRow } from './components/AssetRow';

export function WalletPanel() {
  const [showBalances, setShowBalances] = useState(true);
  const assets = mockAssets; 

  const totalValue = useMemo(() => assets.reduce((sum, asset) => sum + asset.value, 0), [assets]);

  return (
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden h-full relative shadow-2xl">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl" />
      
      {/* Header */}
      <div className="p-6 border-b border-neutral-800/50 bg-linear-to-br from-neutral-900/80 to-neutral-800/40 backdrop-blur-sm relative z-10">
        {/* Corner decoration */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-bl-full" />
        
        <div className="flex items-center justify-between mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="relative"
            >
              {/* Glow effect */}
              <div className="absolute inset-0 bg-orange-500 rounded-xl blur-lg opacity-50" />
              
              <div className="relative w-10 h-10 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl">
                <Wallet className="w-5 h-5 text-white" />
              </div>
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white">My Wallet</h3>
                <Sparkles className="w-3 h-3 text-orange-500 animate-pulse" />
              </div>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBalances(!showBalances)}
            className="p-2 hover:bg-neutral-800/80 rounded-lg transition-colors border border-transparent hover:border-neutral-700/50"
          >
            {showBalances ? (
              <Eye className="w-4 h-4 text-neutral-400" />
            ) : (
              <EyeOff className="w-4 h-4 text-neutral-400" />
            )}
          </motion.button>
        </div>

        {/* Total Balance */}
        <div className="mb-4 relative z-10">
          <p className="text-xs text-neutral-400 mb-2">Total Balance</p>
          <div className="flex items-end gap-3">
            <h2 className="text-3xl text-white">
              {showBalances ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••••'}
            </h2>
            <motion.div 
              whileHover={{ scale: 1.1 }}
              className="flex items-center gap-1 text-emerald-400 mb-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
            >
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">+12.4%</span>
            </motion.div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 relative z-10">
          {/* Deposit Button */}
          <motion.button 
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={{duration: 0.06}}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-sm transition-all shadow-xl shadow-orange-500/20 hover:shadow-orange-500/40 flex items-center justify-center gap-2 overflow-hidden group"
          >
            <Plus className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Deposit</span>
          </motion.button>
          {/* Send Button */}
          <motion.button 
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={{duration: 0.06}}
            className="relative px-4 py-3 rounded-xl bg-neutral-800/80 hover:bg-neutral-700/80 text-white text-sm transition-colors flex items-center justify-center gap-2 border border-neutral-700/50 hover:border-neutral-600/50 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-orange-500/0 group-hover:bg-orange-500/5 transition-colors" />
            <ArrowUpRight className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Send</span>
          </motion.button>
        </div>
      </div>

      {/* Assets List */}
      <div className="p-6 relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm text-neutral-400">Assets</h4>
          <div className="h-px flex-1 ml-4 bg-linear-to-r from-neutral-700 to-transparent" />
        </div>
        
        <div className="space-y-2">
          {assets.map((asset, index) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              showBalances={showBalances}
              delay={index * 0.05}
            />
          ))}
        </div>

        {/* Add Asset Button */}
        <motion.button 
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full mt-4 p-3 rounded-lg border border-dashed border-neutral-700/50 hover:border-orange-500/30 text-neutral-500 hover:text-orange-400 text-sm transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add Asset</span>
        </motion.button>
      </div>
    </div>
  );
}