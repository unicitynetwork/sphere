/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, Loader2, User, CheckCircle, Coins, Scissors } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { AggregatedAsset } from '../data/model';
import { NostrService } from '../services/NostrService';
import { IdentityManager } from '../services/IdentityManager';
import { CurrencyUtils } from '../utils/currency';
import { TokenSplitCalculator, type SplitPlan } from '../services/transfer/TokenSplitCalculator';
import { WalletRepository } from '../../../../repositories/WalletRepository';

type Step = 'recipient' | 'asset' | 'amount' | 'confirm' | 'processing' | 'success';

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SendModal({ isOpen, onClose }: SendModalProps) {
  const { assets, sendAmount } = useWallet();

  // State
  const [step, setStep] = useState<Step>('recipient');
  const [recipient, setRecipient] = useState('');
  const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<AggregatedAsset | null>(null);
  const [amountInput, setAmountInput] = useState('');

  // Calculation Preview
  const [splitPlan, setSplitPlan] = useState<SplitPlan | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const reset = () => {
    setStep('recipient');
    setRecipient('');
    setSelectedAsset(null);
    setAmountInput('');
    setSplitPlan(null);
    setRecipientError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // STEP 1: Validate Recipient
  const handleRecipientNext = async () => {
    if (!recipient.trim()) return;
    setIsCheckingRecipient(true);
    setRecipientError(null);

    try {
      const identityManager = IdentityManager.getInstance();
      const nostr = NostrService.getInstance(identityManager);
      const cleanTag = recipient.replace('@', '').replace('@unicity', '').trim();

      const pubkey = await nostr.queryPubkeyByNametag(cleanTag);

      if (pubkey) {
        setRecipient(cleanTag);
        setStep('asset');
      } else {
        setRecipientError(`User @${cleanTag} not found`);
      }
    } catch {
      setRecipientError("Network error");
    } finally {
      setIsCheckingRecipient(false);
    }
  };

  // STEP 3: Calculate Plan (Preview)
  const handleAmountNext = async () => {
    if (!selectedAsset || !amountInput) return;

    const targetAmount = CurrencyUtils.toSmallestUnit(amountInput, selectedAsset.decimals);
    if (targetAmount <= 0n) return;

    setIsCalculating(true);
    try {
      const calculator = new TokenSplitCalculator();
      const walletRepo = WalletRepository.getInstance();
      const allTokens = walletRepo.getTokens();

      const plan = await calculator.calculateOptimalSplit(
        allTokens,
        targetAmount,
        selectedAsset.coinId
      );

      if (plan) {
        setSplitPlan(plan);
        setStep('confirm');
      } else {
        setRecipientError("Insufficient funds or no suitable tokens");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCalculating(false);
    }
  };

  // STEP 4: Execute
  const handleSend = async () => {
    if (!selectedAsset || !amountInput || !recipient) return;

    setStep('processing');

    try {
      console.log(recipient)
      await sendAmount({
        recipientNametag: recipient,
        amount: CurrencyUtils.toSmallestUnit(amountInput, selectedAsset.decimals).toString(),
        coinId: selectedAsset.coinId
      });

      setStep('success');
    } catch (e: any) {
      console.error(e);
      setRecipientError(e.message || "Transfer failed");
      setStep('confirm');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-neutral-200 dark:border-white/5 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
            {step === 'recipient' && 'Send To'}
            {step === 'asset' && 'Select Asset'}
            {step === 'amount' && 'Enter Amount'}
            {step === 'confirm' && 'Confirm Transfer'}
            {step === 'processing' && 'Processing...'}
            {step === 'success' && 'Sent!'}
          </h3>
          <button onClick={handleClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-full transition-colors">
            <X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          </button>
        </div>

        <div className="p-6">
          <AnimatePresence mode="wait">

            {/* 1. RECIPIENT */}
            {step === 'recipient' && (
              <motion.div key="rec" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}>
                <div className="mb-6">
                  <label className="text-sm text-neutral-500 dark:text-neutral-400 block mb-2">Unicity Nametag</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">@</span>
                    <input
                      autoFocus
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRecipientNext()}
                      className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 pl-8 pr-4 text-neutral-900 dark:text-white focus:border-orange-500 outline-none"
                      placeholder="Unicity ID"
                    />
                  </div>
                  {recipientError && <p className="text-red-500 text-sm mt-2">{recipientError}</p>}
                </div>
                <button
                  onClick={handleRecipientNext}
                  disabled={!recipient || isCheckingRecipient}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isCheckingRecipient ? <Loader2 className="animate-spin" /> : <>Continue <ArrowRight size={18} /></>}
                </button>
              </motion.div>
            )}

            {/* 2. ASSET */}
            {step === 'asset' && (
              <motion.div key="asset" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-2">
                {assets.map(asset => (
                  <button
                    key={asset.coinId}
                    onClick={() => { setSelectedAsset(asset); setStep('amount'); }}
                    className="w-full p-3 flex items-center gap-3 bg-neutral-50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-white/5 rounded-xl transition-colors text-left"
                  >
                    <img src={asset.iconUrl || ''} className="w-8 h-8 rounded-full" alt="" />
                    <div className="flex-1">
                      <div className="text-neutral-900 dark:text-white font-medium">{asset.symbol}</div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{asset.getFormattedAmount()} available</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" />
                  </button>
                ))}
              </motion.div>
            )}

            {/* 3. AMOUNT */}
            {step === 'amount' && selectedAsset && (
              <motion.div key="amt" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}>
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-neutral-500 dark:text-neutral-400">Amount</span>
                    <span className="text-neutral-500 dark:text-neutral-400">
                      Available: <span className="text-neutral-900 dark:text-white">{selectedAsset.getFormattedAmount()}</span>
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      autoFocus
                      type="number"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 text-neutral-900 dark:text-white text-2xl font-mono focus:border-orange-500 outline-none"
                      placeholder="0.00"
                    />
                    <button
                      onClick={() => setAmountInput(selectedAsset.getFormattedAmount())}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-neutral-200 dark:bg-neutral-800 text-orange-500 dark:text-orange-400 px-2 py-1 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700"
                    >
                      MAX
                    </button>
                  </div>
                  {recipientError && <p className="text-red-500 text-sm mt-2">{recipientError}</p>}
                </div>
                <button
                  onClick={handleAmountNext}
                  disabled={!amountInput || isCalculating}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isCalculating ? <Loader2 className="animate-spin" /> : "Review"}
                </button>
              </motion.div>
            )}

            {/* 4. CONFIRM (SMART PREVIEW) */}
            {step === 'confirm' && selectedAsset && splitPlan && (
              <motion.div key="conf" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}>

                {/* Summary Card */}
                <div className="bg-neutral-100 dark:bg-neutral-900 rounded-2xl p-5 mb-6 border border-neutral-200 dark:border-white/10 text-center">
                  <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">You are sending</div>
                  <div className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
                    {amountInput} <span className="text-orange-500">{selectedAsset.symbol}</span>
                  </div>

                  <div className="flex items-center justify-center gap-2 text-sm bg-neutral-200 dark:bg-neutral-800/50 p-2 rounded-lg mx-auto max-w-max">
                    <User className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                    <span className="text-neutral-700 dark:text-neutral-300">@{recipient}</span>
                  </div>
                </div>

                {/* Strategy Details */}
                <div className="mb-6 space-y-2">
                  <div className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider ml-1">Strategy</div>

                  {splitPlan.requiresSplit ? (
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-3">
                      <Scissors className="w-5 h-5 text-blue-500 dark:text-blue-400 mt-0.5" />
                      <div>
                        <div className="text-blue-600 dark:text-blue-400 text-sm font-medium">Token Split Required</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                          We will take a token of <b>{CurrencyUtils.toHumanReadable(splitPlan.tokenToSplit!.amount, selectedAsset.decimals)} {selectedAsset.symbol}</b>,
                          send exact amount, and keep the change.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                      <Coins className="w-5 h-5 text-emerald-500 dark:text-emerald-400 mt-0.5" />
                      <div>
                        <div className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Direct Transfer</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                          We found {splitPlan.tokensToTransferDirectly.length} token(s) that match the amount exactly. No split needed.
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {recipientError && <p className="text-red-500 text-sm mb-4 text-center">{recipientError}</p>}

                <button
                  onClick={handleSend}
                  className="w-full py-3 bg-neutral-900 dark:bg-white text-white dark:text-black font-bold rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Confirm & Send
                </button>
              </motion.div>
            )}

            {/* 5. PROCESSING */}
            {step === 'processing' && (
              <motion.div key="proc" className="py-10 text-center">
                <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
                <h3 className="text-neutral-900 dark:text-white font-medium text-lg">Sending Transaction...</h3>
                <p className="text-neutral-500 text-sm mt-2">Processing proofs and broadcasting via Nostr</p>
              </motion.div>
            )}

            {/* 6. SUCCESS */}
            {step === 'success' && (
              <motion.div key="done" className="py-10 text-center">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/50">
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-neutral-900 dark:text-white font-bold text-2xl mb-2">Success!</h3>
                <p className="text-neutral-500 dark:text-neutral-400">
                  Successfully sent <b>{amountInput} {selectedAsset?.symbol}</b> to <b>@{recipient}</b>
                </p>
                <button onClick={handleClose} className="mt-8 px-8 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white transition-colors">
                  Close
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
