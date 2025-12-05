/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowRight, Loader2, ShieldCheck, KeyRound, ArrowLeft, Upload, Plus, ChevronDown, Check } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { IdentityManager } from '../services/IdentityManager';

// Type for derived address info with nametag status
interface DerivedAddressInfo {
  index: number;
  l1Address: string;
  l3Address: string;
  path: string;
  hasNametag: boolean;
  existingNametag?: string;
}

// Session key (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";
const identityManager = IdentityManager.getInstance(SESSION_KEY);

export function CreateWalletFlow() {
  const { identity, createWallet, restoreWallet, mintNametag, nametag, getUnifiedKeyManager } = useWallet();

  const [step, setStep] = useState<'start' | 'restore' | 'addressSelection' | 'nametag' | 'processing'>('start');
  const [nametagInput, setNametagInput] = useState('');
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Address selection state
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number>(0);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Helper: truncate address for display
  const truncateAddress = (addr: string) =>
    addr ? addr.slice(0, 12) + "..." + addr.slice(-8) : '';

  // Helper: derive addresses and check for existing nametags
  const deriveAndCheckAddresses = async (count: number): Promise<DerivedAddressInfo[]> => {
    const keyManager = getUnifiedKeyManager();
    const results: DerivedAddressInfo[] = [];

    for (let i = 0; i < count; i++) {
      const derived = keyManager.deriveAddress(i);
      const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(i);
      const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);

      results.push({
        index: i,
        l1Address: derived.l1Address,
        l3Address: l3Identity.address,
        path: derived.path,
        hasNametag: !!existingNametag,
        existingNametag: existingNametag?.name,
      });
    }

    return results;
  };

  // Helper: derive one more address
  const handleDeriveNewAddress = async () => {
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const keyManager = getUnifiedKeyManager();
      const derived = keyManager.deriveAddress(nextIndex);
      const l3Identity = await identityManager.deriveIdentityFromUnifiedWallet(nextIndex);
      const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);

      setDerivedAddresses([...derivedAddresses, {
        index: nextIndex,
        l1Address: derived.l1Address,
        l3Address: l3Identity.address,
        path: derived.path,
        hasNametag: !!existingNametag,
        existingNametag: existingNametag?.name,
      }]);
    } catch (e: any) {
      setError("Failed to derive new address: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Handler: continue with selected address
  const handleContinueWithAddress = async () => {
    setIsBusy(true);
    setError(null);

    try {
      const selected = derivedAddresses[selectedAddressIndex];

      // Store selected index for future identity derivation
      identityManager.setSelectedAddressIndex(selected.index);

      if (selected.hasNametag) {
        // Address already has nametag - proceed to main app
        console.log("✅ Address has existing nametag, proceeding to main app");
        window.location.reload();
      } else {
        // No nametag - show nametag creation step
        setStep('nametag');
      }
    } catch (e: any) {
      setError(e.message || "Failed to select address");
    } finally {
      setIsBusy(false);
    }
  };

  // Helper: go to address selection after wallet creation/restore/import
  const goToAddressSelection = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const addresses = await deriveAndCheckAddresses(1); // Start with 1 address
      setDerivedAddresses(addresses);
      setSelectedAddressIndex(0);
      setStep('addressSelection');
    } catch (e: any) {
      setError("Failed to derive addresses: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateKeys = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await createWallet();
      // Go to address selection instead of nametag
      await goToAddressSelection();
    } catch (e: any) {
      setError("Failed to generate keys: " + e.message);
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
      // Successfully minted nametag - reload to reinitialize with new nametag
      // This ensures React Query refreshes and the app transitions to main wallet view
      window.location.reload();
    } catch (e: any) {
      setError(e.message || "Minting failed");
      setStep('nametag');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreWallet = async () => {
    const words = seedWords.map(w => w.trim().toLowerCase());
    const missingIndex = words.findIndex(w => w === '');

    if (missingIndex !== -1) {
      setError(`Please fill in word ${missingIndex + 1}`);
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const mnemonic = words.join(' ');
      await restoreWallet(mnemonic);
      // Go to address selection instead of nametag
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Invalid recovery phrase");
      setIsBusy(false);
    }
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsBusy(true);
    setError(null);

    try {
      const content = await file.text();
      let imported = false;

      // Try to parse as JSON first (wallet backup file with mnemonic)
      try {
        const json = JSON.parse(content);
        let mnemonic: string | null = null;

        // Support various JSON wallet file formats
        if (json.mnemonic) {
          mnemonic = json.mnemonic;
        } else if (json.seed) {
          mnemonic = json.seed;
        } else if (json.recoveryPhrase) {
          mnemonic = json.recoveryPhrase;
        } else if (json.words && Array.isArray(json.words)) {
          mnemonic = json.words.join(' ');
        }

        if (mnemonic) {
          await restoreWallet(mnemonic);
          imported = true;
        }
      } catch {
        // Not JSON - continue to try other formats
      }

      // Try plain text mnemonic (12 or 24 words)
      if (!imported) {
        const trimmed = content.trim();
        const words = trimmed.split(/\s+/);
        if (words.length === 12 || words.length === 24) {
          // Check if all words are lowercase alpha (likely a mnemonic)
          const isMnemonic = words.every(w => /^[a-z]+$/.test(w.toLowerCase()));
          if (isMnemonic) {
            await restoreWallet(trimmed);
            imported = true;
          }
        }
      }

      // Try L1 wallet file format (MASTER PRIVATE KEY / ENCRYPTED MASTER KEY)
      if (!imported) {
        if (content.includes("MASTER PRIVATE KEY") || content.includes("ENCRYPTED MASTER KEY")) {
          if (content.includes("ENCRYPTED MASTER KEY")) {
            throw new Error("Encrypted wallet files require password. Please decrypt the file first or use the L1 wallet tab to import.");
          }

          // Use UnifiedKeyManager to import L1 wallet file
          const keyManager = getUnifiedKeyManager();
          await keyManager.importFromFileContent(content);

          // Verify the import was successful
          const walletInfo = keyManager.getWalletInfo();
          if (!walletInfo.address0) {
            throw new Error("Wallet import failed - could not derive address");
          }

          console.log("✅ Wallet file imported successfully:", walletInfo);
          imported = true;
        }
      }

      if (!imported) {
        throw new Error("Could not import wallet from file. Supported formats: mnemonic (12/24 words), JSON with mnemonic, or L1 wallet backup file.");
      }

      // Go to address selection for ALL import types
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Failed to import wallet from file");
      setIsBusy(false);
    } finally {
      // Reset file input
      event.target.value = "";
    }
  };

  // Go back to start screen (e.g., from restore step)
  const goToStart = () => {
    setStep('start');
    setSeedWords(Array(12).fill(''));
    setError(null);
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 text-center relative">
      <AnimatePresence mode="wait">

        {step === 'start' && (
          <motion.div
            key="start"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.1 }}
            className="relative z-10 w-full max-w-[280px] md:max-w-[340px]"
          >
            {/* Icon with glow effect */}
            <motion.div
              className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
              whileHover={{ scale: 1.05 }}
            >
              <div className="absolute inset-0 bg-linear-to-br from-orange-500 to-orange-600 rounded-2xl md:rounded-3xl blur-xl opacity-50" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/30">
                <Wallet className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
              {identity && !nametag ? 'Complete Setup' : 'No Wallet Found'}
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              {identity && !nametag
                ? <>Your wallet is ready. Create a <span className="text-orange-500 dark:text-orange-400 font-semibold">Unicity ID</span> to complete setup.</>
                : <>Create a new secure wallet to start using the <span className="text-orange-500 dark:text-orange-400 font-semibold">Unicity Network</span></>
              }
            </p>

            {/* Show "Continue Setup" if identity exists but no nametag */}
            {identity && !nametag && (
              <motion.button
                onClick={() => setStep('nametag')}
                disabled={isBusy}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.1 }}
                className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-emerald-500 to-emerald-600 text-white text-sm md:text-base font-bold shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group mb-3"
              >
                <div className="absolute inset-0 bg-linear-to-r from-emerald-400 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative z-10 flex items-center gap-2 md:gap-3">
                  <ShieldCheck className="w-4 h-4 md:w-5 md:h-5" />
                  Continue Setup
                </span>
              </motion.button>
            )}

            {/* Divider when showing continue option */}
            {identity && !nametag && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                <span className="text-xs text-neutral-400 dark:text-neutral-500">or start fresh</span>
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              </div>
            )}

            <motion.button
              onClick={handleCreateKeys}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
            >
              <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10 flex items-center gap-2 md:gap-3">
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    Create New Wallet
                    <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                  </>
                )}
              </span>
            </motion.button>

            <motion.button
              onClick={() => setStep('restore')}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-3 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <KeyRound className="w-4 h-4 md:w-5 md:h-5" />
              Restore Wallet
            </motion.button>

            <motion.button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-3 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <Upload className="w-4 h-4 md:w-5 md:h-5" />
              Import from File
            </motion.button>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json,.txt"
              onChange={handleFileImport}
            />

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {step === 'restore' && (
          <motion.div
            key="restore"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 w-full max-w-[400px] md:max-w-[480px]"
          >
            {/* Icon */}
            <motion.div
              className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
              whileHover={{ scale: 1.05 }}
            >
              <div className="absolute inset-0 bg-blue-500/30 rounded-2xl md:rounded-3xl blur-xl" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-blue-500/30">
                <KeyRound className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">Restore Wallet</h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              Enter your 12-word recovery phrase to restore your wallet
            </p>

            {/* 12-word grid */}
            <div className="grid grid-cols-3 gap-2 md:gap-3 mb-6">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="relative">
                  <span className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 text-[10px] md:text-xs text-neutral-400 dark:text-neutral-600 font-medium z-10">
                    {index + 1}.
                  </span>
                  <input
                    type="text"
                    value={seedWords[index]}
                    onChange={(e) => {
                      const newWords = [...seedWords];
                      newWords[index] = e.target.value;
                      setSeedWords(newWords);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && index < 11) {
                        const nextInput = e.currentTarget.parentElement?.nextElementSibling?.querySelector('input');
                        nextInput?.focus();
                      } else if (e.key === 'Enter' && index === 11) {
                        handleRestoreWallet();
                      }
                    }}
                    placeholder="word"
                    className="w-full bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-lg py-2 md:py-2.5 pl-7 md:pl-9 pr-2 md:pr-3 text-xs md:text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all"
                    autoFocus={index === 0}
                  />
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <motion.button
                onClick={goToStart}
                disabled={isBusy}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
                Back
              </motion.button>

              <motion.button
                onClick={handleRestoreWallet}
                disabled={isBusy || seedWords.some(w => !w.trim())}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-blue-500 to-blue-600 text-white text-sm md:text-base font-bold shadow-xl shadow-blue-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
              >
                <div className="absolute inset-0 bg-linear-to-r from-blue-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative z-10 flex items-center gap-2 md:gap-3">
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    <>
                      Restore
                      <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                    </>
                  )}
                </span>
              </motion.button>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {step === 'addressSelection' && (
          <motion.div
            key="addressSelection"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 w-full max-w-[320px] md:max-w-[400px]"
          >
            {/* Icon */}
            <motion.div
              className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
              whileHover={{ scale: 1.05 }}
            >
              <div className="absolute inset-0 bg-purple-500/30 rounded-2xl md:rounded-3xl blur-xl" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-purple-500/30">
                <Wallet className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
              Select Address
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              Choose which address to use for your <span className="text-purple-500 dark:text-purple-400 font-semibold">Unicity identity</span>
            </p>

            {/* Address Dropdown */}
            <div className="relative mb-4">
              <button
                onClick={() => setShowAddressDropdown(!showAddressDropdown)}
                className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 px-4 text-left flex items-center justify-between hover:border-purple-500/50 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      #{derivedAddresses[selectedAddressIndex]?.index ?? 0}
                    </span>
                    <span className="text-sm md:text-base font-mono text-neutral-900 dark:text-white truncate">
                      {truncateAddress(derivedAddresses[selectedAddressIndex]?.l1Address || '')}
                    </span>
                    {derivedAddresses[selectedAddressIndex]?.hasNametag && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        <Check className="w-3 h-3" />
                        {derivedAddresses[selectedAddressIndex]?.existingNametag}
                      </span>
                    )}
                  </div>
                </div>
                <motion.div
                  animate={{ rotate: showAddressDropdown ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
                </motion.div>
              </button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {showAddressDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl overflow-hidden z-50"
                  >
                    <div className="max-h-64 overflow-y-auto">
                      {derivedAddresses.map((addr, idx) => (
                        <button
                          key={addr.index}
                          onClick={() => {
                            setSelectedAddressIndex(idx);
                            setShowAddressDropdown(false);
                          }}
                          className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors ${
                            idx === selectedAddressIndex ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                          }`}
                        >
                          <span className="text-xs text-neutral-400 dark:text-neutral-500 w-6">
                            #{addr.index}
                          </span>
                          <span className="flex-1 text-sm font-mono text-neutral-900 dark:text-white truncate text-left">
                            {truncateAddress(addr.l1Address)}
                          </span>
                          {addr.hasNametag && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                              <Check className="w-3 h-3" />
                              {addr.existingNametag}
                            </span>
                          )}
                          {idx === selectedAddressIndex && (
                            <div className="w-2 h-2 rounded-full bg-purple-500" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Derive New Address Button */}
                    <button
                      onClick={handleDeriveNewAddress}
                      disabled={isBusy}
                      className="w-full px-4 py-3 flex items-center gap-3 border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors text-purple-600 dark:text-purple-400 disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm font-medium">Derive New Address</span>
                      {isBusy && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* L3 Address Info */}
            <div className="mb-6 p-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700/50">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">L3 Unicity Address</div>
              <div className="text-xs font-mono text-neutral-700 dark:text-neutral-300 break-all">
                {derivedAddresses[selectedAddressIndex]?.l3Address || '...'}
              </div>
            </div>

            {/* Continue Button */}
            <div className="flex gap-3">
              <motion.button
                onClick={goToStart}
                disabled={isBusy}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
                Back
              </motion.button>

              <motion.button
                onClick={handleContinueWithAddress}
                disabled={isBusy || derivedAddresses.length === 0}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-purple-500 to-purple-600 text-white text-sm md:text-base font-bold shadow-xl shadow-purple-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
              >
                <div className="absolute inset-0 bg-linear-to-r from-purple-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative z-10 flex items-center gap-2 md:gap-3">
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                      Loading...
                    </>
                  ) : derivedAddresses[selectedAddressIndex]?.hasNametag ? (
                    <>
                      Continue
                      <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                    </>
                  ) : (
                    <>
                      Create ID
                      <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                    </>
                  )}
                </span>
              </motion.button>
            </div>

            {/* Info about nametag */}
            {derivedAddresses[selectedAddressIndex]?.hasNametag && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg"
              >
                This address already has a Unicity ID. You can continue directly.
              </motion.p>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {step === 'nametag' && (
          <motion.div
            key="nametag"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 w-full max-w-[280px] md:max-w-[340px]"
          >
            {/* Success Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="relative w-16 h-16 md:w-18 md:h-18 mx-auto mb-5"
            >
              <div className="absolute inset-0 bg-emerald-500/30 rounded-full blur-xl" />
              <div className="relative w-full h-full rounded-full bg-neutral-100 dark:bg-neutral-800/80 border-2 border-emerald-500/50 flex items-center justify-center backdrop-blur-sm">
                <ShieldCheck className="w-8 h-8 md:w-9 md:h-9 text-emerald-500 dark:text-emerald-400" />
              </div>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-xl md:text-2xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight"
            >
              Wallet Created!
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-5 md:mb-6 mx-auto leading-relaxed"
            >
              Now, choose a unique <span className="text-orange-500 dark:text-orange-400 font-bold">Unicity ID</span> to receive tokens easily without long addresses.
            </motion.p>

            {/* Input Field */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative mb-4 md:mb-5 group"
            >
              <div className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 dark:group-focus-within:text-orange-400 transition-colors z-10 text-xs md:text-sm font-medium">
                @unicity
              </div>
              <input
                type="text"
                value={nametagInput}
                onChange={(e) => setNametagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nametagInput && !isBusy) handleMintNametag();
                }}
                placeholder="id"
                className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 pl-3 md:pl-4 pr-24 md:pr-28 text-sm md:text-base text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all backdrop-blur-sm"
                autoFocus
              />
              <div className="absolute inset-0 rounded-xl bg-linear-to-r from-orange-500/0 via-orange-500/5 to-purple-500/0 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
            </motion.div>

            {/* Continue Button */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              onClick={handleMintNametag}
              disabled={!nametagInput || isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 overflow-hidden group"
            >
              <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10 flex items-center gap-2 md:gap-3">
                Continue
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
              </span>
            </motion.button>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}

        {step === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 text-center w-full max-w-[280px] md:max-w-[360px]"
          >
            {/* Animated Loading Spinner */}
            <div className="relative mx-auto w-24 h-24 md:w-28 md:h-28 mb-6">
              {/* Outer Ring */}
              <motion.div
                className="absolute inset-0 border-3 md:border-4 border-neutral-200 dark:border-neutral-800/50 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />

              {/* Middle Ring */}
              <motion.div
                className="absolute inset-1.5 md:inset-2 border-3 md:border-4 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
                animate={{ rotate: -360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />

              {/* Inner Glow */}
              <div className="absolute inset-3 md:inset-4 bg-orange-500/20 rounded-full blur-xl" />

              {/* Center Icon */}
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  <Loader2 className="w-8 h-8 md:w-9 md:h-9 text-orange-500 dark:text-orange-400 animate-spin" />
                </motion.div>
              </div>
            </div>

            <motion.h3
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl md:text-2xl font-black text-neutral-900 dark:text-white mb-5 md:mb-6 tracking-tight"
            >
              Setting up Profile...
            </motion.h3>

            {/* Progress Steps */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-2 md:space-y-2.5 text-xs md:text-sm"
            >
              {[
                { text: "Minting Nametag on Blockchain", delay: 0.4 },
                { text: "Registering on Nostr Relay", delay: 0.6 },
                { text: "Finalizing Wallet", delay: 0.8 }
              ].map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: step.delay }}
                  className="flex items-center gap-2 md:gap-3 text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800/30 px-3 md:px-4 py-2 md:py-2.5 rounded-lg backdrop-blur-sm border border-neutral-200 dark:border-neutral-700/30"
                >
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 1, 0.5]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: step.delay
                    }}
                    className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
                  />
                  <span className="text-left">{step.text}</span>
                </motion.div>
              ))}
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-4 md:mt-5 text-[10px] md:text-xs text-neutral-400 dark:text-neutral-500"
            >
              This may take a few moments...
            </motion.p>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
