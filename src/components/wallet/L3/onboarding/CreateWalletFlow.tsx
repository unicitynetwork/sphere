/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowRight, Loader2, ShieldCheck, KeyRound, ArrowLeft, Plus, ChevronDown, Check, Upload, FileText, FileJson, X } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { IdentityManager } from '../services/IdentityManager';
import { UnifiedKeyManager } from '../../shared/services/UnifiedKeyManager';
import { fetchNametagFromIpns } from '../services/IpnsNametagFetcher';
import { IpfsStorageService } from '../services/IpfsStorageService';
import {
  importWallet as importWalletFromFile,
  importWalletFromJSON,
  isJSONWalletFormat,
  type Wallet as L1Wallet,
  type ScannedAddress,
  saveWalletToStorage,
  loadWalletFromStorage,
  connect as connectL1,
  isWebSocketConnected
} from '../../L1/sdk';
import { WalletScanModal } from '../../L1/components/modals/WalletScanModal';
import { LoadPasswordModal } from '../../L1/components/modals/LoadPasswordModal';

// Type for derived address info with nametag status
interface DerivedAddressInfo {
  index: number;
  l1Address: string;
  l3Address: string;
  path: string;
  hasNametag: boolean;
  existingNametag?: string;
  isChange?: boolean;           // True if this is a change address (chain=1)
  // Full nametag data for localStorage persistence
  nametagData?: {
    name: string;
    token: object;
    timestamp?: number;
    format?: string;
  };
  // IPNS fetching state
  privateKey?: string;          // Needed to derive IPNS name
  ipnsName?: string;
  ipnsLoading?: boolean;        // True while fetching from IPFS
  ipnsError?: string;           // Error message if fetch failed
}

// Session key (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";
const identityManager = IdentityManager.getInstance(SESSION_KEY);

