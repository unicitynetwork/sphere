import { Plus, ArrowUpRight, ArrowDownUp, Sparkles, Loader2, Coins, Layers, CheckCircle, XCircle, Eye, EyeOff, Wifi } from 'lucide-react';
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { AssetRow } from '../../shared/components';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIdentity, useAssets, useTokens, useL1Balance } from '../../../../sdk';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { CreateWalletFlow } from '../../onboarding/CreateWalletFlow';
import { TokenRow } from '../../shared/components';
import { SendModal } from '../modals/SendModal';
import { SwapModal } from '../modals/SwapModal';
import { PaymentRequestsModal } from '../modals/PaymentRequestModal';
import { FaucetService } from '../../../../services/FaucetService';
import { SeedPhraseModal } from '../modals/SeedPhraseModal';
import { TransactionHistoryModal } from '../modals/TransactionHistoryModal';
import { SettingsModal } from '../modals/SettingsModal';
import { BackupWalletModal, LogoutConfirmModal } from '../../shared/modals';
import { SaveWalletModal } from '../../L1/components/modals';
type Tab = 'assets' | 'tokens';

// Animated balance display with smooth number transitions
function BalanceDisplay({
  totalValue,
  showBalances,
  onToggle,
  isLoading
}: {
  totalValue: number;
  showBalances: boolean;
  onToggle: () => void;
  isLoading?: boolean;
}) {
  const motionValue = useMotionValue(0);
  const displayed = useTransform(motionValue, (v) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  useEffect(() => {
    // Only animate if current value differs from target
    if (Math.abs(motionValue.get() - totalValue) > 0.001) {
      const controls = animate(motionValue, totalValue, {
        duration: 0.5,
        ease: 'easeOut',
      });
      return controls.stop;
    }
  }, [totalValue, motionValue]);

  return (
    <div className="flex items-center gap-3">
      <h2 className="text-4xl text-neutral-900 dark:text-white font-bold tracking-tight">
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-32 h-9 bg-neutral-200 dark:bg-neutral-700 rounded-lg animate-pulse" />
          </span>
        ) : showBalances ? (
          <motion.span>{displayed}</motion.span>
        ) : (
          '••••••'
        )}
      </h2>
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={onToggle}
        className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-colors text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
        title={showBalances ? "Hide balances" : "Show balances"}
      >
        {showBalances ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
      </motion.button>
    </div>
  );
}

// Inline status line showing current wallet activity
function WalletStatusLine({
  isLoadingAssets,
  isLoadingL1,
  pendingCount,
}: {
  isLoadingAssets: boolean;
  isLoadingL1: boolean;
  pendingCount: number;
}) {
  const items: { label: string; spinning?: boolean }[] = [];

  if (isLoadingAssets) items.push({ label: 'Loading assets', spinning: true });
  if (isLoadingL1) items.push({ label: 'Loading L1 balance', spinning: true });
  if (pendingCount > 0) items.push({ label: `${pendingCount} pending transfer${pendingCount > 1 ? 's' : ''}` });

  if (items.length === 0) return null;

  // Show the first (most relevant) status item
  const current = items[0];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.label}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        className="flex items-center justify-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"
      >
        {current.spinning ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Wifi className="w-3 h-3" />
        )}
        <span>{current.label}...</span>
      </motion.div>
    </AnimatePresence>
  );
}

