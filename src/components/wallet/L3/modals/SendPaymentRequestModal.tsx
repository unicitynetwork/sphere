/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, User, CheckCircle, Hash, Receipt } from 'lucide-react';
import { TokenRegistry, toSmallestUnit } from '@unicitylabs/sphere-sdk';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { BaseModal, ModalHeader, Button } from '../../ui';

type Step = 'recipient' | 'coin' | 'amount' | 'confirm' | 'processing' | 'success';

interface CoinOption {
  coinId: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl?: string;
}

export interface PaymentRequestPrefill {
  to: string;
  amount: string;
  coinId: string;
  message?: string;
}

interface SendPaymentRequestModalProps {
  isOpen: boolean;
  onClose: (result?: { success: boolean; requestId?: string }) => void;
  prefill?: PaymentRequestPrefill;
}

export function SendPaymentRequestModal({ isOpen, onClose, prefill }: SendPaymentRequestModalProps) {
  const { sphere } = useSphereContext();

  // State
  const [step, setStep] = useState<Step>('recipient');
  const [recipientMode, setRecipientMode] = useState<'nametag' | 'direct'>('nametag');
  const [recipient, setRecipient] = useState('');
  const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const [availableCoins, setAvailableCoins] = useState<CoinOption[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<CoinOption | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  // Load all fungible coins from TokenRegistry
  useEffect(() => {
    if (!isOpen) return;
    const registry = TokenRegistry.getInstance();
    const definitions = registry.getAllDefinitions();

    const coins: CoinOption[] = definitions
      .filter(def => def.assetKind === 'fungible')
      .map(def => ({
        coinId: def.id,
        symbol: def.symbol || def.name.toUpperCase(),
        name: def.name,
        decimals: def.decimals || 0,
        iconUrl: registry.getIconUrl(def.id) ?? undefined,
      }));

    setAvailableCoins(coins);
  }, [isOpen]);

  // Pre-fill from connect intent (dApp request)
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (!prefill || !isOpen || prefillApplied.current) return;
    if (availableCoins.length === 0) return;

    const { to, amount, coinId, message } = prefill;

    if (to.startsWith('DIRECT://')) {
      setRecipientMode('direct');
      setRecipient(to);
    } else {
      setRecipientMode('nametag');
      setRecipient(to.replace(/^@/, ''));
    }

    setAmountInput(amount);
    if (message) setMessageInput(message);

    const coin = availableCoins.find(c => c.coinId === coinId);
    if (coin) {
      setSelectedCoin(coin);
      setStep('confirm');
      prefillApplied.current = true;
    }
  }, [prefill, isOpen, availableCoins]);

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
    setSelectedCoin(null);
    setAmountInput('');
    setMessageInput('');
    setRecipientError(null);
    setError(null);
    setRequestId(null);
    prefillApplied.current = false;
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
      if (recipientMode === 'direct') {
        const addr = recipient.trim();
        if (!addr.startsWith('DIRECT://')) {
          setRecipientError('Direct address must start with DIRECT://');
          return;
        }
        setRecipient(addr);
        setStep('coin');
      } else {
        const cleanTag = recipient.replace('@', '').replace('@unicity', '').trim();
        const transport = sphere?.getTransport();

        if (transport?.resolveNametag) {
          const pubkey = await transport.resolveNametag(cleanTag);
          if (pubkey) {
            setRecipient(cleanTag);
            setStep('coin');
          } else {
            setRecipientError(`User @${cleanTag} not found`);
          }
        } else {
          setRecipient(cleanTag);
          setStep('coin');
        }
      }
    } catch {
      setRecipientError('Network error');
    } finally {
      setIsCheckingRecipient(false);
    }
  };

  // STEP 3: Go to confirm
  const handleAmountNext = () => {
    if (!selectedCoin || !amountInput) return;
    const targetAmount = toSmallestUnit(amountInput, selectedCoin.decimals);
    if (targetAmount <= 0n) return;
    setStep('confirm');
  };

  // STEP 4: Send payment request via SDK
  const handleSendRequest = async () => {
    if (!selectedCoin || !amountInput || !recipient) return;

    setStep('processing');
    setError(null);

    try {
      const amount = toSmallestUnit(amountInput, selectedCoin.decimals).toString();
      const recipientStr = recipientMode === 'nametag' ? `@${recipient}` : recipient;

      const result = await sphere!.payments.sendPaymentRequest(recipientStr, {
        amount,
        coinId: selectedCoin.coinId,
        ...(messageInput ? { message: messageInput } : {}),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to send payment request');
      }

      setRequestId(result.requestId || null);
      setStep('success');
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to send payment request');
      setStep('confirm');
    }
  };

  const handleSuccessClose = () => {
    reset();
    onClose({ success: true, requestId: requestId || undefined });
  };

  const getTitle = () => {
    switch (step) {
      case 'recipient': return 'Request From';
      case 'coin': return 'Select Currency';
      case 'amount': return 'Enter Amount';
      case 'confirm': return 'Confirm Request';
      case 'processing': return 'Sending...';
      case 'success': return 'Request Sent!';
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
                  {recipientMode === 'nametag' ? 'Who should pay you?' : 'Direct Address'}
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

          {/* 2. COIN SELECTION (all coins from registry, no balance) */}
          {step === 'coin' && (
            <motion.div key="coin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              {availableCoins.map(coin => (
                <button
                  key={coin.coinId}
                  onClick={() => { setSelectedCoin(coin); setStep('amount'); }}
                  className="w-full p-3 flex items-center gap-3 bg-neutral-50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-white/5 rounded-xl transition-colors text-left"
                >
                  {coin.iconUrl ? (
                    <img src={coin.iconUrl} className="w-8 h-8 rounded-full" alt="" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-500">
                      {coin.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="text-neutral-900 dark:text-white font-medium">{coin.symbol}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-neutral-400 dark:text-neutral-600" />
                </button>
              ))}
            </motion.div>
          )}

          {/* 3. AMOUNT */}
          {step === 'amount' && selectedCoin && (
            <motion.div key="amt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-6">
                <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
                  Amount ({selectedCoin.symbol})
                </div>
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setAmountInput(v);
                  }}
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 text-neutral-900 dark:text-white text-2xl font-mono outline-none focus:border-orange-500"
                  placeholder="0.00"
                />
              </div>
              <div className="mb-6">
                <label className="text-sm text-neutral-500 dark:text-neutral-400 block mb-2">Message (optional)</label>
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 text-neutral-900 dark:text-white outline-none focus:border-orange-500 text-sm"
                  placeholder="e.g. Payment for order #1234"
                />
              </div>
              <Button
                onClick={handleAmountNext}
                disabled={!amountInput}
                fullWidth
              >
                Review
              </Button>
            </motion.div>
          )}

          {/* 4. CONFIRM */}
          {step === 'confirm' && selectedCoin && (
            <motion.div key="conf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

              {/* Summary Card */}
              <div className="bg-neutral-100 dark:bg-neutral-900 rounded-2xl p-5 mb-6 border border-neutral-200 dark:border-white/10 text-center">
                <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">You are requesting</div>
                <div className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
                  {amountInput} <span className="text-orange-500">{selectedCoin.symbol}</span>
                </div>

                <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">from</div>
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
                {messageInput && (
                  <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-3 italic">
                    &ldquo;{messageInput}&rdquo;
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="mb-6 space-y-2">
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-3">
                  <Receipt className="w-5 h-5 text-blue-500 dark:text-blue-400 mt-0.5" />
                  <div>
                    <div className="text-blue-600 dark:text-blue-400 text-sm font-medium">Payment Request</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                      The recipient will receive a notification and can choose to pay or decline.
                    </div>
                  </div>
                </div>
              </div>

              {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}

              <button
                onClick={handleSendRequest}
                className="w-full py-3 bg-neutral-900 dark:bg-white text-white dark:text-black font-bold rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Send Request
              </button>
            </motion.div>
          )}

          {/* 5. PROCESSING */}
          {step === 'processing' && (
            <motion.div key="proc" className="py-10 text-center">
              <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
              <h3 className="text-neutral-900 dark:text-white font-medium text-lg">Sending Payment Request...</h3>
              <p className="text-neutral-500 text-sm mt-2">Delivering request via Nostr</p>
            </motion.div>
          )}

          {/* 6. SUCCESS */}
          {step === 'success' && (
            <motion.div key="done" className="py-10 text-center">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/50">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-neutral-900 dark:text-white font-bold text-2xl mb-2">Request Sent!</h3>
              <p className="text-neutral-500 dark:text-neutral-400">
                Payment request for <b>{amountInput} {selectedCoin?.symbol}</b> sent to <b>{recipientMode === 'direct' ? recipient : `@${recipient}`}</b>
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
