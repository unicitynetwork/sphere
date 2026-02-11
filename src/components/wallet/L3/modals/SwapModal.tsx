/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDownUp, Loader2, TrendingUp, CheckCircle, ArrowDown } from 'lucide-react';
import { useIdentity, useAssets, useTransfer } from '../../../../sdk';
import type { Asset } from '@unicitylabs/sphere-sdk';
import { toSmallestUnit, toHumanReadable } from '@unicitylabs/sphere-sdk';
import { TokenRegistry } from '@unicitylabs/sphere-sdk';
import { FaucetService } from '../../../../services/FaucetService';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { BaseModal, ModalHeader, Button } from '../../ui';

type Step = 'swap' | 'processing' | 'success';

/** Format asset amount from smallest unit to human-readable */
function formatAssetAmount(asset: Asset): string {
  return toHumanReadable(asset.totalAmount, asset.decimals);
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SwapModal({ isOpen, onClose }: SwapModalProps) {
  const { nametag } = useIdentity();
  const { assets } = useAssets();
  const { transfer } = useTransfer();
  const { providers } = useSphereContext();

  // State
  const [step, setStep] = useState<Step>('swap');
  const [fromAsset, setFromAsset] = useState<Asset | null>(null);
  const [toAsset, setToAsset] = useState<Asset | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allSwappableAssets, setAllSwappableAssets] = useState<Asset[]>([]);

  // Load all available swappable coins from registry
  useEffect(() => {
    const loadSwappableCoins = async () => {
      const registry = TokenRegistry.getInstance();
      const definitions = registry.getAllDefinitions();

      // Only include coins supported by the faucet for swapping
      const SUPPORTED_SWAP_COINS = ['bitcoin', 'ethereum', 'solana', 'unicity', 'tether', 'usd-coin', 'unicity-usd'];

      // Filter only fungible assets that are supported by faucet
      const fungibleDefs = definitions.filter(def =>
        def.assetKind === 'fungible' && SUPPORTED_SWAP_COINS.includes(def.name.toLowerCase())
      );

      // Fetch prices from SDK price provider if available
      const tokenNames = fungibleDefs.map(def => def.name.toLowerCase());
      let pricesMap = new Map<string, { priceUsd: number; priceEur?: number; change24h?: number }>();
      if (providers?.price) {
        try {
          pricesMap = await providers.price.getPrices(tokenNames);
        } catch (e) {
          console.warn('Failed to fetch prices:', e);
        }
      }

      const swappableAssets: Asset[] = fungibleDefs.map(def => {
        const symbol = def.symbol || def.name.toUpperCase();
        const priceData = pricesMap.get(def.name.toLowerCase());
        const iconUrl = registry.getIconUrl(def.id);

        return {
          coinId: def.id,
          symbol: symbol,
          name: def.name,
          totalAmount: '0',
          decimals: def.decimals || 0,
          tokenCount: 0,
          iconUrl: iconUrl ?? undefined,
          priceUsd: priceData?.priceUsd ?? 1.0,
          priceEur: priceData?.priceEur ?? 0.92,
          change24h: priceData?.change24h ?? 0,
          fiatValueUsd: null,
          fiatValueEur: null,
        };
      });

      setAllSwappableAssets(swappableAssets);
    };

    if (isOpen) {
      loadSwappableCoins();
    }
  }, [isOpen]);

  // Get user's balance for a specific coin (from their owned assets)
  const getUserBalance = (coinId: string): string => {
    const userAsset = assets.find(a => a.coinId === coinId);
    return userAsset ? formatAssetAmount(userAsset) : '0';
  };

  // Calculate exchange rate and output amount
  const exchangeInfo = useMemo(() => {
    if (!fromAsset || !toAsset || !fromAmount || parseFloat(fromAmount) <= 0) {
      return null;
    }

    const fromAmountNum = parseFloat(fromAmount);
    const fromPrice = fromAsset.priceUsd ?? 0;
    const toPrice = toAsset.priceUsd ?? 0;

    if (toPrice === 0) return null;

    const rate = fromPrice / toPrice;
    const toAmount = fromAmountNum * rate;

    return {
      rate,
      fromValueUSD: fromAmountNum * fromPrice,
      toAmount,
      toValueUSD: toAmount * toPrice,
    };
  }, [fromAsset, toAsset, fromAmount]);

  const reset = () => {
    setStep('swap');
    setFromAsset(null);
    setToAsset(null);
    setFromAmount('');
    setError(null);
    setShowFromDropdown(false);
    setShowToDropdown(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSwap = async () => {
    if (!fromAsset || !toAsset || !fromAmount || !exchangeInfo || !nametag) return;

    setStep('processing');
    setError(null);

    try {
      // Step 1: Send tokens to 'swap' nametag
      const fromAmountSmallestUnit = toSmallestUnit(fromAmount, fromAsset.decimals);

      await transfer({
        recipient: 'swap',
        amount: fromAmountSmallestUnit.toString(),
        coinId: fromAsset.coinId
      });

      // Step 2: Request swapped tokens from faucet
      await FaucetService.requestTokens(
        nametag,
        toAsset.name!.toLowerCase(), // Use full coin name (bitcoin, ethereum, etc)
        exchangeInfo.toAmount
      );

      setStep('success');
    } catch (e: any) {
      console.error('Swap failed:', e);
      setError(e.message || 'Swap failed');
      setStep('swap');
    }
  };

  const handleFlipAssets = () => {
    if (!fromAsset || !toAsset) return;

    // When flipping, we need to:
    // 1. Find the user's actual asset for the "to" coin (to become new "from")
    // 2. Find the swappable asset for the "from" coin (to become new "to")
    const newFromAsset = assets.find(a => a.coinId === toAsset.coinId);
    const newToAsset = allSwappableAssets.find(a => a.coinId === fromAsset.coinId);

    // Only allow flip if user has the "to" asset in their wallet
    if (!newFromAsset) {
      setError(`You don't have any ${toAsset.symbol} to swap from`);
      return;
    }

    setFromAsset(newFromAsset);
    setToAsset(newToAsset || fromAsset);
    setError(null);

    // Transfer the "to" amount to "from" field (max 6 decimal places)
    if (exchangeInfo && exchangeInfo.toAmount > 0) {
      const roundedAmount = parseFloat(exchangeInfo.toAmount.toFixed(6));
      setFromAmount(roundedAmount.toString());
    } else {
      setFromAmount('');
    }
  };

  // Validate amount
  const isValidAmount = useMemo(() => {
    if (!fromAsset || !fromAmount) return false;
    const amount = parseFloat(fromAmount);
    if (isNaN(amount) || amount <= 0) return false;
    const maxAmount = parseFloat(formatAssetAmount(fromAsset));
    return amount <= maxAmount;
  }, [fromAsset, fromAmount]);

  const getTitle = () => {
    switch (step) {
      case 'swap': return 'Swap Tokens';
      case 'processing': return 'Processing Swap...';
      case 'success': return 'Swap Complete!';
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} showOrbs={false}>
      <ModalHeader title={getTitle()} onClose={handleClose} />

      <div className="p-6">
        <AnimatePresence mode="wait">

          {/* SWAP INTERFACE */}
          {step === 'swap' && (
            <motion.div
              key="swap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* FROM Section */}
              <div className="mb-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">From</span>
                  {fromAsset && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate ml-2">
                      Balance: <span className="text-neutral-900 dark:text-white">{formatAssetAmount(fromAsset)}</span>
                    </span>
                  )}
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    {/* Token Selector */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowFromDropdown(!showFromDropdown)}
                        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors whitespace-nowrap"
                      >
                        {fromAsset ? (
                          <>
                            <img src={fromAsset.iconUrl || ''} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full shrink-0" alt="" />
                            <span className="text-neutral-900 dark:text-white font-medium text-sm sm:text-base">{fromAsset.symbol}</span>
                          </>
                        ) : (
                          <span className="text-neutral-500 text-sm sm:text-base">Select</span>
                        )}
                        <ArrowDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-400 shrink-0" />
                      </button>

                      {/* From Dropdown */}
                      {showFromDropdown && (
                        <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl shadow-xl z-60 max-h-48 overflow-y-auto">
                          {assets.map(asset => (
                            <button
                              key={asset.coinId}
                              onClick={() => {
                                setFromAsset(asset);
                                setShowFromDropdown(false);
                                setFromAmount('');
                              }}
                              className="w-full flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors text-left"
                            >
                              <img src={asset.iconUrl || ''} className="w-6 h-6 rounded-full" alt="" />
                              <div className="flex-1 min-w-0">
                                <div className="text-neutral-900 dark:text-white font-medium text-sm truncate">{asset.symbol}</div>
                                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{formatAssetAmount(asset)}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Amount Input */}
                    <input
                      type="number"
                      value={fromAmount}
                      onChange={(e) => setFromAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={!fromAsset}
                      className="flex-1 bg-transparent text-right text-xl sm:text-2xl font-mono text-neutral-900 dark:text-white outline-none disabled:opacity-50 min-w-0"
                    />
                  </div>

                  {fromAsset && fromAmount && (
                    <div className="mt-2 text-right text-xs text-neutral-500 dark:text-neutral-400">
                      ≈ ${(parseFloat(fromAmount) * (fromAsset.priceUsd ?? 0)).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>

              {/* Flip Button */}
              <div className="flex justify-center items-center mt-4 mb-1 relative z-10">
                <button
                  onClick={handleFlipAssets}
                  className="p-2 bg-white dark:bg-neutral-900 border-2 border-neutral-200 dark:border-neutral-700 rounded-full hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <ArrowDownUp className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                </button>
              </div>

              {/* TO Section */}
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">To</span>
                  {toAsset && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate ml-2">
                      Balance: <span className="text-neutral-900 dark:text-white">{getUserBalance(toAsset.coinId)}</span>
                    </span>
                  )}
                </div>

                <div className="bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl p-3 sm:p-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    {/* Token Selector */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowToDropdown(!showToDropdown)}
                        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors whitespace-nowrap"
                      >
                        {toAsset ? (
                          <>
                            <img src={toAsset.iconUrl || ''} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full shrink-0" alt="" />
                            <span className="text-neutral-900 dark:text-white font-medium text-sm sm:text-base">{toAsset.symbol}</span>
                          </>
                        ) : (
                          <span className="text-neutral-500 text-sm sm:text-base">Select</span>
                        )}
                        <ArrowDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-400 shrink-0" />
                      </button>

                      {/* To Dropdown - Shows ALL available coins for swap */}
                      {showToDropdown && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl shadow-xl z-60 max-h-48 overflow-y-auto">
                          {allSwappableAssets.map(asset => (
                            <button
                              key={asset.coinId}
                              onClick={() => {
                                setToAsset(asset);
                                setShowToDropdown(false);
                              }}
                              className="w-full flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors text-left"
                            >
                              <img src={asset.iconUrl || ''} className="w-6 h-6 rounded-full" alt="" />
                              <div className="flex-1 min-w-0">
                                <div className="text-neutral-900 dark:text-white font-medium text-sm truncate">{asset.symbol}</div>
                                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{getUserBalance(asset.coinId)}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Amount Output */}
                    <div className="flex-1 text-right text-xl sm:text-2xl font-mono text-neutral-900 dark:text-white break-all min-w-0">
                      {exchangeInfo ? exchangeInfo.toAmount.toFixed(6) : '0.00'}
                    </div>
                  </div>

                  {exchangeInfo && (
                    <div className="mt-2 text-right text-xs text-neutral-500 dark:text-neutral-400">
                      ≈ ${exchangeInfo.toValueUSD.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>

              {/* Exchange Rate Info */}
              {exchangeInfo && fromAsset && toAsset && (
                <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Exchange Rate</span>
                  </div>
                  <div className="text-sm text-neutral-700 dark:text-neutral-300">
                    1 {fromAsset.symbol} = {exchangeInfo.rate.toFixed(6)} {toAsset.symbol}
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              {/* Swap Button */}
              <Button
                onClick={handleSwap}
                disabled={!isValidAmount || !toAsset || !exchangeInfo}
                icon={ArrowDownUp}
                fullWidth
              >
                Swap Tokens
              </Button>
            </motion.div>
          )}

          {/* PROCESSING */}
          {step === 'processing' && (
            <motion.div
              key="processing"
              className="py-10 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
              <h3 className="text-neutral-900 dark:text-white font-medium text-lg">Processing Swap...</h3>
              <p className="text-neutral-500 text-sm mt-2">Sending tokens and requesting swap</p>
            </motion.div>
          )}

          {/* SUCCESS */}
          {step === 'success' && fromAsset && toAsset && exchangeInfo && (
            <motion.div
              key="success"
              className="py-10 text-center"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/50">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-neutral-900 dark:text-white font-bold text-2xl mb-2">Swap Complete!</h3>
              <p className="text-neutral-500 dark:text-neutral-400 mb-1">
                Swapped <b>{fromAmount} {fromAsset.symbol}</b>
              </p>
              <p className="text-neutral-500 dark:text-neutral-400">
                for <b>{exchangeInfo.toAmount.toFixed(6)} {toAsset.symbol}</b>
              </p>
              <button
                onClick={handleClose}
                className="mt-8 px-8 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white transition-colors"
              >
                Close
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </BaseModal>
  );
}