interface L3WalletViewProps {
  showBalances: boolean;
  setShowBalances: (value: boolean) => void;
  isHistoryOpen: boolean;
  setIsHistoryOpen: (value: boolean) => void;
  isRequestsOpen: boolean;
  setIsRequestsOpen: (value: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (value: boolean) => void;
  isL1WalletOpen: boolean;
  setIsL1WalletOpen: (value: boolean) => void;
}

export function L3WalletView({
  showBalances,
  setShowBalances,
  isHistoryOpen,
  setIsHistoryOpen,
  isRequestsOpen,
  setIsRequestsOpen,
  isSettingsOpen,
  setIsSettingsOpen,
  setIsL1WalletOpen,
}: L3WalletViewProps) {
  const navigate = useNavigate();

  // SDK hooks
  const { identity, nametag, isLoading: isLoadingIdentity } = useIdentity();
  const { assets: sdkAssets, isLoading: isLoadingAssets } = useAssets();
  const { tokens: sdkTokens, pendingTokens } = useTokens();
  const { balance: l1BalanceData, isLoading: isLoadingL1 } = useL1Balance();
  const { sphere, deleteWallet } = useSphereContext();

  const assets = sdkAssets;

  const tokens = sdkTokens;

  // L1 balance as a number (ALPHA units)
  const l1Balance = useMemo(() => {
    if (!l1BalanceData?.total) return 0;
    return Number(l1BalanceData.total) / 1e8;
  }, [l1BalanceData]);

  const [activeTab, setActiveTab] = useState<Tab>('assets');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isSeedPhraseOpen, setIsSeedPhraseOpen] = useState(false);
  const [seedPhrase, setSeedPhrase] = useState<string[]>([]);
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  // Track previous token/asset IDs to detect truly new items
  const prevTokenIdsRef = useRef<Set<string>>(new Set());
  const prevAssetCoinIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  // Compute new token IDs by comparing with previous snapshot
  const newTokenIds = useMemo(() => {
    if (isFirstLoadRef.current) {
      return new Set<string>(); // First load - no animations
    }

    const newIds = new Set<string>();
    tokens.filter(t => t.coinId !== 'NAMETAG').forEach(token => {
      if (!prevTokenIdsRef.current.has(token.id)) {
        newIds.add(token.id);
      }
    });
    return newIds;
  }, [tokens]);

  // Compute new asset IDs by comparing with previous snapshot
  const newAssetCoinIds = useMemo(() => {
    if (isFirstLoadRef.current) {
      return new Set<string>(); // First load - no animations
    }

    const newIds = new Set<string>();
    if (l1Balance > 0 && !prevAssetCoinIdsRef.current.has('l1-alpha')) {
      newIds.add('l1-alpha');
    }
    assets.forEach(asset => {
      if (!prevAssetCoinIdsRef.current.has(asset.coinId)) {
        newIds.add(asset.coinId);
      }
    });
    return newIds;
  }, [assets, l1Balance]);

  // Update previous snapshots after render (for next comparison)
  useEffect(() => {
    const currentIds = new Set(tokens.filter(t => t.coinId !== 'NAMETAG').map(t => t.id));
    prevTokenIdsRef.current = currentIds;
    isFirstLoadRef.current = false;
  }, [tokens]);

  useEffect(() => {
    const currentIds = new Set(assets.map(a => a.coinId));
    if (l1Balance > 0) currentIds.add('l1-alpha');
    prevAssetCoinIdsRef.current = currentIds;
  }, [assets, l1Balance]);

