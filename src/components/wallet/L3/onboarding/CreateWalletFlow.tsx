/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowRight, Loader2, AtSign, ShieldCheck } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';

export function CreateWalletFlow() {
  const { identity, createWallet, mintNametag, nametag } = useWallet();

  const [step, setStep] = useState<'start' | 'nametag' | 'processing'>('start');
  const [nametagInput, setNametagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleCreateKeys = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await createWallet();
      setStep('nametag');
    } catch (e: any) {
      setError("Failed to generate keys: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleMintNametag = async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);
    setStep('processing');

    try {
      const cleanTag = nametagInput.trim().replace('@', '');
      await mintNametag(cleanTag);
    } catch (e: any) {
      setError(e.message || "Minting failed");
      setStep('nametag');
    } finally {
      setIsBusy(false);
    }
  };

  if (identity && !nametag && step === 'start') {
    setStep('nametag');
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

      <AnimatePresence mode="wait">

        {step === 'start' && (
          <motion.div
            key="start"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative z-10 max-w-xs"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl shadow-orange-500/20">
              <Wallet className="w-10 h-10 text-white" />
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">No Wallet Found</h2>
            <p className="text-neutral-400 mb-8">
              Create a new secure wallet to start using the Unicity Network.
            </p>

            <button
              onClick={handleCreateKeys}
              disabled={isBusy}
              className="w-full py-4 rounded-xl bg-white text-neutral-900 font-bold hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {isBusy ? <Loader2 className="animate-spin" /> : "Create New Wallet"}
            </button>

            {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
          </motion.div>
        )}

        {step === 'nametag' && (
          <motion.div
            key="nametag"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="relative z-10 w-full max-w-xs"
          >
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
            </div>

            <h2 className="text-xl font-bold text-white mb-2">Wallet Created!</h2>
            <p className="text-neutral-400 text-sm mb-6">
              Now, choose a unique <b>@nametag</b> to receive tokens easily without long addresses.
            </p>

            <div className="relative mb-6 group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">
                <AtSign className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={nametagInput}
                onChange={(e) => setNametagInput(e.target.value)}
                placeholder="username"
                className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl py-4 pl-12 pr-4 text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition-colors"
                autoFocus
              />
            </div>

            <button
              onClick={handleMintNametag}
              disabled={!nametagInput || isBusy}
              className="w-full py-4 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white font-bold shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform disabled:opacity-70 disabled:hover:scale-100"
            >
              Continue <ArrowRight className="w-5 h-5" />
            </button>

            {error && <p className="mt-4 text-red-400 text-sm bg-red-500/10 p-2 rounded-lg">{error}</p>}
          </motion.div>
        )}

        {step === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative z-10 text-center"
          >
            <div className="relative mx-auto w-24 h-24 mb-6">
              <div className="absolute inset-0 border-4 border-neutral-800 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-orange-500 rounded-full border-t-transparent animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-2">Setting up Profile...</h3>
            <div className="space-y-1 text-sm text-neutral-500">
              <p>• Minting Nametag on Blockchain</p>
              <p>• Registering on Nostr Relay</p>
              <p>• Finalizing Wallet</p>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}