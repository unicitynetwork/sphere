/**
 * useOnboardingFlow - Manages onboarding flow state and navigation
 */
import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet, KEYS } from "../../L3/hooks/useWallet";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import {
  setImportInProgress,
  clearImportInProgress,
} from "../../L3/services/InventorySyncService";
import { IdentityManager } from "../../L3/services/IdentityManager";
import { fetchNametagFromIpns } from "../../L3/services/IpnsNametagFetcher";
import { IpfsStorageService } from "../../L3/services/IpfsStorageService";
import { recordActivity } from "../../../../services/ActivityService";
import {
  checkNametagForAddress,
  hasTokensForAddress,
  setNametagForAddress,
  getNametagForAddress,
  getInvalidatedNametagsForAddress,
} from "../../L3/services/InventorySyncService";
import {
  saveWalletToStorage,
  loadWalletFromStorage,
  getBalance,
  type Wallet as L1Wallet,
} from "../../L1/sdk";
import type { DerivedAddressInfo } from "../components/AddressSelectionScreen";
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
  handleCompleteOnboarding: () => Promise<void>;

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
  const queryClient = useQueryClient();
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
  const [ipnsCheckCompleted, setIpnsCheckCompleted] = useState(false);

  // Effect: Fetch nametag from IPNS when identity exists but nametag doesn't
  // CRITICAL FIX: Added ipnsCheckCompleted to prevent infinite loop.
  // Without this, when no nametag is found, setting ipnsFetchingNametag=false
  // would trigger the effect again, causing an infinite loop of IPNS checks.
  useEffect(() => {
    if (step !== "start" || !identity || nametag || ipnsFetchingNametag || ipnsCheckCompleted) return;

    const fetchNametag = async () => {
      setIpnsFetchingNametag(true);
      console.log("🔍 [Complete Setup] Checking IPNS for existing nametag...");

      try {
        const result = await fetchNametagFromIpns(identity.privateKey);

        if (result.nametag && result.nametagData) {
          console.log(`🔍 [Complete Setup] Found nametag: ${result.nametag}`);

          // CRITICAL: Check if this nametag was invalidated (e.g., owned by someone else on Nostr)
          // If so, DO NOT restore it - user must create a new nametag
          const invalidatedNametags = getInvalidatedNametagsForAddress(identity.address);
          const isInvalidated = invalidatedNametags.some(inv => inv.name === result.nametag);

          if (isInvalidated) {
            console.warn(`🚫 [Complete Setup] Nametag "${result.nametag}" was invalidated - NOT restoring from IPNS`);
            setIpnsFetchingNametag(false);
            return;
          }

          try {
            setNametagForAddress(identity.address, {
              name: result.nametagData.name,
              token: result.nametagData.token,
              timestamp: result.nametagData.timestamp || Date.now(),
              format: result.nametagData.format || "TXF",
              version: "1.0",
            });

            console.log("✅ [Complete Setup] Nametag found and saved, proceeding to wallet...");
            window.location.reload();
          } catch (validationError) {
            // Token data from IPFS is corrupted - skip saving, continue without nametag
            console.warn(`⚠️ [Complete Setup] Nametag "${result.nametag}" has corrupted token data - skipping save:`,
              validationError instanceof Error ? validationError.message : validationError
            );
            setIpnsFetchingNametag(false);
            setIpnsCheckCompleted(true);
          }
        } else {
          console.log("🔍 [Complete Setup] No nametag found in IPNS - user can create new nametag");
          setIpnsFetchingNametag(false);
          setIpnsCheckCompleted(true);
        }
      } catch (error) {
        console.warn("🔍 [Complete Setup] IPNS fetch error:", error);
        setIpnsFetchingNametag(false);
        setIpnsCheckCompleted(true);
      }
    };

    fetchNametag();
  }, [step, identity, nametag, ipnsFetchingNametag, ipnsCheckCompleted]);

  // Internal helper to derive next address
  const deriveNextAddressInternal = useCallback(async () => {
    const nextIndex = derivedAddresses.length;
    const keyManager = getUnifiedKeyManager();
    const basePath = keyManager.getBasePath();
    const path = `${basePath}/0/${nextIndex}`;
    const derived = keyManager.deriveAddressFromPath(path);
    const l3Identity = await identityManager.deriveIdentityFromPath(path);
    const existingNametag = checkNametagForAddress(l3Identity.address);
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
      const hasL3Tokens = hasTokensForAddress(addr.l3Address);
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
  const deriveAndCheckAddresses = useCallback(
    async (count: number): Promise<DerivedAddressInfo[]> => {
      const keyManager = getUnifiedKeyManager();
      const basePath = keyManager.getBasePath();
      const results: DerivedAddressInfo[] = [];

      for (let i = 0; i < count; i++) {
        const path = `${basePath}/0/${i}`;
        const derived = keyManager.deriveAddressFromPath(path);
        const l3Identity = await identityManager.deriveIdentityFromPath(path);
        const existingNametag = checkNametagForAddress(l3Identity.address);
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
  const handleCreateKeys = useCallback(async () => {
    if (isBusy) return;

    // Mark onboarding flag BEFORE clearAll - it will be preserved
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
    console.log('🎯 Onboarding flag set - starting wallet creation');

    setIsBusy(true);
    setError(null);
    try {
      // Mark that we're in an active wallet creation flow
      // This allows wallet creation even though credentials will exist after generateNewIdentity()
      // (because generateNewIdentity saves mnemonic BEFORE wallet creation)
      setImportInProgress();

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

      // Clear import flag - wallet creation complete
      clearImportInProgress();
    } catch (e) {
      // Clear import flag on error
      clearImportInProgress();
      // Clear onboarding flag on error
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      console.log('🎯 Onboarding flag cleared after wallet creation error');
      const message = e instanceof Error ? e.message : "Failed to generate keys";
      setError(message);
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

    // Mark onboarding flag BEFORE clearAll - it will be preserved
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
    console.log('🎯 Onboarding flag set for wallet restore');

    setIsBusy(true);
    setError(null);

    try {
      // Mark that we're in an active import flow
      // This allows wallet creation even though credentials exist
      setImportInProgress();

      // Pass false to preserve onboarding flags during cleanup
      UnifiedKeyManager.clearAll(false);
      const mnemonic = words.join(" ");
      const keyManager = getUnifiedKeyManager();
      await keyManager.createFromMnemonic(mnemonic);

      // Go to address selection
      await goToAddressSelection();
    } catch (e) {
      // Clear import flag on error
      clearImportInProgress();
      // Clear onboarding flag on error
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      console.log('🎯 Onboarding flag cleared after restore error');
      const message = e instanceof Error ? e.message : "Invalid recovery phrase";
      setError(message);
      setIsBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedWords, getUnifiedKeyManager]);

  // Action: Mint nametag
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim()) return;

    // Check if onboarding is in progress
    const onboardingFlag = localStorage.getItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
    if (onboardingFlag !== 'true') {
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS, 'true');
      console.log('🎯 Onboarding flag set for nametag minting');
    }

    // Add beforeunload handler to warn user about closing during sync
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Your wallet is being set up. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    setIsBusy(true);
    setError(null);
    setIsProcessingComplete(false);

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

      // Step 2: Sync to IPFS
      setProcessingStatus("Syncing to IPFS storage...");
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        await ipfsService.syncNow();
        console.log("✅ IPFS sync completed");
      } catch (syncError) {
        console.warn("⚠️ IPFS sync failed, continuing anyway:", syncError);
      }

      // Step 3: Verify in IPNS
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

      // Step 4: Record wallet creation activity
      console.log("🏷️ Step 4: Recording wallet creation activity...");
      recordActivity("wallet_created", { isPublic: false });

      // Remove beforeunload handler - sync is complete
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Step 5: Mark processing as complete and wait for user to click "Let's Go"
      console.log("🏷️ Step 5: All steps completed, waiting for user confirmation...");
      setProcessingStatus("Setup complete!");
      setIsProcessingComplete(true);

      // Mark onboarding as complete (but not yet finished - user needs to click Let's Go)
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true');

    } catch (e) {
      const message = e instanceof Error ? e.message : "Minting failed";
      console.error("❌ Nametag minting failed:", e);
      setError(message);
      setStep("nametag");

      // Remove beforeunload handler on error
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Clear onboarding flags on error
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, checkNametagAvailability, mintNametag]);

  // Action: Complete onboarding (called when user clicks "Let's Go")
  const handleCompleteOnboarding = useCallback(async () => {
    console.log("🎉 User clicked Let's Go - completing onboarding...");

    // Pre-populate TanStack Query cache with identity and nametag data
    // This prevents the delay when WalletPanel loads after onboarding
    try {
      const currentIdentity = await identityManager.getCurrentIdentity();
      if (currentIdentity) {
        // Set identity in cache (query key: ["wallet", "identity"])
        queryClient.setQueryData(KEYS.IDENTITY, currentIdentity);
        console.log("📦 Pre-populated identity cache");

        // Get nametag from localStorage and set in cache
        const nametagData = getNametagForAddress(currentIdentity.address);
        if (nametagData?.name) {
          // Query key: ["wallet", "nametag", address]
          queryClient.setQueryData([...KEYS.NAMETAG, currentIdentity.address], nametagData.name);
          console.log(`📦 Pre-populated nametag cache: @${nametagData.name}`);
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to pre-populate query cache:", err);
      // Continue anyway - queries will fetch data normally
    }

    // Mark user as authenticated (permanent flag - survives logout with fullCleanup=false)
    localStorage.setItem(STORAGE_KEYS.AUTHENTICATED, 'true');

    // Clear onboarding in-progress flag
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);

    // Signal wallet creation - this triggers Nostr service initialization
    window.dispatchEvent(new Event("wallet-loaded"));
    // Trigger UI updates
    window.dispatchEvent(new Event("wallet-updated"));

    // Reset to start - this will trigger navigation away from onboarding
    // because identity and nametag now exist
    setStep("start");
  }, [queryClient]);

  // Action: Derive new address
  const handleDeriveNewAddress = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const keyManager = getUnifiedKeyManager();
      const basePath = keyManager.getBasePath();
      const path = `${basePath}/0/${nextIndex}`;
      const derived = keyManager.deriveAddressFromPath(path);
      const l3Identity = await identityManager.deriveIdentityFromPath(path);
      const existingNametag = checkNametagForAddress(l3Identity.address);
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
            const existingNametag = checkNametagForAddress(l3Identity.address);

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

      // Save nametags from IPNS (skip corrupted tokens gracefully)
      for (const addr of derivedAddresses) {
        if (addr.hasNametag && addr.nametagData && addr.l3Address) {
          console.log(`💾 Saving nametag for ${addr.l3Address.slice(0, 20)}...`);
          try {
            setNametagForAddress(addr.l3Address, {
              name: addr.nametagData.name,
              token: addr.nametagData.token,
              timestamp: addr.nametagData.timestamp || Date.now(),
              format: addr.nametagData.format || "TXF",
              version: "1.0",
            });
            console.log(`💾 Saved IPNS-fetched nametag "${addr.nametagData.name}" for address ${addr.l3Address.slice(0, 20)}...`);
          } catch (validationError) {
            // Token data from IPFS is corrupted/invalid - skip saving but don't break flow
            // The user can still use the address, they'll just need to re-mint the nametag
            console.warn(`⚠️ Skipping corrupted nametag "${addr.nametagData.name}" for ${addr.l3Address.slice(0, 20)}... - token validation failed:`,
              validationError instanceof Error ? validationError.message : validationError
            );
            // Mark this address as NOT having a valid nametag since we couldn't save it
            addr.hasNametag = false;
          }
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
      // Clear import flag - import is complete (success or failure)
      clearImportInProgress();
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