  // New modal states
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSaveWalletOpen, setIsSaveWalletOpen] = useState(false);

  // Stable callback for toggling balance visibility (for memoized BalanceDisplay)
  const handleToggleBalances = useCallback(() => {
    setShowBalances(!showBalances);
  }, [showBalances, setShowBalances]);

  // Create L1 ALPHA asset
  const l1AlphaAsset = useMemo(() => {
    const satoshis = BigInt(Math.round(l1Balance * 100000000));
    const totalAmount = satoshis.toString();
    const fiatValue = l1Balance * 1.0; // priceUsd = 1.0
    return {
      coinId: 'l1-alpha',
      symbol: 'ALPHA',
      name: 'Unicity Alphanet',
      totalAmount,
      decimals: 8,
      tokenCount: 1,
      iconUrl: undefined,
      priceUsd: 1.0,
      priceEur: 0.92,
      change24h: 0,
      fiatValueUsd: fiatValue,
      fiatValueEur: fiatValue * 0.92,
    } satisfies import('@unicitylabs/sphere-sdk').Asset;
  }, [l1Balance]);

  const totalValue = useMemo(() => {
    // Sum up L3 asset values (using SDK-provided fiat values for accuracy)
    const l3Value = sdkAssets.reduce((sum, asset) => sum + (asset.fiatValueUsd ?? 0), 0);
    const l1Value = l1AlphaAsset.fiatValueUsd ?? 0;
    return l3Value + l1Value;
  }, [sdkAssets, l1AlphaAsset]);

  const handleTopUp = async () => {
    if (!nametag) {
      setFaucetError('Nametag is required to request tokens');
      return;
    }

    setIsFaucetLoading(true);
    setFaucetError(null);
    setFaucetSuccess(false);

    try {
      const results = await FaucetService.requestAllCoins(nametag);
      const failedRequests = results.filter(r => !r.success);

      if (failedRequests.length > 0) {
        const failedCoins = failedRequests.map(r => r.coin).join(', ');
        setFaucetError(`Failed to request: ${failedCoins}`);
      } else {
        setFaucetSuccess(true);
        setTimeout(() => setFaucetSuccess(false), 3000);
      }
    } catch (error) {
      setFaucetError(error instanceof Error ? error.message : 'Failed to request tokens');
    } finally {
      setIsFaucetLoading(false);
    }
  };

  const handleShowSeedPhrase = () => {
    if (!sphere) return;
    const mnemonic = sphere.getMnemonic();
    if (mnemonic) {
      setSeedPhrase(mnemonic.split(' '));
      setIsSeedPhraseOpen(true);
    } else {
      alert("Recovery phrase not available.\n\nThis wallet was imported from a file that doesn't contain a mnemonic phrase. Only the master key was imported.");
    }
  };

  // Check if mnemonic is available
  const hasMnemonic = useMemo(() => {
    return sphere?.getMnemonic() !== null;
  }, [sphere]);

  // Handle export wallet file (using SDK's exportToJSON)
  const handleExportWalletFile = () => {
    setIsSaveWalletOpen(true);
  };

  // Handle save wallet
  const handleSaveWallet = async (filename: string, password?: string) => {
    if (!sphere) return;
    try {
      const jsonData = await sphere.exportToJSON({ password, includeMnemonic: true });
      const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setIsSaveWalletOpen(false);
    } catch (err) {
      console.error('Failed to save wallet:', err);
    }
  };

  // Handle logout
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      // Await full cleanup before navigating so IntroPage sees clean state
      // (WELCOME_ACCEPTED cleared, walletExists=false).
      await deleteWallet();
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to logout:', err);
      setIsLoggingOut(false);
    }
  };

  // Handle backup and logout
  const handleBackupAndLogout = () => {
    setIsLogoutConfirmOpen(false);
    setIsBackupOpen(true);
  };

  // Format L1 balance for settings modal
  const formatL1Balance = (balance: number) => {
    return balance.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  };

  if (isLoadingIdentity) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-neutral-400 dark:text-neutral-600" />
      </div>
    );
  }

  if (!identity) {
    return <CreateWalletFlow />;
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Main Balance - Centered with Eye Toggle */}
      <div className="px-6 mb-6 shrink-0">
        <div className="flex flex-col items-center justify-center mb-6 pt-2">
          <BalanceDisplay
            totalValue={totalValue}
            showBalances={showBalances}
            onToggle={handleToggleBalances}
            isLoading={isLoadingAssets && totalValue === 0}
          />
          <WalletStatusLine
            isLoadingAssets={isLoadingAssets}
            isLoadingL1={isLoadingL1}
            pendingCount={pendingTokens.length}
          />
        </div>

        {/* Actions - Speed focused */}
        <div className="grid grid-cols-3 gap-3">
          <motion.button
            whileHover={{ scale: isFaucetLoading ? 1 : 1.02, y: isFaucetLoading ? 0 : -2 }}
            whileTap={{ scale: isFaucetLoading ? 1 : 0.98 }}
            onClick={handleTopUp}
            disabled={isFaucetLoading || !nametag}
            className="relative px-3 py-3 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 text-white text-sm shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFaucetLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Requesting...</span>
              </>
            ) : faucetSuccess ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span className="hidden sm:inline">Success!</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Top Up</span>
              </>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsSwapModalOpen(true)}
            className="relative px-3 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 text-neutral-900 dark:text-white text-sm border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2"
          >
            <ArrowDownUp className="w-4 h-4" />
            <span>Swap</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsSendModalOpen(true)}
            className="relative px-3 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 text-neutral-900 dark:text-white text-sm border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Send</span>
          </motion.button>
        </div>

        {/* Error feedback */}
        <AnimatePresence>
          {faucetError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
            >
              <XCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{faucetError}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-6 mb-4 shrink-0">
        <div className="flex p-1 bg-neutral-100 dark:bg-neutral-900/50 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => setActiveTab('assets')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'assets' ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-400'}`}
          >
            {activeTab === 'assets' && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-white dark:bg-neutral-800 rounded-lg shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Layers className="w-3 h-3" /> Assets
            </span>
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all relative ${activeTab === 'tokens' ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-400'}`}
          >
            {activeTab === 'tokens' && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-white dark:bg-neutral-800 rounded-lg shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Coins className="w-3 h-3" /> Tokens
            </span>
          </button>
        </div>
      </div>

      {/* Assets List */}
      <div className="p-6 pt-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <h4 className="text-sm text-neutral-500 dark:text-neutral-400">Network Assets</h4>
          </div>
        </div>

        <div className="relative min-h-[200px]">
          {isLoadingAssets ? (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 text-orange-500 animate-spin mx-auto" />
            </div>
          ) : (
            <>
              {/* ASSETS VIEW - no container animation, only item animations */}
              {activeTab === 'assets' && (
                <div className="space-y-2">
                  {assets.length === 0 && l1Balance === 0 ? (
                    <EmptyState />
                  ) : (
                    <>
                      {/* L1 ALPHA - only show if balance > 0 */}
                      {l1Balance > 0 && (
                        <AssetRow
                          key="l1-alpha"
                          asset={l1AlphaAsset}
                          showBalances={showBalances}
                          delay={newAssetCoinIds.has('l1-alpha') ? 0 : 0}
                          layer="L1"
                          isNew={newAssetCoinIds.has('l1-alpha')}
                          onClick={() => setIsL1WalletOpen(true)}
                        />
                      )}
                      {/* L3 Assets */}
                      {assets.map((asset, index) => (
                        <AssetRow
                          key={asset.coinId}
                          asset={asset}
                          showBalances={showBalances}
                          delay={newAssetCoinIds.has(asset.coinId) ? (index + 1) * 0.05 : 0}
                          layer="L3"
                          isNew={newAssetCoinIds.has(asset.coinId)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* TOKENS VIEW - no container animation, only item animations */}
              {activeTab === 'tokens' && (
                <div className="space-y-2">
                  {tokens.filter(t => t.coinId !== 'NAMETAG').length === 0 ? (
                    <EmptyState text="No individual tokens found." />
                  ) : (
                    tokens
                      .filter(t => t.coinId !== 'NAMETAG')
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((token, index) => (
                        <TokenRow
                          key={token.id}
                          token={token}
                          delay={newTokenIds.has(token.id) ? index * 0.05 : 0}
                          isNew={newTokenIds.has(token.id)}
                        />
                      ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Existing Modals */}
      <SendModal isOpen={isSendModalOpen} onClose={() => setIsSendModalOpen(false)} />
      <SwapModal isOpen={isSwapModalOpen} onClose={() => setIsSwapModalOpen(false)} />
      <PaymentRequestsModal isOpen={isRequestsOpen} onClose={() => setIsRequestsOpen(false)} />
      <SeedPhraseModal
        isOpen={isSeedPhraseOpen}
        onClose={() => setIsSeedPhraseOpen(false)}
        seedPhrase={seedPhrase}
      />
      <TransactionHistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />

      {/* New Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenL1Wallet={() => setIsL1WalletOpen(true)}
        onBackupWallet={() => setIsBackupOpen(true)}
        onLogout={() => setIsLogoutConfirmOpen(true)}
        l1Balance={formatL1Balance(l1Balance)}
      />

      <BackupWalletModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        onExportWalletFile={handleExportWalletFile}
        onShowRecoveryPhrase={handleShowSeedPhrase}
      />

      <LogoutConfirmModal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        onBackupAndLogout={handleBackupAndLogout}
        onLogoutWithoutBackup={handleLogout}
        isLoggingOut={isLoggingOut}
      />

      <SaveWalletModal
        show={isSaveWalletOpen}
        onConfirm={handleSaveWallet}
        onCancel={() => setIsSaveWalletOpen(false)}
        hasMnemonic={hasMnemonic}
      />

    </div>
  );
}

// Helper Component
function EmptyState({ text }: { text?: string }) {
  return (
    <div className="text-center py-10 flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-neutral-400 dark:text-neutral-600" />
      </div>
      <div className="text-neutral-500 text-sm">
        {text || <>Wallet is empty.<br />Mint some tokens to start!</>}
      </div>
    </div>
  );
}
