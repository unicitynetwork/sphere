import { Wallet, Eye, EyeOff, Layers, Network, Copy, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { L1WalletView } from './L1/views/L1WalletView';
import { L3WalletView } from './L3/views/L3WalletView';
import { useWallet } from './L3/hooks/useWallet';
import { STORAGE_KEYS } from '../../config/storageKeys';

type LayerType = 'L1' | 'L3';

const getInitialLayer = (): LayerType => {
  const saved = localStorage.getItem(STORAGE_KEYS.WALLET_ACTIVE_LAYER);
  return saved === 'L1' ? 'L1' : 'L3';
};

export function WalletPanel() {
  const [showBalances, setShowBalances] = useState(true);
  const [activeLayer, setActiveLayer] = useState<LayerType>(getInitialLayer);

  const handleLayerChange = (layer: LayerType) => {
    setActiveLayer(layer);
    localStorage.setItem(STORAGE_KEYS.WALLET_ACTIVE_LAYER, layer);
  };
  const [copied, setCopied] = useState(false);
  const { identity, nametag, isLoadingIdentity } = useWallet();

  // Auto-switch to L3 when payment request is received
  // Note: This hook must be called before any early returns
  useEffect(() => {
    const handlePaymentRequest = () => {
      console.log("💰 Payment request received, switching to L3...");
      handleLayerChange('L3');
    };

    window.addEventListener('payment-requests-updated', handlePaymentRequest);

    return () => {
      window.removeEventListener('payment-requests-updated', handlePaymentRequest);
    };
  }, []);

  // Don't render wallet panel if not authenticated - WalletGate handles onboarding
  if (isLoadingIdentity || !identity || !nametag) {
    return null;
  }

  const handleCopyNametag = async () => {
    if (!nametag) return;
    try {
      await navigator.clipboard.writeText(`${nametag}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy nametag:', err);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-neutral-900/90 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden h-full relative lg:shadow-xl dark:lg:shadow-2xl flex flex-col transition-all duration-500 theme-transition">

      {/* Dynamic Background Gradients */}
      <div className={`absolute -top-20 -right-20 w-80 h-80 rounded-full blur-3xl transition-colors duration-700 ${activeLayer === 'L3' ? 'bg-orange-500/5 dark:bg-orange-500/10' : 'bg-blue-500/5 dark:bg-blue-500/10'}`} />
      <div className={`absolute -bottom-20 -left-20 w-80 h-80 rounded-full blur-3xl transition-colors duration-700 ${activeLayer === 'L3' ? 'bg-purple-500/5 dark:bg-purple-500/10' : 'bg-emerald-500/5 dark:bg-emerald-500/10'}`} />

      {/* TOP BAR: Title & Toggle */}
      <div className="p-3 sm:p-4 lg:p-6 pb-2 relative z-10 shrink-0">
        <div className="flex items-center justify-between mb-2 sm:mb-3 lg:mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="relative"
            >
              <div className={`absolute inset-0 rounded-lg sm:rounded-xl blur-lg opacity-50 transition-colors ${activeLayer === 'L3' ? 'bg-orange-500' : 'bg-blue-500'}`} />
              <div className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-linear-to-br flex items-center justify-center shadow-xl transition-colors ${activeLayer === 'L3' ? 'from-orange-500 to-orange-600' : 'from-blue-500 to-blue-600'}`}>
                <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            </motion.div>

            <div className="flex flex-col">
                 <span className="text-sm sm:text-base text-neutral-900 dark:text-white font-medium tracking-wide">Wallet</span>
                 <div className="flex items-center gap-1.5">
                   <span className="text-[10px] sm:text-xs text-neutral-500">
                     {nametag ? `@${nametag}` : 'AgentSphere'}
                   </span>
                   {nametag && (
                     <motion.button
                       whileHover={{ scale: 1.1 }}
                       whileTap={{ scale: 0.9 }}
                       onClick={handleCopyNametag}
                       className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded transition-colors"
                       title="Copy nametag"
                     >
                       {copied ? (
                         <Check className="w-3 h-3 text-emerald-500" />
                       ) : (
                         <Copy className="w-3 h-3 text-neutral-500 " />
                       )}
                     </motion.button>
                   )}
                 </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBalances(!showBalances)}
            className="p-1.5 sm:p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
          >
            {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </motion.button>
        </div>

        {/* CUSTOM TOGGLE */}
        <div className="bg-neutral-100 dark:bg-neutral-900/50 p-1 rounded-lg sm:rounded-xl border border-neutral-200 dark:border-neutral-800/50 flex relative mb-1">
            <button
                onClick={() => handleLayerChange('L1')}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-md sm:rounded-lg relative z-10 transition-colors ${activeLayer === 'L1' ? 'text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
                <Layers className="w-3 h-3" />
                <span>Layer 1</span>
            </button>
            <button
                onClick={() => handleLayerChange('L3')}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-md sm:rounded-lg relative z-10 transition-colors ${activeLayer === 'L3' ? 'text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
            >
                <Network className="w-3 h-3" />
                <span>Layer 3</span>
            </button>

            {/* Sliding Indicator */}
            <motion.div
                className={`absolute top-1 bottom-1 left-1 rounded-md sm:rounded-lg shadow-lg ${activeLayer === 'L3' ? 'bg-linear-to-r from-orange-500 to-orange-600' : 'bg-linear-to-r from-blue-600 to-blue-700'}`}
                initial={false}
                animate={{
                    x: activeLayer === 'L1' ? '0%' : '100%',
                    width: 'calc(50% - 0.25rem)'
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
        </div>
      </div>

      {/* DYNAMIC CONTENT AREA - Both components stay mounted */}
      <div className="flex-1 relative overflow-hidden">
        <motion.div
          initial={false}
          animate={{ x: activeLayer === 'L1' ? '0%' : '-100%' }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0"
          style={{ pointerEvents: activeLayer === 'L1' ? 'auto' : 'none' }}
        >
          <L1WalletView showBalances={showBalances} />
        </motion.div>
        <motion.div
          initial={false}
          animate={{ x: activeLayer === 'L3' ? '0%' : '100%' }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0"
          style={{ pointerEvents: activeLayer === 'L3' ? 'auto' : 'none' }}
        >
          <L3WalletView showBalances={showBalances} />
        </motion.div>
      </div>
    </div>
  );
}
