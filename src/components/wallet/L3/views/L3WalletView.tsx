import { Plus, ArrowUpRight, ArrowDownUp, Sparkles, Loader2, Coins, Layers, CheckCircle, XCircle, Download, Upload, Eye, EyeOff, AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { AssetRow } from '../../shared/components';
import { AggregatedAsset } from '../data/model';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { CreateWalletFlow } from '../../onboarding/CreateWalletFlow';
import { TokenRow } from '../../shared/components';
import { SendModal } from '../modals/SendModal';
import { SwapModal } from '../modals/SwapModal';
import { PaymentRequestsModal } from '../modals/PaymentRequestModal';
import { FaucetService } from '../services/FaucetService';
import { SeedPhraseModal } from '../modals/SeedPhraseModal';
import { useIpfsStorage } from '../hooks/useIpfsStorage';
import { TransactionHistoryModal } from '../modals/TransactionHistoryModal';
import { SettingsModal } from '../modals/SettingsModal';
import { BackupWalletModal, LogoutConfirmModal } from '../../shared/modals';
import { useL1Wallet } from '../../L1/hooks/useL1Wallet';
import { UnifiedKeyManager } from '../../shared/services/UnifiedKeyManager';
import { SaveWalletModal } from '../../L1/components/modals';
import { validateUnicityId, invalidateUnicityId, repairUnicityId, type UnicityIdValidationResult } from '../../../../utils/unicityIdValidator';
import { getInvalidatedNametagsForAddress } from '../services/InventorySyncService';
import { useInventorySync } from '../hooks/useInventorySync';

// Module-level tracking to prevent validation loops across component remounts
// Key format: "address:nametag" - tracks which nametags have been validated for which addresses
const validatedNametags = new Set<string>();
const invalidatedNametags = new Set<string>(); // Track invalidated nametags to never restore them

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
  const { identity, assets, tokens, isLoadingAssets, isLoadingIdentity, nametag, getSeedPhrase, tokensUpdatedAt, assetsUpdatedAt } = useWallet();
  const { exportTxf, importTxf, isExportingTxf, isImportingTxf, isSyncing: isIpfsSyncing, isEnabled: isIpfsEnabled } = useIpfsStorage();
  const { balance: l1Balance, deleteWallet } = useL1Wallet();
  const {
    isSyncing: isInventorySyncing,
  } = useInventorySync();

  // Combined syncing state
  const isSyncing = isIpfsSyncing || isInventorySyncing;

  const [activeTab, setActiveTab] = useState<Tab>('assets');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isSeedPhraseOpen, setIsSeedPhraseOpen] = useState(false);
  const [seedPhrase, setSeedPhrase] = useState<string[]>([]);
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);
  const hasSyncStarted = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track previous token/asset IDs to detect truly new items
  // Uses TanStack Query's dataUpdatedAt to know when data actually changed
  const prevTokenIdsRef = useRef<Set<string>>(new Set());
  const prevAssetCoinIdsRef = useRef<Set<string>>(new Set());
  const prevTokensUpdatedAt = useRef<number>(0);
  const prevAssetsUpdatedAt = useRef<number>(0);

  // Compute new token IDs by comparing with previous snapshot
  const newTokenIds = useMemo(() => {
    // If this is the first load or data hasn't changed, no animations
    if (prevTokensUpdatedAt.current === 0) {
      return new Set<string>(); // First load - no animations
    }
    if (tokensUpdatedAt === prevTokensUpdatedAt.current) {
      return new Set<string>(); // Data unchanged - no animations
    }

    // Data changed - find truly new tokens
    const newIds = new Set<string>();
    tokens.filter(t => t.type !== 'Nametag').forEach(token => {
      if (!prevTokenIdsRef.current.has(token.id)) {
        newIds.add(token.id);
      }
    });
    return newIds;
  }, [tokens, tokensUpdatedAt]);

  // Compute new asset IDs by comparing with previous snapshot
  const newAssetCoinIds = useMemo(() => {
    // If this is the first load or data hasn't changed, no animations
    if (prevAssetsUpdatedAt.current === 0) {
      return new Set<string>(); // First load - no animations
    }
    if (assetsUpdatedAt === prevAssetsUpdatedAt.current) {
      return new Set<string>(); // Data unchanged - no animations
    }

    // Data changed - find truly new assets
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
  }, [assets, l1Balance, assetsUpdatedAt]);

  // Update previous snapshots after render (for next comparison)
  useEffect(() => {
    const currentIds = new Set(tokens.filter(t => t.type !== 'Nametag').map(t => t.id));
    prevTokenIdsRef.current = currentIds;
    prevTokensUpdatedAt.current = tokensUpdatedAt;
  }, [tokens, tokensUpdatedAt]);

  useEffect(() => {
    const currentIds = new Set(assets.map(a => a.coinId));
    if (l1Balance > 0) currentIds.add('l1-alpha');
    prevAssetCoinIdsRef.current = currentIds;
    prevAssetsUpdatedAt.current = assetsUpdatedAt;
  }, [assets, l1Balance, assetsUpdatedAt]);

  // New modal states
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSaveWalletOpen, setIsSaveWalletOpen] = useState(false);

  // Unicity ID validation state
  const [unicityIdWarning, setUnicityIdWarning] = useState<string | null>(null);

  // Stable callback for toggling balance visibility (for memoized BalanceDisplay)
  const handleToggleBalances = useCallback(() => {
    setShowBalances(!showBalances);
  }, [showBalances, setShowBalances]);

  // Track when initial IPFS sync completes (latches true after first sync has ended)
  useEffect(() => {
    // Track when sync starts
    if (isSyncing && isIpfsEnabled) {
      hasSyncStarted.current = true;
    }
    // Only mark complete after sync has started AND then stopped
    if (!isSyncing && isIpfsEnabled && !initialSyncComplete && hasSyncStarted.current) {
      setInitialSyncComplete(true);
    }
  }, [isSyncing, isIpfsEnabled, initialSyncComplete]);

  // Validate Unicity ID when wallet loads
  useEffect(() => {
    // Only validate once we have identity and nametag
    if (!identity || !nametag) {
      return;
    }

    // Use module-level Set to prevent re-validation across component remounts
    const validationKey = `${identity.address}:${nametag}`;
    if (validatedNametags.has(validationKey) || invalidatedNametags.has(validationKey)) {
      console.log(`⏭️ Skipping validation for "${nametag}" - already processed`);
      return;
    }

    // Also check if this nametag is in the invalidated list in storage
    const invalidatedList = getInvalidatedNametagsForAddress(identity.address);
    if (invalidatedList.some(inv => inv.name === nametag)) {
      console.log(`⏭️ Skipping validation for "${nametag}" - already invalidated in storage`);
      invalidatedNametags.add(validationKey);
      return;
    }

    validatedNametags.add(validationKey);

    const runValidation = async () => {
      try {
        console.log('🔍 Validating Unicity ID...');
        const result: UnicityIdValidationResult = await validateUnicityId();

        if (!result.isValid) {
          // Check for critical errors (nametag owned by someone else on Nostr)
          const nostrMismatch = result.nostrBinding?.resolvedPubkey &&
            !result.nostrBinding.matchesIdentity;

          if (nostrMismatch) {
            // CRITICAL: Nametag is owned by a different pubkey on Nostr
            // User will never receive transfers sent to this nametag
            // Invalidate immediately and redirect to creation page
            console.error(`CRITICAL: Nametag "${nametag}" owned by different Nostr pubkey`);
            console.error(`  Expected: ${result.identity?.expectedNostrPubkey}`);
            console.error(`  Actual:   ${result.nostrBinding?.resolvedPubkey}`);

            // Track as invalidated to prevent re-validation loops
            invalidatedNametags.add(validationKey);

            await invalidateUnicityId(
              `Nametag "${nametag}" is registered to a different Nostr pubkey. ` +
              `You cannot receive transfers sent to this nametag.`
            );
            // After invalidation, nametag will be null, triggering CreateWalletFlow
            return;
          } else if (result.nostrBinding?.resolvedPubkey === null) {
            // Nametag not published to Nostr - auto-repair silently
            console.log(`🔧 Nametag "${nametag}" not on Nostr, auto-repairing...`);
            try {
              const repaired = await repairUnicityId();
              if (repaired) {
                console.log(`✅ Auto-repair successful: "${nametag}" now published to Nostr`);
                setUnicityIdWarning(null);
              } else {
                // Repair failed - re-validate to check if owned by someone else
                const recheck = await validateUnicityId();
                const ownedByOther = recheck.nostrBinding?.resolvedPubkey &&
                  !recheck.nostrBinding.matchesIdentity;

                if (ownedByOther) {
                  // Nametag is owned by someone else - invalidate
                  console.error(`CRITICAL: Nametag "${nametag}" is owned by different Nostr pubkey`);

                  // Track as invalidated to prevent re-validation loops
                  invalidatedNametags.add(validationKey);

                  await invalidateUnicityId(
                    `Nametag "${nametag}" is already registered to someone else. ` +
                    `You cannot receive transfers sent to this nametag.`
                  );
                  return;
                }
                // Other failure - don't show warning, will retry on next load
                console.warn(`⚠️ Auto-repair failed for "${nametag}" - will retry`);
              }
            } catch (repairErr) {
              console.warn(`⚠️ Auto-repair error for "${nametag}":`, repairErr);
              // Don't show warning for transient errors - will retry on next load
            }
          } else if (result.errors.length > 0) {
            // Other non-critical errors
            setUnicityIdWarning(result.errors[0]);
          }
        } else {
          console.log('✅ Unicity ID validation passed');
          setUnicityIdWarning(null);
        }
      } catch (err) {
        console.error('❌ Unicity ID validation error:', err);
        // Don't show error for validation failures - just log
      }
    };

    runValidation();
  }, [identity, nametag]);


  // Create L1 ALPHA asset
  const l1AlphaAsset = useMemo(() => {
    // Convert ALPHA balance to satoshis (8 decimals)
    const satoshis = BigInt(Math.round(l1Balance * 100000000));
    return new AggregatedAsset({
      coinId: 'l1-alpha',
      symbol: 'ALPHA',
      name: 'Unicity Alphanet',
      totalAmount: satoshis.toString(),
      decimals: 8,
      tokenCount: 1,
      iconUrl: null,
      priceUsd: 1.0, // 1:1 with USD for now
      priceEur: 0.92,
      change24h: 0,
    });
  }, [l1Balance]);

  const totalValue = useMemo(() => {
    const l3Value = assets.reduce((sum, asset) => sum + asset.getTotalFiatValue('USD'), 0);
    const l1Value = l1AlphaAsset.getTotalFiatValue('USD');
    return l3Value + l1Value;
  }, [assets, l1AlphaAsset]);

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

  const handleShowSeedPhrase = async () => {
    const phrase = await getSeedPhrase();
    if (phrase) {
      setSeedPhrase(phrase);
      setIsSeedPhraseOpen(true);
    } else {
      alert("Recovery phrase not available.\n\nThis wallet was imported from a file that doesn't contain a mnemonic phrase. Only the master key was imported.");
    }
  };

  const handleExportTxf = useCallback(async () => {
    try {
      setImportError(null);
      await exportTxf();
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, [exportTxf]);

  const handleImportTxf = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(false);

    try {
      const content = await file.text();
      const result = await importTxf(content);

      if (result.success) {
        setImportSuccess(true);
        setTimeout(() => setImportSuccess(false), 3000);
      } else {
        setImportError(result.error || 'Import failed');
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [importTxf]);

  // Check if mnemonic is available
  const hasMnemonic = useMemo(() => {
    try {
      const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
      return keyManager.getMnemonic() !== null;
    } catch {
      return false;
    }
  }, []);

  // Handle export wallet file
  const handleExportWalletFile = () => {
    setIsSaveWalletOpen(true);
  };

  // Handle save wallet
  const handleSaveWallet = (filename: string, password?: string) => {
    try {
      const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
      keyManager.downloadJSON(filename, { password });
      setIsSaveWalletOpen(false);
    } catch (err) {
      console.error('Failed to save wallet:', err);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await deleteWallet();
      navigate('/');
    } catch (err) {
      console.error('Failed to logout:', err);
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

  if (!identity || !nametag) {
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

        {/* Unicity ID warning */}
        <AnimatePresence>
          {unicityIdWarning && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl"
            >
              <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Unicity ID Issue</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{unicityIdWarning}</p>
              </div>
              <button
                onClick={() => setUnicityIdWarning(null)}
                className="text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
              >
                <X className="w-4 h-4" />
              </button>
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
          <div className="flex items-center gap-2">
            {/* Hidden file input for import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txf,.json"
              onChange={handleImportTxf}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={true}
              className="flex items-center gap-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 disabled:opacity-50"
              title="Import tokens from TXF file"
            >
              {isImportingTxf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              <span>Import</span>
            </button>
            <button
              onClick={handleExportTxf}
              disabled={true}
              className="flex items-center gap-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 disabled:opacity-50"
              title="Export tokens as TXF file"
            >
              {isExportingTxf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Import feedback */}
        <AnimatePresence>
          {importSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl"
            >
              <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0" />
              <p className="text-xs text-green-600 dark:text-green-400">Tokens imported successfully!</p>
            </motion.div>
          )}
          {importError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl"
            >
              <XCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>
            </motion.div>
          )}
        </AnimatePresence>

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
                  {tokens.filter(t => t.type !== 'Nametag').length === 0 ? (
                    <EmptyState text="No individual tokens found." />
                  ) : (
                    tokens
                      .filter(t => t.type !== 'Nametag')
                      .sort((a, b) => b.timestamp - a.timestamp)
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

          {/* Overlay spinner for initial IPFS sync
          {isSyncing && isIpfsEnabled && !initialSyncComplete && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/80 flex items-center justify-center rounded-lg z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Syncing from fog...</span>
              </div>
            </div>
          )} */}
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
