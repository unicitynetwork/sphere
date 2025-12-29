/**
 * CreateWalletFlow - Main onboarding flow component
 * Refactored to use extracted screen components for better maintainability
 */
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { useWallet } from "../../L3/hooks/useWallet";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { IdentityManager } from "../../L3/services/IdentityManager";
import { UnifiedKeyManager } from "../services/UnifiedKeyManager";
import { fetchNametagFromIpns } from "../../L3/services/IpnsNametagFetcher";
import { IpfsStorageService } from "../../L3/services/IpfsStorageService";
import {
  importWallet as importWalletFromFile,
  importWalletFromJSON,
  isJSONWalletFormat,
  type Wallet as L1Wallet,
  type ScannedAddress,
  saveWalletToStorage,
  loadWalletFromStorage,
  connect as connectL1,
  isWebSocketConnected,
} from "../../L1/sdk";
import { WalletScanModal } from "../../L1/components/modals/WalletScanModal";
import { LoadPasswordModal } from "../../L1/components/modals/LoadPasswordModal";
import { needsBlockchainScanning } from "../utils/walletFileParser";

// Import screen components
import {
  StartScreen,
  RestoreScreen,
  RestoreMethodScreen,
  ImportFileScreen,
  AddressSelectionScreen,
  NametagScreen,
  ProcessingScreen,
  type DerivedAddressInfo,
} from "./components";

export type OnboardingStep =
  | "start"
  | "restoreMethod"
  | "restore"
  | "importFile"
  | "addressSelection"
  | "nametag"
  | "processing";

// Session key (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";
const identityManager = IdentityManager.getInstance(SESSION_KEY);

