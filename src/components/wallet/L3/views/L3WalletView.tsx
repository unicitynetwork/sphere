import { Plus, ArrowUpRight, Sparkles, Loader2, Coins, Layers, Bell, CheckCircle, XCircle, Key, Download, Upload, Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { AssetRow } from '../../shared/components';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { CreateWalletFlow } from '../onboarding/CreateWalletFlow';
import { TokenRow } from '../../shared/components';
import { SendModal } from '../modals/SendModal';
import { useIncomingPaymentRequests } from '../hooks/useIncomingPaymentRequests';
import { PaymentRequestsModal } from '../modals/PaymentRequestModal';
import { FaucetService } from '../services/FaucetService';
import { SeedPhraseModal } from '../modals/SeedPhraseModal';
import { useIpfsStorage } from '../hooks/useIpfsStorage';
import { TransactionHistoryModal } from '../modals/TransactionHistoryModal';

type Tab = 'assets' | 'tokens';

export function L3WalletView({ showBalances }: { showBalances: boolean }) {
  const { identity, assets, tokens, isLoadingAssets, isLoadingIdentity, nametag, getSeedPhrase } = useWallet();
  const { exportTxf, importTxf, isExportingTxf, isImportingTxf, isSyncing, isEnabled: isIpfsEnabled } = useIpfsStorage();
  const [activeTab, setActiveTab] = useState<Tab>('assets');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [isSeedPhraseOpen, setIsSeedPhraseOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [seedPhrase, setSeedPhrase] = useState<string[]>([]);
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);
  const hasSyncStarted = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { pendingCount } = useIncomingPaymentRequests();

  const prevPendingCount = useRef(0);

  useEffect(() => {
    if (pendingCount > prevPendingCount.current) {
      console.log("🔔 New payment request received! Opening modal...");
      setIsRequestsOpen(true);
    }
    prevPendingCount.current = pendingCount;
  }, [pendingCount]);

  // Track when initial IPFS sync completes (latches true after first sync has ended)
  useEffect(() => {
    // Track when sync starts
    if (isSyncing && isIpfsEnabled) {
      hasSyncStarted.current = true;
      console.log(`🔄 L3WalletView: sync started, hasSyncStarted=true`);
    }
    // Only mark complete after sync has started AND then stopped
    if (!isSyncing && isIpfsEnabled && !initialSyncComplete && hasSyncStarted.current) {
      console.log(`🔄 L3WalletView: sync completed, marking initialSyncComplete=true`);
      setInitialSyncComplete(true);
    }
  }, [isSyncing, isIpfsEnabled, initialSyncComplete]);

  // Reset initial sync flag when identity/address changes
  useEffect(() => {
    setInitialSyncComplete(false);
    hasSyncStarted.current = false;
  }, [identity?.address]);

  const totalValue = useMemo(() => {
    return assets.reduce((sum, asset) => sum + asset.getTotalFiatValue('USD'), 0);
  }, [assets]);

  // Debug: Log spinner visibility conditions
  const shouldShowSpinner = isSyncing && isIpfsEnabled && !initialSyncComplete;
  console.log(`🔄 L3WalletView render: isSyncing=${isSyncing}, isIpfsEnabled=${isIpfsEnabled}, initialSyncComplete=${initialSyncComplete}, shouldShowSpinner=${shouldShowSpinner}`);

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
    <div className="flex flex-col h-full">
      {/* L2 Specific Header Stats */}
      <div className="px-6 mb-6 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-orange-600/70 dark:text-orange-300/70">AgentSphere Balance</p>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
          </div>

          <div className="flex items-center gap-2">
                 <button
                    onClick={() => setIsHistoryOpen(true)}
                    className="p-1.5 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-white/10 transition-colors group"
                    title="Transaction history"
                 >
                    <Clock className="w-5 h-5 text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
                 </button>
                 <button
                    onClick={handleShowSeedPhrase}
                    className="p-1.5 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-white/10 transition-colors group"
                    title="View recovery phrase"
                 >
                    <Key className="w-5 h-5 text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
                 </button>
                 <button
                    onClick={() => setIsRequestsOpen(true)}
                    className="relative p-1.5 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-white/10 transition-colors group"
                 >
                    <Bell className={`w-5 h-5 ${pendingCount > 0 ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`} />
                    {pendingCount > 0 && (
                        <span className="absolute top-0 right-0 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border-2 border-white dark:border-[#0a0a0a]"></span>
                        </span>
                    )}
                 </button>
            </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-3xl text-neutral-900 dark:text-white font-bold tracking-tight">
            {showBalances
              ? `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '••••••'}
          </h2>
          {isSyncing && isIpfsEnabled && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          )}
        </div>

        {/* L2 Actions - Speed focused */}
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            whileHover={{ scale: isFaucetLoading ? 1 : 1.02, y: isFaucetLoading ? 0 : -2 }}
            whileTap={{ scale: isFaucetLoading ? 1 : 0.98 }}
            onClick={handleTopUp}
            disabled={isFaucetLoading || !nametag}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 text-white text-sm shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFaucetLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Requesting...</span>
              </>
            ) : faucetSuccess ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Success!</span>
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
            onClick={() => setIsSendModalOpen(true)}
            className="relative px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-700/80 text-neutral-900 dark:text-white text-sm border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2"
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

      {/* L2 Assets List */}
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
              disabled={isImportingTxf}
              className="flex items-center gap-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 disabled:opacity-50"
              title="Import tokens from TXF file"
            >
              {isImportingTxf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              <span>Import</span>
            </button>
            <button
              onClick={handleExportTxf}
              disabled={isExportingTxf}
              className="flex items-center gap-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 disabled:opacity-50"
              title="Export tokens as TXF file"
            >
              {isExportingTxf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
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
            <AnimatePresence mode="wait">
              {activeTab === 'assets' && (
                /* ASSETS VIEW */
                <motion.div
                  key="assets"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  {assets.length === 0 ? (
                    <EmptyState />
                  ) : (
                    assets.map((asset, index) => (
                      <AssetRow
                        key={asset.coinId}
                        asset={asset}
                        showBalances={showBalances}
                        delay={index * 0.05}
                      />
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'tokens' && (
                <motion.div
                  key="tokens"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
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
                          delay={index * 0.05}
                        />
                      ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Overlay spinner for initial IPFS sync */}
          {isSyncing && isIpfsEnabled && !initialSyncComplete && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/80 flex items-center justify-center rounded-lg z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Syncing from fog...</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <SendModal isOpen={isSendModalOpen} onClose={() => setIsSendModalOpen(false)} />

      <PaymentRequestsModal isOpen={isRequestsOpen} onClose={() => setIsRequestsOpen(false)} />

      <SeedPhraseModal
        isOpen={isSeedPhraseOpen}
        onClose={() => setIsSeedPhraseOpen(false)}
        seedPhrase={seedPhrase}
      />

      <TransactionHistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
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
