/**
 * useOnboardingFlow - Manages onboarding flow state and navigation
 *
 * Uses WalletCore SDK for pure wallet operations (key generation, address derivation).
 * UnifiedKeyManager handles storage, IdentityManager handles L3 identity.
 */
import { useState, useCallback, useEffect } from "react";
import { useWallet } from "../../L3/hooks/useWallet";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { IdentityManager } from "../../L3/services/IdentityManager";
import { fetchNametagFromIpns } from "../../L3/services/IpnsNametagFetcher";
import { IpfsStorageService } from "../../L3/services/IpfsStorageService";
import {
  saveWalletToStorage,
  loadWalletFromStorage,
  getBalance,
  type Wallet as L1Wallet,
} from "../../L1/sdk";
import type { DerivedAddressInfo } from "../components/AddressSelectionScreen";
import {
  deriveUnifiedAddress,
  getAddressPath,
} from "../../core/WalletCore";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

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

export interface UseOnboardingFlowReturn {
  // Step management
  step: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
  goToStart: () => void;

  // State
  isBusy: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  setIsBusy: (busy: boolean) => void;

  // Mnemonic restore state
  seedWords: string[];
  setSeedWords: (words: string[]) => void;

  // File import state
  selectedFile: File | null;
  scanCount: number;
  needsScanning: boolean;
  isDragging: boolean;
  setSelectedFile: (file: File | null) => void;
  setScanCount: (count: number) => void;
  setNeedsScanning: (needs: boolean) => void;
  setIsDragging: (dragging: boolean) => void;

  // Nametag state
  nametagInput: string;
  setNametagInput: (value: string) => void;
  processingStatus: string;
  isProcessingComplete: boolean;
  handleCompleteOnboarding: () => void;

  // Address selection state
  derivedAddresses: DerivedAddressInfo[];
  selectedAddressPath: string | null;
  showAddressDropdown: boolean;
  isCheckingIpns: boolean;
  ipnsFetchingNametag: boolean;
  setSelectedAddressPath: (path: string | null) => void;
  setShowAddressDropdown: (show: boolean) => void;

  // Actions
  handleCreateKeys: () => Promise<void>;
  handleRestoreWallet: () => Promise<void>;
  handleMintNametag: () => Promise<void>;
  handleDeriveNewAddress: () => Promise<void>;
  handleContinueWithAddress: () => Promise<void>;
  goToAddressSelection: (skipIpnsCheck?: boolean) => Promise<void>;

  // Wallet context
  identity: { address: string; privateKey: string } | null | undefined;
  nametag: string | null | undefined;
  getUnifiedKeyManager: () => UnifiedKeyManager;
}

