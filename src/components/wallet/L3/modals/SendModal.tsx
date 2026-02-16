/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, User, CheckCircle, Coins, Hash } from 'lucide-react';
import type { Asset } from '@unicitylabs/sphere-sdk';
import { toSmallestUnit } from '@unicitylabs/sphere-sdk';
import { useAssets, useTransfer, formatAmount } from '../../../../sdk';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { BaseModal, ModalHeader, Button } from '../../ui';

type Step = 'recipient' | 'asset' | 'amount' | 'confirm' | 'processing' | 'success';

export interface SendPrefill {
  to: string;
  amount: string;
  coinId: string;
  memo?: string;
}

interface SendModalProps {
  isOpen: boolean;
  onClose: (result?: { success: boolean }) => void;
  prefill?: SendPrefill;
}

export function SendModal({ isOpen, onClose, prefill }: SendModalProps) {
  const { assets: sdkAssets } = useAssets();
  const { transfer, isLoading: isTransferring } = useTransfer();
  const { sphere } = useSphereContext();

  const assets = sdkAssets;

  // State
  const [step, setStep] = useState<Step>('recipient');
  const [recipientMode, setRecipientMode] = useState<'nametag' | 'direct'>('nametag');
  const [recipient, setRecipient] = useState('');
  const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [memoInput, setMemoInput] = useState('');

  // Pre-fill from connect intent (dApp request)
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (!prefill || !isOpen || prefillApplied.current) return;
    if (assets.length === 0) return; // wait for assets to load

    const { to, amount, coinId } = prefill;

    if (to.startsWith('DIRECT://')) {
      setRecipientMode('direct');
      setRecipient(to);
    } else {
      setRecipientMode('nametag');
      setRecipient(to.replace(/^@/, ''));
    }

    setAmountInput(amount);
    if (prefill.memo) setMemoInput(prefill.memo);

    const asset = assets.find(a => a.coinId === coinId);
    if (asset) {
      setSelectedAsset(asset);
      setStep('confirm');
      prefillApplied.current = true;
    }
  }, [prefill, isOpen, assets]);

  const handleRecipientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (recipientMode === 'nametag') {
      const value = e.target.value.toLowerCase();
      if (/^@?[a-z0-9_\-+.]*$/.test(value)) {
        setRecipient(value);
        setRecipientError(null);
      }
    } else {
      setRecipient(e.target.value);
      setRecipientError(null);
    }
  };

  const reset = () => {
    setStep('recipient');
    setRecipientMode('nametag');
    setRecipient('');
    setSelectedAsset(null);
    setAmountInput('');
    setMemoInput('');
    setRecipientError(null);
    prefillApplied.current = false;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // STEP 1: Validate Recipient via SDK transport
  const handleRecipientNext = async () => {
    if (!recipient.trim()) return;
    setIsCheckingRecipient(true);
    setRecipientError(null);

    try {
      if (recipientMode === 'direct') {
        const addr = recipient.trim();
        if (!addr.startsWith('DIRECT://')) {
          setRecipientError('Direct address must start with DIRECT://');
          return;
        }
        setRecipient(addr);
        setStep('asset');
      } else {
        const cleanTag = recipient.replace('@', '').replace('@unicity', '').trim();
        const transport = sphere?.getTransport();

        if (transport?.resolveNametag) {
          const pubkey = await transport.resolveNametag(cleanTag);
          if (pubkey) {
            setRecipient(cleanTag);
            setStep('asset');
          } else {
            setRecipientError(`User @${cleanTag} not found`);
          }
        } else {
          setRecipient(cleanTag);
          setStep('asset');
        }
      }
    } catch {
      setRecipientError("Network error");
    } finally {
      setIsCheckingRecipient(false);
    }
  };

  // STEP 3: Go to confirm
  const handleAmountNext = () => {
    if (!selectedAsset || !amountInput) return;
    const targetAmount = toSmallestUnit(amountInput, selectedAsset.decimals);
    if (targetAmount <= 0n) return;
    setStep('confirm');
  };

  // STEP 4: Execute transfer via SDK
  const handleSend = async () => {
    if (!selectedAsset || !amountInput || !recipient) return;

    setStep('processing');
    setRecipientError(null);

    try {
      const amount = toSmallestUnit(amountInput, selectedAsset.decimals).toString();
      await transfer({
        coinId: selectedAsset.coinId,
        amount,
        recipient,
        ...(memoInput ? { memo: memoInput } : {}),
      });

      setStep('success');
    } catch (e: any) {
      console.error(e);
      setRecipientError(e.message || "Transfer failed");
      setStep('confirm');
    }
  };

  const handleSuccessClose = () => {
    reset();
    onClose({ success: true });
  };

  const getTitle = () => {
    switch (step) {
      case 'recipient': return 'Send To';
      case 'asset': return 'Select Asset';
      case 'amount': return 'Enter Amount';
      case 'confirm': return 'Confirm Transfer';
      case 'processing': return 'Processing...';
      case 'success': return 'Sent!';
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} showOrbs={false}>
      <ModalHeader title={getTitle()} onClose={handleClose} />

      <div className="px-6 py-3 flex-1 flex flex-col justify-center overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* 1. RECIPIENT */}
          {step === 'recipient' && (
            <motion.div key="rec" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-6">
                <label className="text-sm text-neutral-500 dark:text-neutral-400 block mb-2">
                  {recipientMode === 'nametag' ? 'Unicity Nametag' : 'Direct Address'}
                </label>
                <div className="relative">
                  {recipientMode === 'nametag' && (
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500">@</span>
                  )}
                  <input
                    autoFocus
                    value={recipient}
                    onChange={handleRecipientChange}
                    onKeyDown={(e) => e.key === 'Enter' && handleRecipientNext()}
                    className={`w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 pr-4 text-neutral-900 dark:text-white focus:border-orange-500 outline-none ${recipientMode === 'nametag' ? 'pl-8' : 'pl-4 font-mono text-sm'}`}
                    placeholder={recipientMode === 'nametag' ? 'Unicity ID' : 'DIRECT://...'}
                  />
                </div>
                {recipientError && <p className="text-red-500 text-sm mt-2">{recipientError}</p>}
                <button
                  onClick={() => { setRecipientMode(recipientMode === 'nametag' ? 'direct' : 'nametag'); setRecipient(''); setRecipientError(null); }}
                  className="text-[11px] text-neutral-400 dark:text-neutral-500 hover:text-orange-500 dark:hover:text-orange-400 mt-2 transition-colors"
                >
                  {recipientMode === 'nametag' ? 'Use direct address instead' : 'Use nametag instead'}
                </button>
              </div>

              <Button
                onClick={handleRecipientNext}
                disabled={!recipient || isCheckingRecipient}
                loading={isCheckingRecipient}
                loadingText="Checking..."
                icon={ArrowRight}
                iconPosition="right"
                fullWidth
              >
                Continue
              </Button>
            </motion.div>
          )}

          {/* 2. ASSET */}
          {step === 'asset' && (
            <motion.div key="asset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              {assets.map(asset => (
                <button
                  key={asset.coinId}
                  onClick={() => { setSelectedAsset(asset); setStep('amount'); }}
                  className="w-full p-3 flex items-center gap-3 bg-neutral-50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-white/5 rounded-xl transition-colors text-left"
                >
                  <img src={asset.iconUrl || ''} className="w-8 h-8 rounded-full" alt="" />
                  <div className="flex-1">
                    <div className="text-neutral-900 dark:text-white font-medium">{asset.symbol}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{formatAmount(asset.totalAmount, asset.decimals)} available</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" />
                </button>
              ))}
            </motion.div>
          )}

          {/* 3. AMOUNT */}
          {step === 'amount' && selectedAsset && (() => {
            const insufficientBalance = amountInput !== '' && toSmallestUnit(amountInput, selectedAsset.decimals) > BigInt(selectedAsset.totalAmount);
            return (
            <motion.div key="amt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-neutral-500 dark:text-neutral-400">Amount</span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    Available: <span className="text-neutral-900 dark:text-white">{formatAmount(selectedAsset.totalAmount, selectedAsset.decimals)}</span>
                  </span>
                </div>
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^\d*\.?\d*$/.test(v)) setAmountInput(v);
                    }}
                    className={`w-full bg-neutral-100 dark:bg-neutral-900 border rounded-xl py-3 px-4 text-neutral-900 dark:text-white text-2xl font-mono outline-none ${insufficientBalance ? 'border-red-500 focus:border-red-500' : 'border-neutral-200 dark:border-white/10 focus:border-orange-500'}`}
                    placeholder="0.00"
                  />
                  <button
                    onClick={() => setAmountInput(formatAmount(selectedAsset.totalAmount, selectedAsset.decimals))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-neutral-200 dark:bg-neutral-800 text-orange-500 dark:text-orange-400 px-2 py-1 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700"
                  >
                    MAX
                  </button>
                </div>
                {insufficientBalance && <p className="text-red-500 text-sm mt-2">Insufficient balance</p>}
                {recipientError && <p className="text-red-500 text-sm mt-2">{recipientError}</p>}
              </div>
              <div className="mb-6">
                <label className="text-sm text-neutral-500 dark:text-neutral-400 block mb-2">Memo (optional)</label>
                <input
                  type="text"
                  value={memoInput}
                  onChange={(e) => setMemoInput(e.target.value)}
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 text-neutral-900 dark:text-white outline-none focus:border-orange-500 text-sm"
                  placeholder="Add a note to this transfer"
                />
              </div>
              <Button
                onClick={handleAmountNext}
                disabled={!amountInput || insufficientBalance}
                fullWidth
              >
                Review
              </Button>
            </motion.div>
            );
          })()}

          {/* 4. CONFIRM */}
          {step === 'confirm' && selectedAsset && (
            <motion.div key="conf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

              {/* Summary Card */}
              <div className="bg-neutral-100 dark:bg-neutral-900 rounded-2xl p-5 mb-6 border border-neutral-200 dark:border-white/10 text-center">
                <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">You are sending</div>
                <div className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
                  {amountInput} <span className="text-orange-500">{selectedAsset.symbol}</span>
                </div>

                <div className="flex items-center justify-center gap-2 text-sm bg-neutral-200 dark:bg-neutral-800/50 p-2 rounded-lg mx-auto max-w-max">
                  {recipientMode === 'direct' ? (
                    <Hash className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  ) : (
                    <User className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  )}
                  <span className={`text-neutral-700 dark:text-neutral-300 ${recipientMode === 'direct' ? 'font-mono text-xs break-all' : ''}`}>
                    {recipientMode === 'direct' ? recipient : `@${recipient}`}
                  </span>
                </div>
                {memoInput && (
                  <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-3 italic">
                    &ldquo;{memoInput}&rdquo;
                  </div>
                )}
              </div>

              {/* Strategy Info */}
              <div className="mb-6 space-y-2">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                  <Coins className="w-5 h-5 text-emerald-500 dark:text-emerald-400 mt-0.5" />
                  <div>
                    <div className="text-emerald-600 dark:text-emerald-400 text-sm font-medium">Smart Transfer</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                      Token splitting and transfer optimization is handled automatically.
                    </div>
                  </div>
                </div>
              </div>

              {recipientError && <p className="text-red-500 text-sm mb-4 text-center">{recipientError}</p>}

              <button
                onClick={handleSend}
                disabled={isTransferring}
                className="w-full py-3 bg-neutral-900 dark:bg-white text-white dark:text-black font-bold rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
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
                Successfully sent <b>{amountInput} {selectedAsset?.symbol}</b> to <b>{recipientMode === 'direct' ? recipient : `@${recipient}`}</b>
              </p>
              <button onClick={handleSuccessClose} className="mt-8 px-8 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white transition-colors">
                Close
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </BaseModal>
  );
}