export function CreateWalletFlow() {
  const { identity, createWallet, restoreWallet, mintNametag, nametag, getUnifiedKeyManager } = useWallet();

  const [step, setStep] = useState<'start' | 'restoreMethod' | 'restore' | 'importFile' | 'addressSelection' | 'nametag' | 'processing'>('start');
  const [nametagInput, setNametagInput] = useState('');
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Address selection state
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedAddressPath, setSelectedAddressPath] = useState<string | null>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Helper to get selected address by path
  const selectedAddress = derivedAddresses.find((a) => a.path === selectedAddressPath) || derivedAddresses[0];

  // Wallet import and scanning state (for .dat and BIP32 .txt files)
  const [showScanModal, setShowScanModal] = useState(false);
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<L1Wallet | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [initialScanCount, setInitialScanCount] = useState(10);

  // Import file screen state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanCount, setScanCount] = useState(10);
  const [needsScanning, setNeedsScanning] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // State for IPNS nametag fetching on Complete Setup screen
  const [ipnsFetchingNametag, setIpnsFetchingNametag] = useState(false);

  // State for processing status message
  const [processingStatus, setProcessingStatus] = useState('');

  // Connect to L1 WebSocket on mount (needed for wallet scanning)
  useEffect(() => {
    if (!isWebSocketConnected()) {
      connectL1().catch(err => {
        console.warn("Failed to connect to L1 WebSocket:", err);
      });
    }
  }, []);

  // Effect: Fetch nametag from IPNS when identity exists but nametag doesn't
  // This allows auto-proceeding if the nametag was published from another device
  useEffect(() => {
    // Only run on 'start' step when identity exists but no nametag
    if (step !== 'start' || !identity || nametag || ipnsFetchingNametag) return;

    const fetchNametag = async () => {
      setIpnsFetchingNametag(true);
      console.log('🔍 [Complete Setup] Checking IPNS for existing nametag...');

      try {
        const result = await fetchNametagFromIpns(identity.privateKey);

        if (result.nametag && result.nametagData) {
          console.log(`🔍 [Complete Setup] Found nametag: ${result.nametag}`);

          // Save nametag to localStorage
          WalletRepository.saveNametagForAddress(identity.address, {
            name: result.nametagData.name,
            token: result.nametagData.token,
            timestamp: result.nametagData.timestamp || Date.now(),
            format: result.nametagData.format || "TXF",
            version: "1.0",
          });

          // Reload to proceed to wallet with the found nametag
          console.log('✅ [Complete Setup] Nametag found, proceeding to wallet...');
          window.location.reload();
        } else {
          console.log('🔍 [Complete Setup] No nametag found in IPNS');
          setIpnsFetchingNametag(false);
        }
      } catch (error) {
        console.warn('🔍 [Complete Setup] IPNS fetch error:', error);
        setIpnsFetchingNametag(false);
      }
    };

    fetchNametag();
  }, [step, identity, nametag, ipnsFetchingNametag]);

  // Effect: Fetch nametags from IPNS in parallel when addresses are derived
  useEffect(() => {
    // Only run when in addressSelection step and we have addresses to check
    if (step !== 'addressSelection' || derivedAddresses.length === 0) return;

    // Find addresses that need IPNS fetching
    const addressesToFetch = derivedAddresses.filter(
      (addr) => addr.ipnsLoading && addr.privateKey
    );

    if (addressesToFetch.length === 0) return;

    // Fetch nametags in parallel
    const fetchAllNametags = async () => {
      console.log(`🔍 Fetching nametags from IPNS for ${addressesToFetch.length} addresses...`);

      const fetchPromises = addressesToFetch.map(async (addr) => {
        try {
          const result = await fetchNametagFromIpns(addr.privateKey!);
          const chainLabel = addr.isChange ? 'change' : 'external';
          console.log(`🔍 IPNS result for ${chainLabel} (path: ${addr.path}, key: ${addr.privateKey?.slice(0, 8)}...): ${result.nametag || 'none'} (via ${result.source})`);

          // Update state with fetched result
          // Match by PATH - the only unambiguous identifier!
          setDerivedAddresses((prev) =>
            prev.map((a) =>
              a.path === addr.path
                ? {
                    ...a,
                    ipnsName: result.ipnsName,
                    hasNametag: !!result.nametag,
                    existingNametag: result.nametag || undefined,
                    nametagData: result.nametagData,
                    ipnsLoading: false,
                    ipnsError: result.error,
                    // Clear private key after use (security)
                    privateKey: undefined,
                  }
                : a
            )
          );
        } catch (error: any) {
          const chainLabel = addr.isChange ? 'change' : 'external';
          console.warn(`🔍 IPNS fetch error for ${chainLabel} (path: ${addr.path}):`, error.message);
          // Mark as failed but not loading
          // Match by PATH - the only unambiguous identifier!
          setDerivedAddresses((prev) =>
            prev.map((a) =>
              a.path === addr.path
                ? {
                    ...a,
                    ipnsLoading: false,
                    ipnsError: error.message,
                    privateKey: undefined,
                  }
                : a
            )
          );
        }
      });

      await Promise.allSettled(fetchPromises);
      console.log('🔍 IPNS nametag fetch complete');
    };

    fetchAllNametags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, derivedAddresses.length]);

  // Helper: truncate address for display
  const truncateAddress = (addr: string) =>
    addr ? addr.slice(0, 12) + "..." + addr.slice(-8) : '';

  // Helper: derive addresses and check for existing nametags
  const deriveAndCheckAddresses = async (count: number): Promise<DerivedAddressInfo[]> => {
    const keyManager = getUnifiedKeyManager();
    const basePath = keyManager.getBasePath();
    const results: DerivedAddressInfo[] = [];

    for (let i = 0; i < count; i++) {
      // Build path and derive using path-based method - PATH is the single identifier
      const path = `${basePath}/0/${i}`;
      const derived = keyManager.deriveAddressFromPath(path);
      // Use path-based derivation for unambiguous L3 identity
      const l3Identity = await identityManager.deriveIdentityFromPath(path);
      const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
      const hasLocalNametag = !!existingNametag;

      results.push({
        index: i,
        l1Address: derived.l1Address,
        l3Address: l3Identity.address,
        path: path, // PATH is the primary key!
        hasNametag: hasLocalNametag,
        existingNametag: existingNametag?.name,
        // Store private key for IPNS derivation (only if no local nametag)
        privateKey: hasLocalNametag ? undefined : derived.privateKey,
        // Mark for IPNS loading if no local nametag found
        ipnsLoading: !hasLocalNametag,
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
      const basePath = keyManager.getBasePath();
      // Build path and derive using path-based method - PATH is the single identifier
      const path = `${basePath}/0/${nextIndex}`;
      const derived = keyManager.deriveAddressFromPath(path);
      // Use path-based derivation for unambiguous L3 identity
      const l3Identity = await identityManager.deriveIdentityFromPath(path);
      const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
      const hasLocalNametag = !!existingNametag;

      setDerivedAddresses([...derivedAddresses, {
        index: nextIndex,
        l1Address: derived.l1Address,
        l3Address: l3Identity.address,
        path: path, // PATH is the primary key!
        hasNametag: hasLocalNametag,
        existingNametag: existingNametag?.name,
        // Store private key for IPNS derivation (only if no local nametag)
        privateKey: hasLocalNametag ? undefined : derived.privateKey,
        // Mark for IPNS loading if no local nametag found
        ipnsLoading: !hasLocalNametag,
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
      if (!selectedAddress) {
        throw new Error("No address selected");
      }

      // Store selected PATH for future identity derivation
      // Path is the only unambiguous identifier
      identityManager.setSelectedAddressPath(selectedAddress.path);

      // Reset IPFS service so it will be re-initialized with the new identity
      // This is critical when user selects a different address than the one
      // that was previously used to initialize the IPFS service
      await IpfsStorageService.resetInstance();

      if (selectedAddress.hasNametag) {
        // If nametag was fetched from IPNS, save it to localStorage before reload
        if (selectedAddress.nametagData && selectedAddress.l3Address) {
          console.log("💾 Saving IPNS-fetched nametag to localStorage before reload...");
          WalletRepository.saveNametagForAddress(selectedAddress.l3Address, {
            name: selectedAddress.nametagData.name,
            token: selectedAddress.nametagData.token,
            timestamp: selectedAddress.nametagData.timestamp || Date.now(),
            format: selectedAddress.nametagData.format || "TXF",
            version: "1.0",
          });
        }

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
      // Check if L1 wallet exists in storage with addresses
      const l1Wallet = loadWalletFromStorage("main");

      if (l1Wallet && l1Wallet.addresses && l1Wallet.addresses.length > 0) {
        // Use ALL addresses from L1 wallet storage (both external and change)
        // External and change addresses have DIFFERENT L3 identities
        const allAddresses = l1Wallet.addresses;
        const changeCount = allAddresses.filter(addr => addr.isChange).length;
        console.log(`📋 Loading ${allAddresses.length} addresses from L1 wallet storage (${allAddresses.length - changeCount} external, ${changeCount} change)`);
        const results: DerivedAddressInfo[] = [];

        // For each L1 address, derive L3 identity using the address's actual index AND isChange flag
        // External and change addresses have DIFFERENT L3 identities (different chain in BIP32 path)
        // Log UnifiedKeyManager state for debugging
        const keyManager = getUnifiedKeyManager();
        console.log(`🔍 [goToAddressSelection] UnifiedKeyManager state:`, {
          basePath: keyManager.getBasePath(),
          isInitialized: keyManager.isInitialized(),
          masterKeyPrefix: keyManager.getMasterKeyHex()?.slice(0, 16) || 'unknown',
        });

        for (const addr of allAddresses) {
          // Use PATH for L3 derivation - the only unambiguous identifier
          // Skip addresses without a path (should not happen in BIP32 wallets)
          if (!addr.path) {
            console.warn(`⚠️ Address ${addr.address.slice(0, 20)}... has no path, skipping`);
            continue;
          }

          // Use path-based derivation for unambiguous L3 identity
          const l3Identity = await identityManager.deriveIdentityFromPath(addr.path);
          const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);

          const isChange = addr.isChange ?? false;
          const chainLabel = isChange ? "change" : "external";
          console.log(`🔍 Address (path: ${addr.path}, ${chainLabel}): L1=${addr.address.slice(0, 20)}... L3=${l3Identity.address.slice(0, 20)}... key=${l3Identity.privateKey.slice(0, 8)}... hasNametag=${!!existingNametag} nametag=${existingNametag?.name}`);

          results.push({
            index: addr.index, // Keep for display purposes only
            l1Address: addr.address,
            l3Address: l3Identity.address,
            path: addr.path, // PATH is the primary key!
            hasNametag: !!existingNametag,
            existingNametag: existingNametag?.name,
            isChange,  // Track change status for UI display
            // Enable IPNS nametag fetching for addresses without local nametag
            // IMPORTANT: Use l3Identity.privateKey (from UnifiedKeyManager) for IPNS derivation,
            // NOT addr.privateKey (L1 wallet). The IPNS name is tied to the L3 identity key.
            privateKey: existingNametag ? undefined : l3Identity.privateKey,
            ipnsLoading: !existingNametag,
          });
        }

        // Sort addresses: external first (by index), then change (by index)
        results.sort((a, b) => {
          const aIsChange = a.isChange ? 1 : 0;
          const bIsChange = b.isChange ? 1 : 0;
          if (aIsChange !== bIsChange) return aIsChange - bIsChange;
          return a.index - b.index;
        });

        setDerivedAddresses(results);
        // Select first address by default (using path, not index)
        setSelectedAddressPath(results[0]?.path || null);
      } else {
        // No L1 wallet addresses - derive from UnifiedKeyManager
        console.log("📋 No L1 wallet addresses found, deriving from UnifiedKeyManager");
        const addresses = await deriveAndCheckAddresses(10); // Derive 10 addresses upfront
        setDerivedAddresses(addresses);
        // Select first address by default (using path, not index)
        setSelectedAddressPath(addresses[0]?.path || null);
      }

      setStep('addressSelection');
    } catch (e: any) {
      setError("Failed to derive addresses: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Helper: Verify nametag is available via IPNS with retry (30s timeout)
  const verifyNametagInIpnsWithRetry = async (
    privateKey: string,
    expectedNametag: string,
    timeoutMs: number = 30000
  ): Promise<boolean> => {
    const startTime = Date.now();
    const retryInterval = 3000; // 3 seconds between retries

    while (Date.now() - startTime < timeoutMs) {
      try {
        console.log(`🔄 IPNS verification attempt for "${expectedNametag}"...`);
        const result = await fetchNametagFromIpns(privateKey);
        if (result.nametag === expectedNametag) {
          return true; // Verified!
        }
        console.log(`🔄 IPNS returned "${result.nametag || 'null'}", expected "${expectedNametag}"`);
      } catch (error) {
        console.log('🔄 IPNS verification attempt failed, retrying...', error);
      }

      // Wait before next retry (unless we've exceeded timeout)
      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime > retryInterval) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }

    return false; // Timeout reached
  };

  const handleCreateKeys = async () => {
    // Prevent double-clicking
    if (isBusy) return;

    setIsBusy(true);
    setError(null);
    try {
      // Clear any existing wallet data to prevent conflicts with old identity
      const existingKeyManager = getUnifiedKeyManager();
      if (existingKeyManager?.isInitialized()) {
        console.log("🔐 Clearing existing wallet before creating new one");
        existingKeyManager.clear();
        UnifiedKeyManager.resetInstance();
      }

      await createWallet();
      // Go directly to nametag step
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

      // Step 1: Mint nametag on blockchain and save to localStorage
      setProcessingStatus('Minting Unicity ID on blockchain...');
      console.log('🏷️ Step 1: Minting nametag on blockchain...');
      await mintNametag(cleanTag);
      console.log('✅ Nametag minted and saved to localStorage');

      // Step 2: Sync to IPFS storage
      setProcessingStatus('Syncing to IPFS storage...');
      console.log('🏷️ Step 2: Syncing to IPFS...');
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        await ipfsService.syncNow();
        console.log('✅ IPFS sync completed');
      } catch (syncError) {
        console.warn('⚠️ IPFS sync failed, continuing anyway:', syncError);
      }

      // Step 3: Verify nametag can be fetched from IPNS (30s timeout with retries)
      setProcessingStatus('Verifying IPFS availability...');
      console.log('🏷️ Step 3: Verifying nametag in IPNS (30s timeout)...');
      const currentIdentity = await identityManager.getCurrentIdentity();
      if (!currentIdentity) {
        console.warn('⚠️ Could not get current identity for verification, proceeding anyway');
      }
      const verified = currentIdentity
        ? await verifyNametagInIpnsWithRetry(currentIdentity.privateKey, cleanTag, 30000)
        : false;

      if (!verified) {
        console.warn('⚠️ IPNS verification timed out after 30s, proceeding anyway');
      } else {
        console.log(`✅ Verified nametag "${cleanTag}" available via IPNS`);
      }

      // Step 4: Successfully completed - reload to reinitialize with new nametag
      // This ensures React Query refreshes and the app transitions to main wallet view
      console.log('🏷️ Step 4: All steps completed, reloading...');
      window.location.reload();
    } catch (e: any) {
      console.error('❌ Nametag minting failed:', e);
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
      // Clear any existing wallet data to prevent conflicts with old identity
      const existingKeyManager = getUnifiedKeyManager();
      if (existingKeyManager?.isInitialized()) {
        console.log("🔐 Clearing existing wallet before restoring");
        existingKeyManager.clear();
        UnifiedKeyManager.resetInstance();
      }

      const mnemonic = words.join(' ');
      await restoreWallet(mnemonic);
      // Go to address selection instead of nametag
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Invalid recovery phrase");
      setIsBusy(false);
    }
  };

  // Handle import from file
  const handleImportFromFile = async (file: File, scanCountParam?: number) => {
    setIsBusy(true);
    setError(null);

    try {
      // Clear any existing wallet data to prevent conflicts with old identity
      const existingKeyManager = getUnifiedKeyManager();
      if (existingKeyManager?.isInitialized()) {
        console.log("🔐 Clearing existing wallet before importing from file");
        existingKeyManager.clear();
        UnifiedKeyManager.resetInstance();
      }

      // Clear any existing L1 wallet from storage before importing new one
      // This prevents showing old addresses when importing a different wallet
      localStorage.removeItem("wallet_main");

      // For .dat files, use direct SDK import and show scan modal
      if (file.name.endsWith(".dat")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        console.log("📦 .dat file imported, showing scan modal:", {
          hasWallet: !!result.wallet,
          hasMasterKey: !!result.wallet.masterPrivateKey,
          scanCount: scanCountParam || 100
        });
        // Show scan modal - don't save wallet yet, let user select addresses
        setPendingWallet(result.wallet);
        setInitialScanCount(scanCountParam || 100);
        setShowScanModal(true);
        setIsBusy(false);
        return;
      }

      const content = await file.text();

      // Handle JSON wallet files (new v1.0 format)
      if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
        try {
          const json = JSON.parse(content);

          // Check if encrypted JSON
          if (json.encrypted) {
            setPendingFile(file);
            setInitialScanCount(scanCountParam || 10);
            setShowLoadPasswordModal(true);
            setIsBusy(false);
            return;
          }

          // Import unencrypted JSON
          const result = await importWalletFromJSON(content);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }

          // If has mnemonic, restore via restoreWallet (which sets up UnifiedKeyManager)
          if (result.mnemonic) {
            await restoreWallet(result.mnemonic);

            // Reset selected address path for clean import - use first address's path
            const firstAddr = result.wallet.addresses[0];
            if (firstAddr?.path) {
              localStorage.setItem("l3_selected_address_path", firstAddr.path);
            } else {
              localStorage.removeItem("l3_selected_address_path");
            }
            localStorage.removeItem("l3_selected_address_index"); // Clean up legacy

            // Save wallet with firstAddress to storage so goToAddressSelection uses it
            saveWalletToStorage("main", result.wallet);

            // Go to address selection after restoring from mnemonic
            await goToAddressSelection();
            return;
          }

          // Check if BIP32 needs scanning
          const isJsonBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
          if (isJsonBIP32) {
            // Import master key into UnifiedKeyManager first
            const keyManager = getUnifiedKeyManager();
            const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
            // Get basePath from descriptorPath (e.g., "84'/1'/0'" -> "m/84'/1'/0'")
            const basePath = result.wallet.descriptorPath ? `m/${result.wallet.descriptorPath}` : undefined;
            await keyManager.importWithMode(result.wallet.masterPrivateKey, chainCode, result.derivationMode || "bip32", basePath);

            setPendingWallet(result.wallet);
            setInitialScanCount(scanCountParam || 10);
            setShowScanModal(true);
            setIsBusy(false);
            return;
          }

          // Standard JSON wallet - save and use directly
          const keyManager = getUnifiedKeyManager();
          await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");

          saveWalletToStorage("main", result.wallet);

          // Go to address selection
          await goToAddressSelection();
          return;
        } catch (e) {
          // If JSON parsing fails but it looked like JSON, throw error
          if (file.name.endsWith(".json")) {
            throw new Error(`Invalid JSON wallet file: ${e instanceof Error ? e.message : String(e)}`);
          }
          // Otherwise continue to try other formats
        }
      }

      // Check if encrypted TXT file
      if (content.includes("ENCRYPTED MASTER KEY")) {
        setPendingFile(file);
        setInitialScanCount(scanCountParam || 10);
        setShowLoadPasswordModal(true);
        setIsBusy(false);
        return;
      }

      // Check if this is a BIP32 wallet that needs scanning
      const isBIP32 = content.includes("MASTER CHAIN CODE") ||
                      content.includes("WALLET TYPE: BIP32") ||
                      content.includes("WALLET TYPE: Alpha descriptor");

      if (isBIP32 && content.includes("MASTER PRIVATE KEY")) {
        // For BIP32 .txt files, import and show scan modal
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        console.log("📦 BIP32 .txt file imported, showing scan modal:", {
          hasWallet: !!result.wallet,
          hasMasterKey: !!result.wallet.masterPrivateKey,
          hasChainCode: !!result.wallet.masterChainCode,
          scanCount: scanCountParam || 10
        });
        setPendingWallet(result.wallet);
        setInitialScanCount(scanCountParam || 10);
        setShowScanModal(true);
        setIsBusy(false);
        return;
      }

      // For other formats, try to import as mnemonic or simple wallet
      let imported = false;

      // Try to parse as JSON first
      try {
        const json = JSON.parse(content);
        let mnemonic: string | null = null;

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
        // Not JSON - continue
      }

      // Try plain text mnemonic
      if (!imported) {
        const trimmed = content.trim();
        const words = trimmed.split(/\s+/);
        if (words.length === 12 || words.length === 24) {
          const isMnemonic = words.every(w => /^[a-z]+$/.test(w.toLowerCase()));
          if (isMnemonic) {
            await restoreWallet(trimmed);
            imported = true;
          }
        }
      }

      // Try L1 wallet file format (simple wallet without chain code)
      // Standard wallets import directly without scanning
      if (!imported && content.includes("MASTER PRIVATE KEY")) {
        // Import wallet through SDK to parse addresses from file
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        console.log("✅ Standard wallet imported with addresses:", {
          addresses: result.wallet.addresses.length,
          hasPrivateKeys: result.wallet.addresses.every(a => a.privateKey)
        });

        // Import master key into UnifiedKeyManager
        const keyManager = getUnifiedKeyManager();
        await keyManager.importFromFileContent(content);

        // Save wallet with all addresses to L1 storage
        if (result.wallet.addresses.length > 0) {
          saveWalletToStorage("main", result.wallet);
        }

        imported = true;
      }

      if (!imported) {
        throw new Error("Could not import wallet from file");
      }

      // Go to address selection (for mnemonic imports only)
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Failed to import wallet from file");
      setIsBusy(false);
    }
  };

  // Handle scanned address selection from L1 wallet scan modal
  const onSelectScannedAddress = async (scannedAddr: ScannedAddress) => {
    if (!pendingWallet) return;

    try {
      setIsBusy(true);
      setError(null);

      console.log(`✅ Selected address #${scannedAddr.index} with ${scannedAddr.balance.toFixed(8)} ALPHA`);

      // Add the scanned address to L1 wallet and save it
      const walletWithAddress: L1Wallet = {
        ...pendingWallet,
        addresses: [{
          index: scannedAddr.index,
          address: scannedAddr.address,
          privateKey: scannedAddr.privateKey,
          publicKey: scannedAddr.publicKey,
          path: scannedAddr.path,
          createdAt: new Date().toISOString(),
        }],
      };

      // Save L1 wallet to storage
      saveWalletToStorage("main", walletWithAddress);

      // Import the wallet into UnifiedKeyManager with basePath preserved
      const keyManager = getUnifiedKeyManager();
      const basePath = pendingWallet.descriptorPath ? `m/${pendingWallet.descriptorPath}` : undefined;
      if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          pendingWallet.masterChainCode,
          "bip32",
          basePath
        );
      } else if (pendingWallet.masterPrivateKey) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          null,
          "wif_hmac"
        );
      }

      setShowScanModal(false);
      setPendingWallet(null);

      // Go to address selection to choose L3 identity
      // User will see address #0 (the one they selected) in the dropdown
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Failed to import wallet");
      setIsBusy(false);
    }
  };

  // Handle loading all scanned addresses
  const onSelectAllScannedAddresses = async (scannedAddresses: ScannedAddress[]) => {
    if (!pendingWallet || scannedAddresses.length === 0) return;

    try {
      setIsBusy(true);
      setError(null);

      // Add all scanned addresses to L1 wallet
      const walletWithAddresses: L1Wallet = {
        ...pendingWallet,
        addresses: scannedAddresses.map((addr) => ({
          index: addr.index,
          address: addr.address,
          privateKey: addr.privateKey,
          publicKey: addr.publicKey,
          path: addr.path,
          createdAt: new Date().toISOString(),
          isChange: addr.isChange,
        })),
      };

      // Calculate total balance for logging
      const totalBalance = scannedAddresses.reduce((sum, addr) => sum + addr.balance, 0);
      console.log(`✅ Loaded ${scannedAddresses.length} addresses with ${totalBalance.toFixed(8)} ALPHA total`);

      // Save L1 wallet to storage with ALL addresses
      saveWalletToStorage("main", walletWithAddresses);

      // Import the wallet into UnifiedKeyManager with basePath preserved
      const keyManager = getUnifiedKeyManager();
      const basePath = pendingWallet.descriptorPath ? `m/${pendingWallet.descriptorPath}` : undefined;
      if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          pendingWallet.masterChainCode,
          "bip32",
          basePath
        );
      } else if (pendingWallet.masterPrivateKey) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          null,
          "wif_hmac"
        );
      }

      setShowScanModal(false);
      setPendingWallet(null);

      // Go to address selection to choose which L1 address to use for L3 identity
      // This will show all the scanned addresses in the dropdown
      await goToAddressSelection();
    } catch (e: any) {
      setError(e.message || "Failed to import wallet");
      setIsBusy(false);
    }
  };

  // Cancel scan modal
  const onCancelScan = () => {
    setShowScanModal(false);
    setPendingWallet(null);
  };

  // Handle password confirmation for encrypted files
  const onConfirmLoadWithPassword = async (password: string) => {
    if (!pendingFile) return;

    try {
      setIsBusy(true);
      setError(null);
      setShowLoadPasswordModal(false);

      const content = await pendingFile.text();

      // Check if this is an encrypted JSON file
      if (pendingFile.name.endsWith(".json") || isJSONWalletFormat(content)) {
        const result = await importWalletFromJSON(content, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setPendingFile(null);

        // If has mnemonic, restore via restoreWallet
        if (result.mnemonic) {
          await restoreWallet(result.mnemonic);

          // Reset selected address path for clean import - use first address's path
          const firstAddr = result.wallet.addresses[0];
          if (firstAddr?.path) {
            localStorage.setItem("l3_selected_address_path", firstAddr.path);
          } else {
            localStorage.removeItem("l3_selected_address_path");
          }
          localStorage.removeItem("l3_selected_address_index"); // Clean up legacy

          // Save wallet with firstAddress to storage so goToAddressSelection uses it
          saveWalletToStorage("main", result.wallet);

          // Go to address selection after restoring from mnemonic
          await goToAddressSelection();
          return;
        }

        // Check if BIP32 needs scanning
        const isBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
        if (isBIP32) {
          const keyManager = getUnifiedKeyManager();
          const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
          // Get basePath from descriptorPath (e.g., "84'/1'/0'" -> "m/84'/1'/0'")
          const basePath = result.wallet.descriptorPath ? `m/${result.wallet.descriptorPath}` : undefined;
          await keyManager.importWithMode(result.wallet.masterPrivateKey, chainCode, result.derivationMode || "bip32", basePath);

          setPendingWallet(result.wallet);
          setShowScanModal(true);
          setIsBusy(false);
          return;
        }

        // Standard JSON wallet
        const keyManager = getUnifiedKeyManager();
        await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");
        saveWalletToStorage("main", result.wallet);
        await goToAddressSelection();
        return;
      }

      // Handle TXT files with password
      const result = await importWalletFromFile(pendingFile, password);
      if (!result.success || !result.wallet) {
        throw new Error(result.error || "Import failed");
      }

      setPendingFile(null);

      // Check if BIP32 wallet - show scan modal
      if (result.wallet.masterChainCode || result.wallet.isImportedAlphaWallet) {
        setPendingWallet(result.wallet);
        // initialScanCount already set when showing password modal
        setShowScanModal(true);
        setIsBusy(false);
      } else {
        // Standard wallet - import master key and save addresses from file
        console.log("✅ Standard encrypted wallet imported with addresses:", {
          addresses: result.wallet.addresses.length,
          hasPrivateKeys: result.wallet.addresses.every(a => a.privateKey)
        });

        const keyManager = getUnifiedKeyManager();
        const basePath = result.wallet.descriptorPath ? `m/${result.wallet.descriptorPath}` : undefined;
        if (result.wallet.masterPrivateKey && result.wallet.masterChainCode) {
          await keyManager.importWithMode(
            result.wallet.masterPrivateKey,
            result.wallet.masterChainCode,
            "bip32",
            basePath
          );
        } else if (result.wallet.masterPrivateKey) {
          await keyManager.importWithMode(
            result.wallet.masterPrivateKey,
            null,
            "wif_hmac"
          );
        }

        // Save wallet with all addresses to L1 storage
        if (result.wallet.addresses.length > 0) {
          saveWalletToStorage("main", result.wallet);
        }

        // Go to address selection
        await goToAddressSelection();
      }
    } catch (e: any) {
      setError(e.message || "Failed to decrypt wallet");
      setIsBusy(false);
    }
  };

  // Check if file needs scanning
  const checkIfNeedsScanning = async (file: File) => {
    try {
      // .dat files always need scanning
      if (file.name.endsWith(".dat")) {
        setNeedsScanning(true);
        setScanCount(10);
        return;
      }

      const content = await file.text();

      // JSON wallet files - check format and derivation mode
      if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
        try {
          const json = JSON.parse(content);
          // JSON files with mnemonic don't need scanning - restore directly from seed
          // JSON files with BIP32 but no mnemonic need scanning
          const hasMnemonic = !!json.mnemonic || !!json.encrypted?.mnemonic;
          const isBIP32 = json.derivationMode === "bip32" || json.chainCode;
          setNeedsScanning(!hasMnemonic && isBIP32);
          setScanCount(10);
        } catch {
          setNeedsScanning(true);
        }
        return;
      }

      // For .txt files, check if BIP32 or standard
      const isBIP32 = content.includes("MASTER CHAIN CODE") ||
                      content.includes("WALLET TYPE: BIP32") ||
                      content.includes("WALLET TYPE: Alpha descriptor");

      setNeedsScanning(isBIP32);
      setScanCount(10);
    } catch (err) {
      console.error("Error checking file type:", err);
      setNeedsScanning(true); // Default to showing scan option
    }
  };

  // Handle file selection
  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    await checkIfNeedsScanning(file);
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".txt") || file.name.endsWith(".dat") || file.name.endsWith(".json"))) {
      await handleFileSelect(file);
    }
  };

  // Trigger file import
  const handleConfirmImport = () => {
    if (!selectedFile) return;
    handleImportFromFile(selectedFile, scanCount);
  };

  // Go back to start screen (e.g., from restore step)
  const goToStart = () => {
    setStep('start');
    setSeedWords(Array(12).fill(''));
    setSelectedFile(null);
    setScanCount(10);
    setNeedsScanning(true);
    setIsDragging(false);
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
              <>
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

                {/* Show loading indicator while checking IPNS */}
                {ipnsFetchingNametag && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs mb-2"
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Checking for existing Unicity ID...</span>
                  </motion.div>
                )}
              </>
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
              onClick={() => setStep('restoreMethod')}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.1 }}
              className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-3 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <KeyRound className="w-4 h-4 md:w-5 md:h-5" />
              Restore Wallet
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
                <div key={`seed-input-${index}`} className="relative">
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
                    onPaste={(e) => {
                      const pastedText = e.clipboardData.getData('text').trim();
                      const words = pastedText.split(/\s+/).filter(w => w.length > 0);
                      // If pasted text contains multiple words, fill all fields
                      if (words.length > 1) {
                        e.preventDefault();
                        const newWords = Array(12).fill('');
                        words.slice(0, 12).forEach((word, i) => {
                          newWords[i] = word.toLowerCase();
                        });
                        setSeedWords(newWords);
                      }
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
                onClick={() => setStep('restoreMethod')}
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
                      #{selectedAddress?.index ?? 0}
                    </span>
                    <span className="text-sm md:text-base font-mono text-neutral-900 dark:text-white truncate">
                      {truncateAddress(selectedAddress?.l1Address || '')}
                    </span>
                    {selectedAddress?.isChange && (
                      <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">
                        Change
                      </span>
                    )}
                    {selectedAddress?.ipnsLoading ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 text-xs">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Checking...
                      </span>
                    ) : selectedAddress?.hasNametag ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        <Check className="w-3 h-3" />
                        {selectedAddress?.existingNametag}
                      </span>
                    ) : null}
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
                      {derivedAddresses.map((addr) => (
                        <button
                          key={addr.l1Address}
                          onClick={() => {
                            setSelectedAddressPath(addr.path);
                            setShowAddressDropdown(false);
                          }}
                          className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors ${
                            addr.path === selectedAddressPath ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                          }`}
                        >
                          <span className="text-xs text-neutral-400 dark:text-neutral-500 w-6">
                            #{addr.index}
                          </span>
                          <span className="flex-1 text-sm font-mono text-neutral-900 dark:text-white truncate text-left">
                            {truncateAddress(addr.l1Address)}
                          </span>
                          {addr.isChange && (
                            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">
                              Change
                            </span>
                          )}
                          {addr.ipnsLoading ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 text-xs">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Checking...
                            </span>
                          ) : addr.hasNametag ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                              <Check className="w-3 h-3" />
                              {addr.existingNametag}
                            </span>
                          ) : null}
                          {addr.path === selectedAddressPath && (
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
                {selectedAddress?.l3Address || '...'}
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
                  ) : selectedAddress?.hasNametag ? (
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
            {selectedAddress?.hasNametag && (
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

            {/* Dynamic Progress Status */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-2 md:space-y-2.5 text-xs md:text-sm"
            >
              {/* Current status indicator */}
              <motion.div
                key={processingStatus}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 md:gap-3 text-neutral-700 dark:text-neutral-300 bg-orange-50 dark:bg-orange-900/20 px-3 md:px-4 py-2.5 md:py-3 rounded-lg backdrop-blur-sm border border-orange-200 dark:border-orange-700/30"
              >
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity
                  }}
                  className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
                />
                <span className="text-left font-medium">
                  {processingStatus || 'Initializing...'}
                </span>
              </motion.div>

              {/* Step indicators */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  processingStatus.includes('Minting') ? 'bg-orange-500' :
                  processingStatus.includes('Syncing') || processingStatus.includes('Verifying') ? 'bg-emerald-500' :
                  'bg-neutral-300 dark:bg-neutral-600'
                }`} />
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  processingStatus.includes('Syncing') ? 'bg-orange-500' :
                  processingStatus.includes('Verifying') ? 'bg-emerald-500' :
                  'bg-neutral-300 dark:bg-neutral-600'
                }`} />
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  processingStatus.includes('Verifying') ? 'bg-orange-500' :
                  'bg-neutral-300 dark:bg-neutral-600'
                }`} />
              </div>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-4 md:mt-5 text-[10px] md:text-xs text-neutral-400 dark:text-neutral-500"
            >
              {processingStatus.includes('Verifying')
                ? 'Verifying IPFS storage (up to 30 seconds)...'
                : 'This may take a few moments...'}
            </motion.p>
          </motion.div>
        )}

        {step === 'restoreMethod' && (
          <motion.div
            key="restoreMethod"
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
              <div className="absolute inset-0 bg-blue-500/30 rounded-2xl md:rounded-3xl blur-xl" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-blue-500/30">
                <KeyRound className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
              Restore Wallet
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              Choose how you want to restore your wallet
            </p>

            <div className="space-y-3 mb-6">
              {/* Recovery Phrase Option */}
              <motion.button
                onClick={() => setStep('restore')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-all text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                    <KeyRound className="w-6 h-6 text-blue-500" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">
                      Recovery Phrase
                    </div>
                    <div className="text-sm text-neutral-500 dark:text-neutral-400">
                      Use your 12-word mnemonic phrase
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-neutral-400 group-hover:text-blue-500 transition-colors" />
                </div>
              </motion.button>

              {/* Import from File Option */}
              <motion.button
                onClick={() => setStep('importFile')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 hover:border-orange-500/50 dark:hover:border-orange-500/50 transition-all text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                    <Upload className="w-6 h-6 text-orange-500" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">
                      Import from File
                    </div>
                    <div className="text-sm text-neutral-500 dark:text-neutral-400">
                      Import wallet from .json, .dat or .txt file
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-neutral-400 group-hover:text-orange-500 transition-colors" />
                </div>
              </motion.button>
            </div>

            {/* Back Button */}
            <motion.button
              onClick={goToStart}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
              Back
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

        {step === 'importFile' && (
          <motion.div
            key="importFile"
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
              <div className="absolute inset-0 bg-orange-500/30 rounded-2xl md:rounded-3xl blur-xl" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/30">
                <Upload className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
              Import Wallet
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              Select a wallet file to import
            </p>

            {!selectedFile ? (
              <>
                {/* File Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`w-full border-2 border-dashed rounded-xl p-8 md:p-10 text-center transition-colors mb-6 ${
                    isDragging
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-neutral-300 dark:border-neutral-600 hover:border-orange-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <Upload className={`w-12 h-12 md:w-14 md:h-14 mx-auto mb-4 ${isDragging ? "text-orange-500" : "text-neutral-400"}`} />
                  <p className="text-sm md:text-base text-neutral-700 dark:text-neutral-300 font-medium mb-2">
                    Select wallet file
                  </p>
                  <p className="text-xs md:text-sm text-neutral-400 dark:text-neutral-500 mb-3">
                    .json, .txt or .dat
                  </p>
                  <label className="inline-block cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept=".json,.txt,.dat"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                    />
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
                      <Upload className="w-4 h-4" />
                      Choose File
                    </span>
                  </label>
                  <p className="text-[10px] md:text-xs text-neutral-400 dark:text-neutral-600 mt-3 hidden sm:block">
                    or drag & drop here
                  </p>
                </div>
              </>
            ) : (
              <>
                {/* Selected File Display */}
                <div className="p-4 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-4">
                  <div className="flex items-center gap-3">
                    {selectedFile.name.endsWith(".json") ? (
                      <FileJson className="w-6 h-6 text-orange-500 shrink-0" />
                    ) : (
                      <FileText className="w-6 h-6 text-orange-500 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base text-neutral-900 dark:text-white font-medium truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-neutral-400" />
                    </button>
                  </div>
                </div>

                {/* Scan Count (for BIP32/.dat files) */}
                {needsScanning ? (
                  <div className="p-4 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-4">
                    <p className="text-xs md:text-sm text-neutral-700 dark:text-neutral-300 mb-2 font-medium">
                      How many addresses to scan?
                    </p>
                    <input
                      type="number"
                      value={scanCount}
                      onChange={(e) => setScanCount(Math.max(1, parseInt(e.target.value) || 10))}
                      className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      min={1}
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl mb-4">
                    <p className="text-xs md:text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                      Addresses will be imported from file
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <motion.button
                onClick={() => {
                  setSelectedFile(null);
                  setStep('restoreMethod');
                }}
                disabled={isBusy}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
                Back
              </motion.button>

              {selectedFile && (
                <motion.button
                  onClick={handleConfirmImport}
                  disabled={isBusy}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="relative z-10 flex items-center gap-2 md:gap-3">
                    {isBusy ? (
                      <>
                        <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        Import
                        <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                      </>
                    )}
                  </span>
                </motion.button>
              )}
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

      </AnimatePresence>

      {/* Password Modal for encrypted files */}
      <LoadPasswordModal
        show={showLoadPasswordModal}
        onConfirm={onConfirmLoadWithPassword}
        onCancel={() => {
          setShowLoadPasswordModal(false);
          setPendingFile(null);
        }}
      />

      {/* Wallet Scan Modal for .dat and BIP32 .txt files */}
      <WalletScanModal
        show={showScanModal}
        wallet={pendingWallet}
        initialScanCount={initialScanCount}
        onSelectAddress={onSelectScannedAddress}
        onSelectAll={onSelectAllScannedAddresses}
        onCancel={onCancelScan}
      />
    </div>
  );
}