export function useOnboardingFlow(): UseOnboardingFlowReturn {
  const {
    identity,
    nametag,
    createWallet,
    mintNametag,
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
  const [isProcessingComplete, setIsProcessingComplete] = useState(false);

  // Address selection state
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedAddressPath, setSelectedAddressPath] = useState<string | null>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [isCheckingIpns, setIsCheckingIpns] = useState(false);
  const [firstFoundNametagPath, setFirstFoundNametagPath] = useState<string | null>(null);
  const [autoDeriveDuringIpnsCheck, setAutoDeriveDuringIpnsCheck] = useState(true);
  const [ipnsFetchingNametag, setIpnsFetchingNametag] = useState(false);

  // Effect: Handle onboarding flag cleanup and auto-navigation
  useEffect(() => {
    console.log(`🔍 [Auto-check effect] step=${step}, hasIdentity=${!!identity}, hasNametag=${!!nametag}`);

    // If user has both identity AND nametag, but onboarding flag is still set
    // Check if onboarding is actually complete (user clicked "Let's go!" or imported wallet)
    if (identity && nametag) {
      const onboardingFlag = localStorage.getItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      const onboardingComplete = localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE);

      if (onboardingFlag === 'true' && onboardingComplete === 'true') {
        // User completed onboarding but page was reloaded before flag was cleared
        console.log('🔍 [Auto-check] Onboarding complete flag set - clearing both flags');
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
        // Dispatch events to ensure services initialize
        window.dispatchEvent(new Event("wallet-loaded"));
        window.dispatchEvent(new Event("wallet-updated"));
      }
      return;
    }

    if (step !== "start" || !identity || nametag) {
      console.log(`🔍 [Auto-check effect] Skipping IPNS check - conditions not met`);
      return;
    }

    // Check IPNS in background for existing nametag
    const fetchNametag = async () => {
      setIpnsFetchingNametag(true);
      console.log("🔍 [Auto-check] Checking IPNS for existing nametag...");

      try {
        const result = await fetchNametagFromIpns(identity.privateKey);

        if (result.nametag && result.nametagData) {
          console.log(`🔍 [Auto-check] Found nametag: ${result.nametag}`);

          WalletRepository.saveNametagForAddress(identity.address, {
            name: result.nametagData.name,
            token: result.nametagData.token,
            timestamp: result.nametagData.timestamp || Date.now(),
            format: result.nametagData.format || "TXF",
            version: "1.0",
          });

          console.log("✅ [Auto-check] Nametag found, proceeding to wallet...");
          // Clear onboarding flags if set
          localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
          localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
          // Dispatch events to initialize services - no reload needed
          window.dispatchEvent(new Event("wallet-loaded"));
          window.dispatchEvent(new Event("wallet-updated"));
        } else {
          console.log("🔍 [Auto-check] No nametag found in IPNS");
          setIpnsFetchingNametag(false);
        }
      } catch (error) {
        console.warn("🔍 [Auto-check] IPNS fetch error:", error);
        setIpnsFetchingNametag(false);
      }
    };

    // Start background check
    fetchNametag();

    // Skip to nametag screen immediately (don't wait for IPNS)
    console.log("⏩ Identity exists without nametag, skipping to nametag creation");

    // Mark that we're in onboarding flow - this prevents automatic IPNS sync
    // which would compete with our controlled sync during nametag creation
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
    console.log('🎯 Onboarding flag set - IPFS will skip initial IPNS sync');

    setStep("nametag");
  }, [step, identity, nametag]);

  // Internal helper to derive next address
  // Uses WalletCore for unified address derivation (L1 + L3)
  const deriveNextAddressInternal = useCallback(async () => {
    const nextIndex = derivedAddresses.length;
    const keyManager = getUnifiedKeyManager();
    const masterKey = keyManager.getMasterKeyHex();
    const chainCode = keyManager.getChainCodeHex();
    const basePath = keyManager.getBasePath();
    const mode = keyManager.getDerivationMode();

    if (!masterKey) {
      throw new Error("Wallet not initialized");
    }

    // Use WalletCore for unified address derivation
    const path = getAddressPath(nextIndex, false, basePath);
    const unified = await deriveUnifiedAddress(masterKey, chainCode, path, mode);

    const existingNametag = WalletRepository.checkNametagForAddress(unified.l3Address);
    const hasLocalNametag = !!existingNametag;

    setDerivedAddresses((prev) => [
      ...prev,
      {
        index: nextIndex,
        l1Address: unified.l1Address,
        l3Address: unified.l3Address,
        path: path,
        hasNametag: hasLocalNametag,
        existingNametag: existingNametag?.name,
        privateKey: hasLocalNametag ? undefined : unified.privateKey,
        ipnsLoading: !hasLocalNametag,
        balanceLoading: true, // Always check balance for gap limit
      },
    ]);
  }, [derivedAddresses.length, getUnifiedKeyManager]);

  // Effect: Fetch nametags from IPNS and L1 balance sequentially
  useEffect(() => {
    if (step !== "addressSelection" || derivedAddresses.length === 0 || isCheckingIpns) return;

    // Find next address that needs checking (either IPNS or balance)
    const nextToCheck = derivedAddresses.find(
      (addr) => (addr.ipnsLoading && addr.privateKey) || addr.balanceLoading
    );

    if (!nextToCheck) {
      console.log("🔍 All current addresses checked");
      return;
    }

    const fetchAndMaybeDerive = async () => {
      setIsCheckingIpns(true);
      const addr = nextToCheck;
      const chainLabel = addr.isChange ? "change" : "external";
      console.log(`🔍 Checking ${chainLabel} #${addr.index} (path: ${addr.path})...`);

      let foundNametag: string | undefined;
      let nametagData: DerivedAddressInfo["nametagData"];
      let ipnsName: string | undefined;
      let ipnsError: string | undefined;
      let l1Balance = 0;

      // Fetch IPNS nametag if needed
      if (addr.ipnsLoading && addr.privateKey) {
        try {
          const result = await fetchNametagFromIpns(addr.privateKey);
          console.log(`🔍 IPNS result for ${chainLabel} (path: ${addr.path}): ${result.nametag || "none"} (via ${result.source})`);
          foundNametag = result.nametag || undefined;
          nametagData = result.nametagData;
          ipnsName = result.ipnsName;
          ipnsError = result.error;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn(`🔍 IPNS fetch error for ${chainLabel} (path: ${addr.path}):`, message);
          ipnsError = message;
        }
      } else if (addr.existingNametag) {
        foundNametag = addr.existingNametag;
      }

      // Fetch L1 balance
      if (addr.balanceLoading) {
        try {
          l1Balance = await getBalance(addr.l1Address);
          console.log(`💰 L1 balance for ${chainLabel} #${addr.index}: ${l1Balance} ALPHA`);
        } catch (error) {
          console.warn(`💰 Balance fetch error for ${chainLabel} #${addr.index}:`, error);
          l1Balance = 0;
        }
      } else {
        l1Balance = addr.l1Balance ?? 0;
      }

      // Update address with results
      setDerivedAddresses((prev) =>
        prev.map((a) =>
          a.path === addr.path
            ? {
                ...a,
                ipnsName,
                hasNametag: !!foundNametag,
                existingNametag: foundNametag,
                nametagData,
                ipnsLoading: false,
                ipnsError,
                privateKey: undefined,
                l1Balance,
                balanceLoading: false,
              }
            : a
        )
      );

      // Auto-select first found nametag
      if (foundNametag && !firstFoundNametagPath) {
        console.log(`✅ Found FIRST nametag "${foundNametag}" at ${chainLabel} #${addr.index}, auto-selecting`);
        setFirstFoundNametagPath(addr.path);
        setSelectedAddressPath(addr.path);
      } else if (foundNametag) {
        console.log(`✅ Found another nametag "${foundNametag}" at ${chainLabel} #${addr.index}`);
      }

      setIsCheckingIpns(false);

      // Gap limit logic: continue deriving if address has nametag OR L1 balance OR L3 tokens
      // Stop deriving if address has NO activity at all (gap detected)
      const hasL3Tokens = WalletRepository.checkTokensForAddress(addr.l3Address);
      const hasActivity = !!foundNametag || l1Balance > 0 || hasL3Tokens;

      if (autoDeriveDuringIpnsCheck && hasActivity && derivedAddresses.length < 20) {
        console.log(`🔍 Address has activity (nametag: ${!!foundNametag}, L1: ${l1Balance}, L3: ${hasL3Tokens}), deriving next (#${derivedAddresses.length})...`);
        await deriveNextAddressInternal();
      } else if (!hasActivity) {
        console.log(`🔍 Gap detected at ${chainLabel} #${addr.index} (no nametag, no L1 balance, no L3 tokens). Stopping auto-derive.`);
      }
    };

    fetchAndMaybeDerive();
  }, [step, derivedAddresses, isCheckingIpns, firstFoundNametagPath, autoDeriveDuringIpnsCheck, deriveNextAddressInternal]);

  // Helper: derive addresses and check for existing nametags
  // Uses WalletCore for unified address derivation (L1 + L3)
  const deriveAndCheckAddresses = useCallback(
    async (count: number): Promise<DerivedAddressInfo[]> => {
      const keyManager = getUnifiedKeyManager();
      const masterKey = keyManager.getMasterKeyHex();
      const chainCode = keyManager.getChainCodeHex();
      const basePath = keyManager.getBasePath();
      const mode = keyManager.getDerivationMode();

      if (!masterKey) {
        throw new Error("Wallet not initialized");
      }

      const results: DerivedAddressInfo[] = [];

      for (let i = 0; i < count; i++) {
        // Use WalletCore for unified address derivation
        const path = getAddressPath(i, false, basePath);
        const unified = await deriveUnifiedAddress(masterKey, chainCode, path, mode);

        const existingNametag = WalletRepository.checkNametagForAddress(unified.l3Address);
        const hasLocalNametag = !!existingNametag;

        results.push({
          index: i,
          l1Address: unified.l1Address,
          l3Address: unified.l3Address,
          path: path,
          hasNametag: hasLocalNametag,
          existingNametag: existingNametag?.name,
          privateKey: hasLocalNametag ? undefined : unified.privateKey,
          ipnsLoading: !hasLocalNametag,
          balanceLoading: true, // Always check balance for gap limit
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
  // This performs REAL HTTP gateway reads to ensure data is accessible from network
  const verifyNametagInIpnsWithRetry = async (
    privateKey: string,
    expectedNametag: string,
    timeoutMs: number = 60000, // Increased to 60s for IPNS propagation
    onStatusUpdate?: (status: string) => void
  ): Promise<boolean> => {
    const startTime = Date.now();
    const retryInterval = 3000; // Check every 3 seconds
    let successCount = 0;
    const REQUIRED_SUCCESS_COUNT = 2; // Require 2 consecutive successful reads
    let attemptCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      try {
        attemptCount++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.ceil((timeoutMs - (Date.now() - startTime)) / 1000);

        // Update status in UI
        onStatusUpdate?.(`Verifying IPNS... (${elapsed}s / ${Math.floor(timeoutMs / 1000)}s)`);

        console.log(`🔄 IPNS verification attempt #${attemptCount} for "${expectedNametag}" (${elapsed}s elapsed, ${remaining}s remaining)...`);

        const result = await fetchNametagFromIpns(privateKey);

        console.log(`🔄 IPNS result:`, {
          nametag: result.nametag,
          expected: expectedNametag,
          source: result.source,
          hasData: !!result.nametagData
        });

        // Check if nametag matches AND came from HTTP gateway (not cache)
        if (result.nametag === expectedNametag && result.source === "http" && result.nametagData) {
          successCount++;
          onStatusUpdate?.(`Verifying IPNS... (${successCount}/${REQUIRED_SUCCESS_COUNT} confirmations)`);
          console.log(`✅ IPNS read successful (${successCount}/${REQUIRED_SUCCESS_COUNT})`);

          if (successCount >= REQUIRED_SUCCESS_COUNT) {
            console.log(`✅ IPNS verified with ${REQUIRED_SUCCESS_COUNT} consecutive reads`);
            onStatusUpdate?.(`IPNS verified successfully!`);
            return true;
          }

          // Wait a bit before next verification
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // Reset success count if read failed
        successCount = 0;
        console.log(`🔄 IPNS returned "${result.nametag || "null"}", expected "${expectedNametag}"`);
      } catch (error) {
        successCount = 0;
        console.log("🔄 IPNS verification attempt failed, retrying...", error);
      }

      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime > retryInterval) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }
    }

    console.error(`❌ IPNS verification timeout after ${timeoutMs}ms`);
    return false;
  };

  // Action: Create new wallet keys
  const handleCreateKeys = useCallback(async () => {
    if (isBusy) return;

    setIsBusy(true);
    setError(null);

    // Mark onboarding flag BEFORE clearAll - it will be preserved
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
    console.log('🎯 Onboarding flag set - IPFS will skip initial IPNS sync');

    try {
      // Pass false to preserve onboarding flags during cleanup
      UnifiedKeyManager.clearAll(false);

      await createWallet();

      // Save L1 wallet to storage (same as import flow)
      const keyManager = getUnifiedKeyManager();
      const basePath = keyManager.getBasePath();
      const defaultPath = `${basePath}/0/0`;
      const derived = keyManager.deriveAddressFromPath(defaultPath);

      const l1Wallet: L1Wallet = {
        masterPrivateKey: keyManager.getMasterKeyHex() || "",
        chainCode: keyManager.getChainCodeHex() || undefined,
        addresses: [{
          index: 0,
          address: derived.l1Address,
          privateKey: derived.privateKey,
          publicKey: derived.publicKey,
          path: defaultPath,
          isChange: false,
          createdAt: new Date().toISOString(),
        }],
        isBIP32: keyManager.getDerivationMode() === "bip32",
      };
      saveWalletToStorage("main", l1Wallet);
      console.log("💾 Saved L1 wallet for new wallet");

      setStep("nametag");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to generate keys";
      setError(message);
      // Clear onboarding flag on error
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      console.log('🎯 Onboarding flag cleared after error');
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, createWallet, getUnifiedKeyManager]);

  // Action: Restore wallet from mnemonic
  const handleRestoreWallet = useCallback(async () => {
    const words = seedWords.map((w) => w.trim().toLowerCase());
    const missingIndex = words.findIndex((w) => w === "");

    if (missingIndex !== -1) {
      setError(`Please fill in word ${missingIndex + 1}`);
      return;
    }

    setIsBusy(true);
    setError(null);

    // Mark onboarding flag BEFORE clearAll - it will be preserved
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
    console.log('🎯 Onboarding flag set for wallet restore');

    try {
      // Pass false to preserve onboarding flags during cleanup
      UnifiedKeyManager.clearAll(false);

      const mnemonic = words.join(" ");
      const keyManager = getUnifiedKeyManager();
      await keyManager.createFromMnemonic(mnemonic);

      // Go to address selection
      await goToAddressSelection();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid recovery phrase";
      setError(message);
      // Clear onboarding flag on error
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      console.log('🎯 Onboarding flag cleared after restore error');
      setIsBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedWords, getUnifiedKeyManager]);

  // Action: Mint nametag
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);

    // Verify onboarding flag is still set (should have been set in handleCreateKeys)
    const onboardingFlag = localStorage.getItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
    console.log('🎯 handleMintNametag: onboarding flag check:', onboardingFlag);

    // Add beforeunload handler to warn user about closing during sync
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom message, but preventDefault() shows default warning
      return "Your Unicity ID is being synced. Closing now may prevent recovery on other devices.";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    try {
      const cleanTag = nametagInput.trim().replace("@", "");

      const isNametagAvailable = await checkNametagAvailability(cleanTag);
      if (!isNametagAvailable) {
        setError(`${cleanTag} already exists.`);
        setIsBusy(false);
        window.removeEventListener("beforeunload", handleBeforeUnload);
        return;
      }

      setStep("processing");

      // Step 1: Mint nametag
      setProcessingStatus("Minting Unicity ID on blockchain...");
      await mintNametag(cleanTag);
      console.log("✅ Nametag minted and saved to localStorage");

      // DON'T trigger wallet-updated yet - it will start background sync that competes with our syncNow()
      // We'll do a controlled sync here and trigger wallet-updated after

      // Wait a moment for localStorage write to flush
      console.log("⏳ Waiting for nametag to be written to storage...");
      setProcessingStatus("Preparing to sync...");
      await new Promise(resolve => setTimeout(resolve, 300));

      // Ensure wallet is loaded in WalletRepository with the new nametag
      const mintedIdentity = await identityManager.getCurrentIdentity();
      if (!mintedIdentity) {
        throw new Error("Identity not found after minting");
      }
      const walletRepo = WalletRepository.getInstance();
      const wallet = walletRepo.loadWalletForAddress(mintedIdentity.address);
      if (!wallet) {
        throw new Error("Wallet not found after minting");
      }
      const loadedNametag = walletRepo.getNametag();
      if (!loadedNametag || loadedNametag.name !== cleanTag) {
        throw new Error(`Nametag not loaded correctly. Expected "${cleanTag}", got "${loadedNametag?.name || "none"}"`);
      }
      console.log(`✅ Nametag loaded in WalletRepository: ${loadedNametag.name}`);

      // Step 2: Sync to IPFS (CRITICAL - prevents loss on import)
      setProcessingStatus("Syncing to IPFS storage...");
      // Give React time to update UI before blocking on syncNow()
      await new Promise(resolve => setTimeout(resolve, 100));

      const ipfsService = IpfsStorageService.getInstance(identityManager);

      console.log("🔄 Starting IPFS sync with new nametag...");

      // Add timeout to prevent hanging forever if IPFS gets stuck
      // 60 seconds should be enough for IPNS publishing which can be slow
      const syncPromise = ipfsService.syncNow();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("IPFS sync timeout after 60 seconds")), 60000)
      );

      const syncResult = await Promise.race([syncPromise, timeoutPromise]);
      console.log("📦 IPFS sync result:", {
        success: syncResult.success,
        cid: syncResult.cid,
        ipnsName: syncResult.ipnsName,
        ipnsPublished: syncResult.ipnsPublished,
        ipnsPublishPending: syncResult.ipnsPublishPending,
        tokenCount: syncResult.tokenCount,
        error: syncResult.error
      });

      // For new wallets, tokenCount will be 0 (nametag is synced separately)
      // So we just check if sync succeeded
      if (!syncResult.success) {
        console.error("❌ IPFS sync failed:", syncResult.error);
        window.removeEventListener("beforeunload", handleBeforeUnload);
        throw new Error(
          `Failed to sync your Unicity ID to decentralized storage. ${syncResult.error || "Unknown error"}. Your ID is saved locally but may not be recoverable on other devices.`
        );
      }

      // Check if IPNS was published (critical for recovery on other devices)
      if (syncResult.ipnsPublishPending) {
        console.error("❌ IPNS publish failed, marked as pending");
        window.removeEventListener("beforeunload", handleBeforeUnload);
        throw new Error(
          `Your Unicity ID was saved to IPFS but IPNS publish failed. It may not be immediately recoverable on other devices. Please ensure you have a stable internet connection and try again.`
        );
      }

      console.log("✅ IPFS sync completed, IPNS published:", syncResult.ipnsPublished);

      // CRITICAL: For new nametag, IPNS MUST be published
      // If ipnsPublished is false, something went wrong
      if (!syncResult.ipnsPublished) {
        console.error("❌ IPNS was not published during sync");
        window.removeEventListener("beforeunload", handleBeforeUnload);
        throw new Error(
          `Your Unicity ID was saved to IPFS but was not published to IPNS. This means it won't be recoverable on other devices. Please ensure you have a stable internet connection and try again.`
        );
      }

      // Step 3: Verify in IPNS (CRITICAL - ensure recovery works)
      setProcessingStatus("Verifying IPFS availability...");
      const currentIdentity = await identityManager.getCurrentIdentity();

      console.log("🔍 Starting IPNS verification for nametag:", cleanTag);
      console.log("🔍 Current identity:", currentIdentity ? "exists" : "missing");

      const verified = currentIdentity
        ? await verifyNametagInIpnsWithRetry(
            currentIdentity.privateKey,
            cleanTag,
            60000,
            (status) => setProcessingStatus(status) // Update UI in real-time
          )
        : false;

      console.log("🔍 IPNS verification result:", verified);

      if (!verified) {
        console.error("❌ IPNS verification failed after 60s");
        window.removeEventListener("beforeunload", handleBeforeUnload);
        throw new Error(
          `Your Unicity ID was saved but could not be verified in decentralized storage after 60 seconds. This may be due to network issues or IPFS gateway problems. Your ID is saved locally - you can try again later or contact support.`
        );
      }

      console.log(`✅ Verified nametag "${cleanTag}" available via IPNS`);

      // Step 4: Nametag successfully synced - show completion UI
      console.log("🏷️ Step 4: Nametag synced to IPFS successfully!");

      // Remove beforeunload handler
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // DON'T clear onboarding flag yet - we want to show "Let's go!" button first
      // The flag will be cleared in handleCompleteOnboarding when user clicks button
      // But set "complete" flag so if page reloads, we know to proceed to app
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true');
      console.log('🎯 Onboarding complete flag set - ready for user to click "Let\'s go!"');

      console.log('🎯 About to set processing complete...');
      // Show completion screen with "Let's go!" button
      setProcessingStatus("Your Unicity ID is ready!");
      setIsProcessingComplete(true);
      console.log('🎉 Processing complete! isProcessingComplete set to true');
      console.log('🎯 Onboarding in-progress flag still set - waiting for user to click "Let\'s go!"');
    } catch (e) {
      const message = e instanceof Error ? e.message : "Minting failed";
      console.error("❌ Nametag minting failed:", e);
      setError(message);
      setStep("nametag");
      // Remove beforeunload handler on error
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Clear onboarding flag on error so IPFS sync resumes normally
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      console.log('🎯 Onboarding flag cleared after error');
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, checkNametagAvailability, mintNametag]);

  // Action: Complete onboarding and enter app
  const handleCompleteOnboarding = useCallback(() => {
    console.log("🎉 User clicked 'Let's go!' - completing onboarding...");

    // Clear both onboarding flags
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);

    // Set authenticated flag - user has completed initial onboarding
    // This flag tells WalletGate to never show onboarding again for this user
    // New addresses will be created via in-app modal instead
    localStorage.setItem(STORAGE_KEYS.AUTHENTICATED, 'true');
    console.log('🎯 Onboarding flags cleared, authenticated flag set - user can now enter app');

    // Signal wallet creation - this triggers Nostr service initialization and UI updates
    console.log('📢 Dispatching wallet-loaded event...');
    window.dispatchEvent(new Event("wallet-loaded"));
    console.log('📢 Dispatching wallet-updated event...');
    window.dispatchEvent(new Event("wallet-updated"));

    // No reload needed - WalletGate will see flags cleared and show main app
  }, []);

  // Action: Derive new address
  // Uses WalletCore for unified address derivation (L1 + L3)
  const handleDeriveNewAddress = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const keyManager = getUnifiedKeyManager();
      const masterKey = keyManager.getMasterKeyHex();
      const chainCode = keyManager.getChainCodeHex();
      const basePath = keyManager.getBasePath();
      const mode = keyManager.getDerivationMode();

      if (!masterKey) {
        throw new Error("Wallet not initialized");
      }

      // Use WalletCore for unified address derivation
      const path = getAddressPath(nextIndex, false, basePath);
      const unified = await deriveUnifiedAddress(masterKey, chainCode, path, mode);

      const existingNametag = WalletRepository.checkNametagForAddress(unified.l3Address);
      const hasLocalNametag = !!existingNametag;

      setDerivedAddresses([
        ...derivedAddresses,
        {
          index: nextIndex,
          l1Address: unified.l1Address,
          l3Address: unified.l3Address,
          path: path,
          hasNametag: hasLocalNametag,
          existingNametag: existingNametag?.name,
          privateKey: hasLocalNametag ? undefined : unified.privateKey,
          ipnsLoading: !hasLocalNametag,
          balanceLoading: true, // Check balance for gap limit
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to derive new address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [derivedAddresses, getUnifiedKeyManager]);

  // Action: Go to address selection
  const goToAddressSelection = useCallback(
    async (skipIpnsCheck: boolean = false) => {
      setIsBusy(true);
      setError(null);
      try {
        const l1Wallet = loadWalletFromStorage("main");

        if (l1Wallet && l1Wallet.addresses && l1Wallet.addresses.length > 0) {
          const allAddresses = l1Wallet.addresses;
          const changeCount = allAddresses.filter((addr) => addr.isChange).length;
          console.log(`📋 Loading ${allAddresses.length} addresses from L1 wallet storage (${allAddresses.length - changeCount} external, ${changeCount} change)`);
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
            console.log(`🔍 Address (path: ${addr.path}, ${chainLabel}): L1=${addr.address.slice(0, 20)}... L3=${l3Identity.address.slice(0, 20)}... hasNametag=${!!existingNametag}`);

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
              balanceLoading: true, // Check balance for gap limit
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
    },
    [getUnifiedKeyManager, deriveAndCheckAddresses]
  );

  // Action: Continue with selected address
  const handleContinueWithAddress = useCallback(async () => {
    console.log('📍 handleContinueWithAddress called');
    setIsBusy(true);
    setError(null);

    try {
      const visibleAddresses = derivedAddresses.filter((a) => !a.ipnsLoading || a.fromL1Wallet);
      const selectedAddress = visibleAddresses.find((a) => a.path === selectedAddressPath) || visibleAddresses[0];

      if (!selectedAddress) {
        throw new Error("No address selected");
      }

      identityManager.setSelectedAddressPath(selectedAddress.path);

      const keyManager = getUnifiedKeyManager();

      console.log("📋 All derived addresses:", derivedAddresses.map((a) => ({
        index: a.index,
        path: a.path,
        hasNametag: a.hasNametag,
        nametag: a.existingNametag,
        hasNametagData: !!a.nametagData,
      })));

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

      console.log(`📍 Selected address check: hasNametag=${selectedAddress.hasNametag}, path=${selectedAddress.path}`);

      if (selectedAddress.hasNametag) {
        console.log("✅ Address has existing nametag, proceeding to main app");

        // Clear onboarding flags
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
        localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
        console.log('🎯 Onboarding flags cleared for imported wallet');

        // Dispatch events to initialize services (Nostr, etc.)
        window.dispatchEvent(new Event("wallet-loaded"));
        window.dispatchEvent(new Event("wallet-updated"));

        // No reload needed - WalletGate will detect flags and show main app
        return;
      } else {
        console.log("📍 No nametag found, setting onboarding flag and going to nametag screen");
        // Mark that we're in onboarding flow - this prevents automatic IPNS sync
        // which would compete with our controlled sync during nametag creation
        localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
        console.log('🎯 Onboarding flag set - IPFS will skip initial IPNS sync');
        setStep("nametag");
        console.log('📍 Step set to "nametag"');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to select address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [derivedAddresses, selectedAddressPath, getUnifiedKeyManager]);

  return {
    // Step management
    step,
    setStep,
    goToStart,

    // State
    isBusy,
    error,
    setError,
    setIsBusy,

    // Mnemonic restore state
    seedWords,
    setSeedWords,

    // File import state
    selectedFile,
    scanCount,
    needsScanning,
    isDragging,
    setSelectedFile,
    setScanCount,
    setNeedsScanning,
    setIsDragging,

    // Nametag state
    nametagInput,
    setNametagInput,
    processingStatus,
    isProcessingComplete,
    handleCompleteOnboarding,

    // Address selection state
    derivedAddresses,
    selectedAddressPath,
    showAddressDropdown,
    isCheckingIpns,
    ipnsFetchingNametag,
    setSelectedAddressPath,
    setShowAddressDropdown,

    // Actions
    handleCreateKeys,
    handleRestoreWallet,
    handleMintNametag,
    handleDeriveNewAddress,
    handleContinueWithAddress,
    goToAddressSelection,

    // Wallet context
    identity,
    nametag,
    getUnifiedKeyManager,
  };
}
