import { Wallet, Eye, EyeOff, Layers, Network } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { L1WalletView } from './L1/views/L1WalletView';
import { L3WalletView } from './L3/views/L3WalletView';

type LayerType = 'L1' | 'L3';

export function WalletPanel() {
  const [showBalances, setShowBalances] = useState(true);
  const [activeLayer, setActiveLayer] = useState<LayerType>('L3');

  return (
    <div className="bg-white/60 dark:bg-neutral-900/90 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden h-full relative shadow-xl dark:shadow-2xl flex flex-col transition-all duration-500 theme-transition">

      {/* Dynamic Background Gradients */}
      <div className={`absolute -top-20 -right-20 w-80 h-80 rounded-full blur-3xl transition-colors duration-700 ${activeLayer === 'L3' ? 'bg-orange-500/5 dark:bg-orange-500/10' : 'bg-blue-500/5 dark:bg-blue-500/10'}`} />
      <div className={`absolute -bottom-20 -left-20 w-80 h-80 rounded-full blur-3xl transition-colors duration-700 ${activeLayer === 'L3' ? 'bg-purple-500/5 dark:bg-purple-500/10' : 'bg-emerald-500/5 dark:bg-emerald-500/10'}`} />

      {/* TOP BAR: Title & Toggle */}
      <div className="p-4 md:p-6 pb-2 relative z-10 shrink-0">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="relative"
            >
              <div className={`absolute inset-0 rounded-xl blur-lg opacity-50 transition-colors ${activeLayer === 'L3' ? 'bg-orange-500' : 'bg-blue-500'}`} />
              <div className={`relative w-10 h-10 rounded-xl bg-linear-to-br flex items-center justify-center shadow-xl transition-colors ${activeLayer === 'L3' ? 'from-orange-500 to-orange-600' : 'from-blue-500 to-blue-600'}`}>
                <Wallet className="w-5 h-5 text-white" />
              </div>
            </motion.div>

            <div className="flex flex-col">
                 <span className="text-neutral-900 dark:text-white font-medium tracking-wide">My Wallet</span>
                 <span className="text-xs text-neutral-500">{activeLayer === 'L3' ? 'AgentSphere' : 'Ethereum'}</span>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBalances(!showBalances)}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </motion.button>
        </div>

        {/* CUSTOM TOGGLE */}
        <div className="bg-neutral-100 dark:bg-neutral-900/50 p-1 rounded-xl border border-neutral-200 dark:border-neutral-800/50 flex relative mb-2">
            <button
                onClick={() => setActiveLayer('L1')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg relative z-10 transition-colors ${activeLayer === 'L1' ? 'text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
                <Layers className="w-3 h-3" />
                <span>Layer 1</span>
            </button>
            <button
                onClick={() => setActiveLayer('L3')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg relative z-10 transition-colors ${activeLayer === 'L3' ? 'text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
                <Network className="w-3 h-3" />
                <span>Layer 3</span>
            </button>

            {/* Sliding Indicator */}
            <motion.div
                className={`absolute top-1 bottom-1 rounded-lg shadow-lg ${activeLayer === 'L3' ? 'bg-linear-to-r from-orange-500 to-orange-600' : 'bg-linear-to-r from-blue-600 to-blue-700'}`}
                initial={false}
                animate={{
                    x: activeLayer === 'L1' ? '0%' : '100%',
                    width: '50%'
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
        </div>
      </div>

      {/* DYNAMIC CONTENT AREA */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
            {activeLayer === 'L1' ? (
                <motion.div
                    key="L1"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0"
                >
                    <L1WalletView showBalances={showBalances} />
                </motion.div>
            ) : (
                <motion.div
                    key="L3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0"
                >
                    <L3WalletView showBalances={showBalances} />
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </div>
  );
}