export function CreateWalletFlow() {
  const {
    identity,
    createWallet,
    mintNametag,
    nametag,
    getUnifiedKeyManager,
    checkNametagAvailability,
  } = useWallet();

  // Step management
  const [step, setStep] = useState<OnboardingStep>("start");

  // Common state
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mnemonic restore state
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(""));

  // File import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanCount, setScanCount] = useState(10);
  const [needsScanning, setNeedsScanning] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Nametag state
  const [nametagInput, setNametagInput] = useState("");
  const [processingStatus, setProcessingStatus] = useState("");

  // Address selection state
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedAddressPath, setSelectedAddressPath] = useState<string | null>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [isCheckingIpns, setIsCheckingIpns] = useState(false);
  const [firstFoundNametagPath, setFirstFoundNametagPath] = useState<string | null>(null);
  const [autoDeriveDuringIpnsCheck, setAutoDeriveDuringIpnsCheck] = useState(true);
  const [ipnsFetchingNametag, setIpnsFetchingNametag] = useState(false);

  // Wallet import modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<L1Wallet | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [initialScanCount, setInitialScanCount] = useState(10);

  // Connect to L1 WebSocket on mount
  useEffect(() => {
    if (!isWebSocketConnected()) {
      connectL1().catch((err) => {
        console.warn("Failed to connect to L1 WebSocket:", err);
      });
    }
  }, []);

  // Effect: Fetch nametag from IPNS when identity exists but nametag doesn't
  useEffect(() => {
    if (step !== "start" || !identity || nametag || ipnsFetchingNametag) return;

    const fetchNametag = async () => {
      setIpnsFetchingNametag(true);
      console.log("🔍 [Complete Setup] Checking IPNS for existing nametag...");

      try {
        const result = await fetchNametagFromIpns(identity.privateKey);

        if (result.nametag && result.nametagData) {
          console.log(`🔍 [Complete Setup] Found nametag: ${result.nametag}`);

          WalletRepository.saveNametagForAddress(identity.address, {
            name: result.nametagData.name,
            token: result.nametagData.token,
            timestamp: result.nametagData.timestamp || Date.now(),
            format: result.nametagData.format || "TXF",
            version: "1.0",
          });

          console.log("✅ [Complete Setup] Nametag found, proceeding to wallet...");
          window.location.reload();
        } else {
          console.log("🔍 [Complete Setup] No nametag found in IPNS");
          setIpnsFetchingNametag(false);
        }
      } catch (error) {
        console.warn("🔍 [Complete Setup] IPNS fetch error:", error);
        setIpnsFetchingNametag(false);
      }
    };

    fetchNametag();
  }, [step, identity, nametag, ipnsFetchingNametag]);

  // Internal helper to derive next address
  const deriveNextAddressInternal = useCallback(async () => {
    const nextIndex = derivedAddresses.length;
    const keyManager = getUnifiedKeyManager();
    const basePath = keyManager.getBasePath();
    const path = `${basePath}/0/${nextIndex}`;
    const derived = keyManager.deriveAddressFromPath(path);
    const l3Identity = await identityManager.deriveIdentityFromPath(path);
    const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
    const hasLocalNametag = !!existingNametag;

    setDerivedAddresses((prev) => [
      ...prev,
      {
        index: nextIndex,
        l1Address: derived.l1Address,
        l3Address: l3Identity.address,
        path: path,
        hasNametag: hasLocalNametag,
        existingNametag: existingNametag?.name,
        privateKey: hasLocalNametag ? undefined : l3Identity.privateKey,
        ipnsLoading: !hasLocalNametag,
      },
    ]);
  }, [derivedAddresses.length, getUnifiedKeyManager]);

  // Effect: Fetch nametags from IPNS sequentially
  useEffect(() => {
    if (step !== "addressSelection" || derivedAddresses.length === 0 || isCheckingIpns) return;

    const nextToCheck = derivedAddresses.find((addr) => addr.ipnsLoading && addr.privateKey);

    if (!nextToCheck) {
      console.log("🔍 All current addresses checked");
      return;
    }

    const fetchAndMaybeDerive = async () => {
      setIsCheckingIpns(true);
      const addr = nextToCheck;
      const chainLabel = addr.isChange ? "change" : "external";
      console.log(`🔍 Checking IPNS for ${chainLabel} #${addr.index} (path: ${addr.path})...`);

      try {
        const result = await fetchNametagFromIpns(addr.privateKey!);
        console.log(
          `🔍 IPNS result for ${chainLabel} (path: ${addr.path}): ${result.nametag || "none"} (via ${result.source})`
        );

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
                  privateKey: undefined,
                }
              : a
          )
        );

        if (result.nametag && !firstFoundNametagPath) {
          console.log(
            `✅ Found FIRST nametag "${result.nametag}" at ${chainLabel} #${addr.index}, auto-selecting`
          );
          setFirstFoundNametagPath(addr.path);
          setSelectedAddressPath(addr.path);
        } else if (result.nametag) {
          console.log(`✅ Found another nametag "${result.nametag}" at ${chainLabel} #${addr.index}`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`🔍 IPNS fetch error for ${chainLabel} (path: ${addr.path}):`, message);
        setDerivedAddresses((prev) =>
          prev.map((a) =>
            a.path === addr.path
              ? {
                  ...a,
                  ipnsLoading: false,
                  ipnsError: message,
                  privateKey: undefined,
                }
              : a
          )
        );
      }

      setIsCheckingIpns(false);

      if (autoDeriveDuringIpnsCheck && derivedAddresses.length < 10) {
        console.log(`🔍 Deriving next address (#${derivedAddresses.length})...`);
        await deriveNextAddressInternal();
      }
    };

    fetchAndMaybeDerive();
  }, [
    step,
    derivedAddresses,
    isCheckingIpns,
    firstFoundNametagPath,
    autoDeriveDuringIpnsCheck,
    deriveNextAddressInternal,
  ]);

  // Helper: derive addresses and check for existing nametags
  const deriveAndCheckAddresses = useCallback(
    async (count: number): Promise<DerivedAddressInfo[]> => {
      const keyManager = getUnifiedKeyManager();
      const basePath = keyManager.getBasePath();
      const results: DerivedAddressInfo[] = [];

      for (let i = 0; i < count; i++) {
        const path = `${basePath}/0/${i}`;
        const derived = keyManager.deriveAddressFromPath(path);
        const l3Identity = await identityManager.deriveIdentityFromPath(path);
        const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
        const hasLocalNametag = !!existingNametag;

        results.push({
          index: i,
          l1Address: derived.l1Address,
          l3Address: l3Identity.address,
          path: path,
          hasNametag: hasLocalNametag,
          existingNametag: existingNametag?.name,
          privateKey: hasLocalNametag ? undefined : l3Identity.privateKey,
          ipnsLoading: !hasLocalNametag,
        });
      }

      return results;
    },
    [getUnifiedKeyManager]
  );

  // Go back to start screen
  const goToStart = useCallback(() => {
    setStep("start");
    setSeedWords(Array(12).fill(""));
    setSelectedFile(null);
    setScanCount(10);
    setNeedsScanning(true);
    setIsDragging(false);
    setError(null);
  }, []);

  // Helper: Verify nametag is available via IPNS with retry
  const verifyNametagInIpnsWithRetry = async (
    privateKey: string,
    expectedNametag: string,
    timeoutMs: number = 30000
  ): Promise<boolean> => {
    const startTime = Date.now();
    const retryInterval = 3000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        console.log(`🔄 IPNS verification attempt for "${expectedNametag}"...`);
        const result = await fetchNametagFromIpns(privateKey);
        if (result.nametag === expectedNametag) {
          return true;
        }
        console.log(`🔄 IPNS returned "${result.nametag || "null"}", expected "${expectedNametag}"`);
      } catch (error) {
        console.log("🔄 IPNS verification attempt failed, retrying...", error);
      }

      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime > retryInterval) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    }

    return false;
  };

  // Action: Create new wallet keys
  const handleCreateKeys = async () => {
    if (isBusy) return;

    setIsBusy(true);
    setError(null);
    try {
      UnifiedKeyManager.clearAll();
      await createWallet();
      setStep("nametag");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to generate keys";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  // Action: Restore wallet from mnemonic
  const handleRestoreWallet = async () => {
    const words = seedWords.map((w) => w.trim().toLowerCase());
    const missingIndex = words.findIndex((w) => w === "");

    if (missingIndex !== -1) {
      setError(`Please fill in word ${missingIndex + 1}`);
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      UnifiedKeyManager.clearAll();
      const mnemonic = words.join(" ");
      const keyManager = getUnifiedKeyManager();
      await keyManager.createFromMnemonic(mnemonic);
      await goToAddressSelection();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid recovery phrase";
      setError(message);
      setIsBusy(false);
    }
  };

  // Action: Mint nametag
  const handleMintNametag = async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);

    try {
      const cleanTag = nametagInput.trim().replace("@", "");

      const isNametagAvailable = await checkNametagAvailability(cleanTag);
      if (!isNametagAvailable) {
        setError(`${cleanTag} already exists.`);
        setIsBusy(false);
        return;
      }

      setStep("processing");

      setProcessingStatus("Minting Unicity ID on blockchain...");
      await mintNametag(cleanTag);
      console.log("✅ Nametag minted and saved to localStorage");

      setProcessingStatus("Syncing to IPFS storage...");
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        await ipfsService.syncNow();
        console.log("✅ IPFS sync completed");
      } catch (syncError) {
        console.warn("⚠️ IPFS sync failed, continuing anyway:", syncError);
      }

      setProcessingStatus("Verifying IPFS availability...");
      const currentIdentity = await identityManager.getCurrentIdentity();
      const verified = currentIdentity
        ? await verifyNametagInIpnsWithRetry(currentIdentity.privateKey, cleanTag, 30000)
        : false;

      if (!verified) {
        console.warn("⚠️ IPNS verification timed out after 30s, proceeding anyway");
      } else {
        console.log(`✅ Verified nametag "${cleanTag}" available via IPNS`);
      }

      console.log("🏷️ Step 4: All steps completed, reloading...");
      window.location.reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Minting failed";
      console.error("❌ Nametag minting failed:", e);
      setError(message);
      setStep("nametag");
    } finally {
      setIsBusy(false);
    }
  };

  // Action: Derive new address
  const handleDeriveNewAddress = async () => {
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const keyManager = getUnifiedKeyManager();
      const basePath = keyManager.getBasePath();
      const path = `${basePath}/0/${nextIndex}`;
      const derived = keyManager.deriveAddressFromPath(path);
      const l3Identity = await identityManager.deriveIdentityFromPath(path);
      const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
      const hasLocalNametag = !!existingNametag;

      setDerivedAddresses([
        ...derivedAddresses,
        {
          index: nextIndex,
          l1Address: derived.l1Address,
          l3Address: l3Identity.address,
          path: path,
          hasNametag: hasLocalNametag,
          existingNametag: existingNametag?.name,
          privateKey: hasLocalNametag ? undefined : l3Identity.privateKey,
          ipnsLoading: !hasLocalNametag,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to derive new address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  // Action: Go to address selection
  const goToAddressSelection = async (skipIpnsCheck: boolean = false) => {
    setIsBusy(true);
    setError(null);
    try {
      const l1Wallet = loadWalletFromStorage("main");

      if (l1Wallet && l1Wallet.addresses && l1Wallet.addresses.length > 0) {
        const allAddresses = l1Wallet.addresses;
        const changeCount = allAddresses.filter((addr) => addr.isChange).length;
        console.log(
          `📋 Loading ${allAddresses.length} addresses from L1 wallet storage (${allAddresses.length - changeCount} external, ${changeCount} change)`
        );
        const results: DerivedAddressInfo[] = [];

        const keyManager = getUnifiedKeyManager();
        console.log(`🔍 [goToAddressSelection] UnifiedKeyManager state:`, {
          basePath: keyManager.getBasePath(),
          isInitialized: keyManager.isInitialized(),
          masterKeyPrefix: keyManager.getMasterKeyHex()?.slice(0, 16) || "unknown",
        });

        for (const addr of allAddresses) {
          if (!addr.path) {
            console.warn(`⚠️ Address ${addr.address.slice(0, 20)}... has no path, skipping`);
            continue;
          }

          const l3Identity = await identityManager.deriveIdentityFromPath(addr.path);
          const existingNametag = WalletRepository.checkNametagForAddress(l3Identity.address);

          const isChange = addr.isChange ?? false;
          const chainLabel = isChange ? "change" : "external";
          console.log(
            `🔍 Address (path: ${addr.path}, ${chainLabel}): L1=${addr.address.slice(0, 20)}... L3=${l3Identity.address.slice(0, 20)}... hasNametag=${!!existingNametag}`
          );

          const enableIpnsFetching = !existingNametag;

          results.push({
            index: addr.index,
            l1Address: addr.address,
            l3Address: l3Identity.address,
            path: addr.path,
            hasNametag: !!existingNametag,
            existingNametag: existingNametag?.name,
            isChange,
            fromL1Wallet: true,
            privateKey: enableIpnsFetching ? l3Identity.privateKey : undefined,
            ipnsLoading: enableIpnsFetching,
          });
        }

        // Sort: external first, then change
        results.sort((a, b) => {
          const aIsChange = a.isChange ? 1 : 0;
          const bIsChange = b.isChange ? 1 : 0;
          if (aIsChange !== bIsChange) return aIsChange - bIsChange;
          return a.index - b.index;
        });

        setDerivedAddresses(results);
        setSelectedAddressPath(results[0]?.path || null);
      } else {
        console.log("📋 No L1 wallet addresses found, deriving from UnifiedKeyManager");
        const addresses = await deriveAndCheckAddresses(1);
        setDerivedAddresses(addresses);
        setSelectedAddressPath(addresses[0]?.path || null);
      }

      setIsCheckingIpns(false);
      setFirstFoundNametagPath(null);
      setAutoDeriveDuringIpnsCheck(!skipIpnsCheck);

      setStep("addressSelection");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to derive addresses";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  // Action: Continue with selected address
  const handleContinueWithAddress = async () => {
    setIsBusy(true);
    setError(null);

    try {
      const visibleAddresses = derivedAddresses.filter((a) => !a.ipnsLoading || a.fromL1Wallet);
      const selectedAddress =
        visibleAddresses.find((a) => a.path === selectedAddressPath) || visibleAddresses[0];

      if (!selectedAddress) {
        throw new Error("No address selected");
      }

      identityManager.setSelectedAddressPath(selectedAddress.path);

      const keyManager = getUnifiedKeyManager();

      console.log(
        "📋 All derived addresses:",
        derivedAddresses.map((a) => ({
          index: a.index,
          path: a.path,
          hasNametag: a.hasNametag,
          nametag: a.existingNametag,
          hasNametagData: !!a.nametagData,
        }))
      );

      const addressesToSave = derivedAddresses
        .filter((addr) => addr.hasNametag || addr.path === selectedAddress.path)
        .map((addr) => {
          const derived = keyManager.deriveAddressFromPath(addr.path);
          return {
            index: addr.index,
            address: derived.l1Address,
            privateKey: derived.privateKey,
            publicKey: derived.publicKey,
            path: addr.path,
            isChange: addr.isChange,
            createdAt: new Date().toISOString(),
          };
        });

      console.log(`💾 Addresses to save: ${addressesToSave.length}`);

      const l1Wallet: L1Wallet = {
        masterPrivateKey: keyManager.getMasterKeyHex() || "",
        chainCode: keyManager.getChainCodeHex() || undefined,
        addresses: addressesToSave,
        isBIP32: keyManager.getDerivationMode() === "bip32",
      };
      saveWalletToStorage("main", l1Wallet);
      console.log(`💾 Saved L1 wallet with ${addressesToSave.length} addresses`);

      await IpfsStorageService.resetInstance();

      // Save nametags from IPNS
      for (const addr of derivedAddresses) {
        if (addr.hasNametag && addr.nametagData && addr.l3Address) {
          console.log(`💾 Saving nametag for ${addr.l3Address.slice(0, 20)}...`);
          WalletRepository.saveNametagForAddress(addr.l3Address, {
            name: addr.nametagData.name,
            token: addr.nametagData.token,
            timestamp: addr.nametagData.timestamp || Date.now(),
            format: addr.nametagData.format || "TXF",
            version: "1.0",
          });
        }
      }

      if (selectedAddress.hasNametag) {
        console.log("✅ Address has existing nametag, proceeding to main app");
        window.location.reload();
      } else {
        setStep("nametag");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to select address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  // File import handlers
  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    await checkIfNeedsScanning(file);
  };

  const checkIfNeedsScanning = async (file: File) => {
    try {
      if (file.name.endsWith(".dat")) {
        setNeedsScanning(true);
        setScanCount(10);
        return;
      }

      const content = await file.text();
      setNeedsScanning(needsBlockchainScanning(file.name, content));
      setScanCount(10);
    } catch (err) {
      console.error("Error checking file type:", err);
      setNeedsScanning(true);
    }
  };

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
    if (
      file &&
      (file.name.endsWith(".txt") || file.name.endsWith(".dat") || file.name.endsWith(".json"))
    ) {
      await handleFileSelect(file);
    }
  };

  const handleConfirmImport = () => {
    if (!selectedFile) return;
    handleImportFromFile(selectedFile, scanCount);
  };

  // Handle import from file (complex logic kept inline for now)
  const handleImportFromFile = async (file: File, scanCountParam?: number) => {
    setIsBusy(true);
    setError(null);

    try {
      // Clear any existing wallet data
      const existingKeyManager = getUnifiedKeyManager();
      if (existingKeyManager?.isInitialized()) {
        console.log("🔐 Clearing existing wallet before importing from file");
        existingKeyManager.clear();
        UnifiedKeyManager.resetInstance();
      }

      localStorage.removeItem("wallet_main");

      // For .dat files, use direct SDK import and show scan modal
      if (file.name.endsWith(".dat")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        console.log("📦 .dat file imported, showing scan modal");
        setPendingWallet(result.wallet);
        setInitialScanCount(scanCountParam || 100);
        setShowScanModal(true);
        setIsBusy(false);
        return;
      }

      const content = await file.text();

      // Handle JSON wallet files
      if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
        try {
          const json = JSON.parse(content);

          if (json.encrypted) {
            setPendingFile(file);
            setInitialScanCount(scanCountParam || 10);
            setShowLoadPasswordModal(true);
            setIsBusy(false);
            return;
          }

          const result = await importWalletFromJSON(content);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }

          if (result.mnemonic) {
            const keyManager = getUnifiedKeyManager();
            await keyManager.createFromMnemonic(result.mnemonic);
            localStorage.removeItem("l3_selected_address_path");
            localStorage.removeItem("l3_selected_address_index");
            await goToAddressSelection();
            return;
          }

          const isJsonBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
          if (isJsonBIP32) {
            const keyManager = getUnifiedKeyManager();
            const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
            const basePath = result.wallet.descriptorPath
              ? `m/${result.wallet.descriptorPath}`
              : undefined;
            await keyManager.importWithMode(
              result.wallet.masterPrivateKey,
              chainCode,
              result.derivationMode || "bip32",
              basePath
            );

            setPendingWallet(result.wallet);
            setInitialScanCount(scanCountParam || 10);
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
        } catch (e) {
          if (file.name.endsWith(".json")) {
            throw new Error(`Invalid JSON wallet file: ${e instanceof Error ? e.message : String(e)}`);
          }
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

      // Check if BIP32 wallet
      const isBIP32 =
        content.includes("MASTER CHAIN CODE") ||
        content.includes("WALLET TYPE: BIP32") ||
        content.includes("WALLET TYPE: Alpha descriptor");

      if (isBIP32 && content.includes("MASTER PRIVATE KEY")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        setPendingWallet(result.wallet);
        setInitialScanCount(scanCountParam || 10);
        setShowScanModal(true);
        setIsBusy(false);
        return;
      }

      // Try mnemonic formats
      let imported = false;

      try {
        const json = JSON.parse(content);
        let mnemonic: string | null = null;

        if (json.mnemonic) mnemonic = json.mnemonic;
        else if (json.seed) mnemonic = json.seed;
        else if (json.recoveryPhrase) mnemonic = json.recoveryPhrase;
        else if (json.words && Array.isArray(json.words)) mnemonic = json.words.join(" ");

        if (mnemonic) {
          const keyManager = getUnifiedKeyManager();
          await keyManager.createFromMnemonic(mnemonic);
          imported = true;
        }
      } catch {
        // Not JSON
      }

      if (!imported) {
        const trimmed = content.trim();
        const words = trimmed.split(/\s+/);
        if (words.length === 12 || words.length === 24) {
          const isMnemonic = words.every((w) => /^[a-z]+$/.test(w.toLowerCase()));
          if (isMnemonic) {
            const keyManager = getUnifiedKeyManager();
            await keyManager.createFromMnemonic(trimmed);
            imported = true;
          }
        }
      }

      if (!imported && content.includes("MASTER PRIVATE KEY")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        const keyManager = getUnifiedKeyManager();
        await keyManager.importFromFileContent(content);

        if (result.wallet.addresses.length > 0) {
          saveWalletToStorage("main", result.wallet);
        }

        imported = true;
      }

      if (!imported) {
        throw new Error("Could not import wallet from file");
      }

      await goToAddressSelection();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to import wallet from file";
      setError(message);
      setIsBusy(false);
    }
  };

  // Handle scanned address selection
  const onSelectScannedAddress = async (scannedAddr: ScannedAddress) => {
    if (!pendingWallet) return;

    try {
      setIsBusy(true);
      setError(null);

      const walletWithAddress: L1Wallet = {
        ...pendingWallet,
        addresses: [
          {
            index: scannedAddr.index,
            address: scannedAddr.address,
            privateKey: scannedAddr.privateKey,
            publicKey: scannedAddr.publicKey,
            path: scannedAddr.path,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      saveWalletToStorage("main", walletWithAddress);

      if (scannedAddr.l3Nametag && scannedAddr.path) {
        try {
          const l3Identity = await identityManager.deriveIdentityFromPath(scannedAddr.path);
          WalletRepository.saveNametagForAddress(l3Identity.address, {
            name: scannedAddr.l3Nametag,
            token: {},
            timestamp: Date.now(),
            format: "TXF",
            version: "1.0",
          });
        } catch (e) {
          console.warn(`Failed to save nametag for address ${scannedAddr.path}:`, e);
        }
      }

      const keyManager = getUnifiedKeyManager();
      const basePath = pendingWallet.descriptorPath
        ? `m/${pendingWallet.descriptorPath}`
        : undefined;
      if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          pendingWallet.masterChainCode,
          "bip32",
          basePath
        );
      } else if (pendingWallet.masterPrivateKey) {
        await keyManager.importWithMode(pendingWallet.masterPrivateKey, null, "wif_hmac");
      }

      setShowScanModal(false);
      setPendingWallet(null);
      await goToAddressSelection(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to import wallet";
      setError(message);
      setIsBusy(false);
    }
  };

  // Handle loading all scanned addresses
  const onSelectAllScannedAddresses = async (scannedAddresses: ScannedAddress[]) => {
    if (!pendingWallet || scannedAddresses.length === 0) return;

    try {
      setIsBusy(true);
      setError(null);

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

      saveWalletToStorage("main", walletWithAddresses);

      for (const addr of scannedAddresses) {
        if (addr.l3Nametag && addr.path) {
          try {
            const l3Identity = await identityManager.deriveIdentityFromPath(addr.path);
            WalletRepository.saveNametagForAddress(l3Identity.address, {
              name: addr.l3Nametag,
              token: {},
              timestamp: Date.now(),
              format: "TXF",
              version: "1.0",
            });
          } catch (e) {
            console.warn(`Failed to save nametag for address ${addr.path}:`, e);
          }
        }
      }

      const keyManager = getUnifiedKeyManager();
      const basePath = pendingWallet.descriptorPath
        ? `m/${pendingWallet.descriptorPath}`
        : undefined;
      if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
        await keyManager.importWithMode(
          pendingWallet.masterPrivateKey,
          pendingWallet.masterChainCode,
          "bip32",
          basePath
        );
      } else if (pendingWallet.masterPrivateKey) {
        await keyManager.importWithMode(pendingWallet.masterPrivateKey, null, "wif_hmac");
      }

      setShowScanModal(false);
      setPendingWallet(null);
      await goToAddressSelection(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to import wallet";
      setError(message);
      setIsBusy(false);
    }
  };

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

      if (pendingFile.name.endsWith(".json") || isJSONWalletFormat(content)) {
        const result = await importWalletFromJSON(content, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setPendingFile(null);

        if (result.mnemonic) {
          const keyManager = getUnifiedKeyManager();
          await keyManager.createFromMnemonic(result.mnemonic);
          localStorage.removeItem("l3_selected_address_path");
          localStorage.removeItem("l3_selected_address_index");
          await goToAddressSelection();
          return;
        }

        const isBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
        if (isBIP32) {
          const keyManager = getUnifiedKeyManager();
          const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
          const basePath = result.wallet.descriptorPath
            ? `m/${result.wallet.descriptorPath}`
            : undefined;
          await keyManager.importWithMode(
            result.wallet.masterPrivateKey,
            chainCode,
            result.derivationMode || "bip32",
            basePath
          );

          setPendingWallet(result.wallet);
          setShowScanModal(true);
          setIsBusy(false);
          return;
        }

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

      if (result.wallet.masterChainCode || result.wallet.isImportedAlphaWallet) {
        setPendingWallet(result.wallet);
        setShowScanModal(true);
        setIsBusy(false);
      } else {
        const keyManager = getUnifiedKeyManager();
        const basePath = result.wallet.descriptorPath
          ? `m/${result.wallet.descriptorPath}`
          : undefined;
        if (result.wallet.masterPrivateKey && result.wallet.masterChainCode) {
          await keyManager.importWithMode(
            result.wallet.masterPrivateKey,
            result.wallet.masterChainCode,
            "bip32",
            basePath
          );
        } else if (result.wallet.masterPrivateKey) {
          await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");
        }

        if (result.wallet.addresses.length > 0) {
          saveWalletToStorage("main", result.wallet);
        }

        await goToAddressSelection();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to decrypt wallet";
      setError(message);
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 text-center relative">
      <AnimatePresence mode="wait">
        {step === "start" && (
          <StartScreen
            identity={identity}
            nametag={nametag}
            isBusy={isBusy}
            ipnsFetchingNametag={ipnsFetchingNametag}
            error={error}
            onCreateWallet={handleCreateKeys}
            onContinueSetup={() => setStep("nametag")}
            onRestore={() => setStep("restoreMethod")}
          />
        )}

        {step === "restoreMethod" && (
          <RestoreMethodScreen
            isBusy={isBusy}
            error={error}
            onSelectMnemonic={() => setStep("restore")}
            onSelectFile={() => setStep("importFile")}
            onBack={goToStart}
          />
        )}

        {step === "restore" && (
          <RestoreScreen
            seedWords={seedWords}
            isBusy={isBusy}
            error={error}
            onSeedWordsChange={setSeedWords}
            onRestore={handleRestoreWallet}
            onBack={() => setStep("restoreMethod")}
          />
        )}

        {step === "importFile" && (
          <ImportFileScreen
            selectedFile={selectedFile}
            scanCount={scanCount}
            needsScanning={needsScanning}
            isDragging={isDragging}
            isBusy={isBusy}
            error={error}
            onFileSelect={handleFileSelect}
            onClearFile={() => setSelectedFile(null)}
            onScanCountChange={setScanCount}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onImport={handleConfirmImport}
            onBack={() => {
              setSelectedFile(null);
              setStep("restoreMethod");
            }}
          />
        )}

        {step === "addressSelection" && (
          <AddressSelectionScreen
            derivedAddresses={derivedAddresses}
            selectedAddressPath={selectedAddressPath}
            showAddressDropdown={showAddressDropdown}
            isCheckingIpns={isCheckingIpns}
            isBusy={isBusy}
            error={error}
            onSelectAddress={setSelectedAddressPath}
            onToggleDropdown={() => setShowAddressDropdown(!showAddressDropdown)}
            onDeriveNewAddress={handleDeriveNewAddress}
            onContinue={handleContinueWithAddress}
            onBack={goToStart}
          />
        )}

        {step === "nametag" && (
          <NametagScreen
            nametagInput={nametagInput}
            isBusy={isBusy}
            error={error}
            onNametagChange={setNametagInput}
            onSubmit={handleMintNametag}
          />
        )}

        {step === "processing" && <ProcessingScreen status={processingStatus} />}
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
