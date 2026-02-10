/**
 * useOnboardingFlow - Manages onboarding flow state and navigation
 * Simplified version using sphere-sdk
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sphere } from "@unicitylabs/sphere-sdk";
import type { ScanAddressProgress, LegacyFileType } from "@unicitylabs/sphere-sdk";
import { useSphereContext } from "../../../../sdk/hooks/core/useSphere";
import { SPHERE_KEYS } from "../../../../sdk/queryKeys";
import { recordActivity } from "../../../../services/ActivityService";
import type { DerivedAddressInfo } from "../components/AddressSelectionScreen";
import type { NametagAvailability } from "../components/NametagScreen";

export type OnboardingStep =
  | "start"
  | "restoreMethod"
  | "restore"
  | "importFile"
  | "passwordPrompt"
  | "addressSelection"
  | "nametag"
  | "processing";

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
  scanProgress: ScanAddressProgress | null;
  showScanModal: boolean;

  // Nametag state
  nametagInput: string;
  setNametagInput: (value: string) => void;
  nametagAvailability: NametagAvailability;
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
  handleSkipNametag: () => Promise<void>;
  handleDeriveNewAddress: () => Promise<void>;
  handleContinueWithAddress: () => Promise<void>;
  goToAddressSelection: (skipIpnsCheck?: boolean) => Promise<void>;

  // File import actions
  handleFileSelect: (file: File) => Promise<void>;
  handleClearFile: () => void;
  handleScanCountChange: (count: number) => void;
  handleFileImport: () => Promise<void>;
  handlePasswordSubmit: (password: string) => Promise<void>;
  handleCancelScan: () => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;

  // Wallet context (kept for component compatibility)
  identity: { address: string; privateKey: string } | null | undefined;
  nametag: string | null | undefined;
  generatedMnemonic: string | null;
}

export function useOnboardingFlow(): UseOnboardingFlowReturn {
  const queryClient = useQueryClient();
  const { sphere, createWallet, resolveNametag, importWallet, importFromFile, finalizeWallet, walletExists } = useSphereContext();

  // Step management — start at "nametag" only if wallet is fully finalized but missing nametag
  // (e.g. page refresh after wallet creation without nametag).
  // During import flow, walletExists is false (deferred to finalizeWallet) so we always start at "start".
  const [step, setStep] = useState<OnboardingStep>(
    sphere && walletExists && !sphere.identity?.nametag ? "nametag" : "start"
  );

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
  const [fileContent, setFileContent] = useState<string | Uint8Array | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<LegacyFileType>('unknown');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanAddressProgress | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);
  // Holds the imported Sphere instance during the import flow.
  // NOT set in SphereProvider context until finalizeWallet() to avoid premature re-renders.
  const importedSphereRef = useRef<Sphere | null>(null);

  // Nametag state
  const [nametagInput, setNametagInput] = useState("");
  const [nametagAvailability, setNametagAvailability] = useState<NametagAvailability>('idle');
  const [processingStatus, setProcessingStatus] = useState("");
  const [isProcessingComplete, setIsProcessingComplete] = useState(false);

  // Debounced nametag availability check
  useEffect(() => {
    const cleanTag = nametagInput.trim().replace(/^@/, '');
    if (!cleanTag || cleanTag.length < 2) {
      setNametagAvailability('idle');
      return;
    }

    setNametagAvailability('checking');
    const timer = setTimeout(async () => {
      try {
        const existing = await resolveNametag(cleanTag);
        setNametagAvailability(existing ? 'taken' : 'available');
      } catch {
        setNametagAvailability('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [nametagInput, resolveNametag]);

  // Address selection state
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedAddressPath, setSelectedAddressPath] = useState<string | null>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);

  // Generated mnemonic (from create flow)
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);

  // Go back to start screen
  const goToStart = useCallback(() => {
    setStep("start");
    setSeedWords(Array(12).fill(""));
    setSelectedFile(null);
    setFileContent(null);
    setDetectedFileType('unknown');
    setIsEncrypted(false);
    setScanCount(10);
    setNeedsScanning(true);
    setIsDragging(false);
    setScanProgress(null);
    setShowScanModal(false);
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    importedSphereRef.current = null;
    setError(null);
  }, []);

  // ---- File import handlers ----

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setError(null);

    // Read file content
    let content: string | Uint8Array;
    if (file.name.endsWith('.dat')) {
      const buffer = await file.arrayBuffer();
      content = new Uint8Array(buffer);
    } else {
      content = await file.text();
    }
    setFileContent(content);

    // Detect file type and encryption
    const fileType = Sphere.detectLegacyFileType(file.name, content);
    setDetectedFileType(fileType);
    const encrypted = Sphere.isLegacyFileEncrypted(file.name, content);
    setIsEncrypted(encrypted);

    // Determine if scanning is needed based on file type and content
    if (fileType === 'dat' || fileType === 'txt') {
      setNeedsScanning(true);
    } else if (fileType === 'json' && typeof content === 'string') {
      // JSON with BIP32 keys and no mnemonic needs scanning
      try {
        const json = JSON.parse(content);
        const hasBip32 = !!(json.wallet?.chainCode || json.chainCode || json.derivationMode === 'bip32');
        const hasMnemonic = !!json.mnemonic;
        setNeedsScanning(hasBip32 && !hasMnemonic);
      } catch {
        setNeedsScanning(false);
      }
    } else {
      setNeedsScanning(false);
    }
  }, []);

  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setFileContent(null);
    setDetectedFileType('unknown');
    setIsEncrypted(false);
    setNeedsScanning(true);
    setError(null);
  }, []);

  const handleScanCountChange = useCallback((count: number) => {
    setScanCount(count);
  }, []);

  // Route after successful import: open scan modal or go to nametag.
  // Uses detectedFileType (from handleFileSelect) and wallet info to decide.
  // Always stores the sphere in importedSphereRef — it is NOT in context yet.
  const routeAfterImport = useCallback((importedSphere: Sphere) => {
    importedSphereRef.current = importedSphere;

    const walletInfo = importedSphere.getWalletInfo();
    const isMnemonic = detectedFileType === 'mnemonic' || walletInfo.hasMnemonic;

    // Scan BIP32 wallets that weren't imported from mnemonic
    const shouldScan = !isMnemonic && (
      detectedFileType === 'dat' ||
      detectedFileType === 'txt' ||
      (detectedFileType === 'json' && walletInfo.hasChainCode)
    );

    if (shouldScan) {
      // BIP32 wallet — open scan modal. useEffect below will start scanning.
      setScanProgress(null);
      setShowScanModal(true);
    } else if (importedSphere.identity?.nametag) {
      setStep("processing");
      setProcessingStatus("Setup complete!");
      setIsProcessingComplete(true);
    } else {
      setStep("nametag");
    }
  }, [detectedFileType]);

  // Effect: run blockchain scan when scan modal opens.
  // Decoupled from import callback to avoid React re-render interference.
  // Uses a `cancelled` flag so that StrictMode's cleanup-then-remount cycle
  // doesn't cause the first invocation's catch to clobber state.
  useEffect(() => {
    if (!showScanModal || !importedSphereRef.current) return;

    let cancelled = false;
    const importedSphere = importedSphereRef.current;
    const controller = new AbortController();
    scanAbortRef.current = controller;

    (async () => {
      try {
        const result = await importedSphere.scanAddresses({
          maxAddresses: scanCount,
          gapLimit: 20,
          includeChange: true,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!cancelled) setScanProgress(progress);
          },
        });

        if (cancelled) return;

        // Convert scan results to DerivedAddressInfo
        const addresses: DerivedAddressInfo[] = result.addresses.map((a) => ({
          index: a.index,
          l1Address: a.address,
          l3Address: '',
          path: a.path,
          hasNametag: false,
          isChange: a.isChange,
          l1Balance: a.balance,
          balanceLoading: false,
          ipnsLoading: false,
        }));

        // Always include address 0 if not found in scan
        if (!addresses.some((a) => a.index === 0 && !a.isChange)) {
          const addr0 = importedSphere.deriveAddress(0, false);
          addresses.unshift({
            index: 0,
            l1Address: addr0.address,
            l3Address: '',
            path: addr0.path,
            hasNametag: false,
            isChange: false,
            l1Balance: 0,
            balanceLoading: false,
            ipnsLoading: false,
          });
        }

        setShowScanModal(false);
        setDerivedAddresses(addresses);
        setSelectedAddressPath(addresses[0]?.path || null);
        setStep("addressSelection");
      } catch (e) {
        if (cancelled) return;

        setShowScanModal(false);
        if (controller.signal.aborted) {
          // User cancelled — go to address selection with default address
          const addr0 = importedSphere.deriveAddress(0, false);
          setDerivedAddresses([{
            index: 0,
            l1Address: addr0.address,
            l3Address: '',
            path: addr0.path,
            hasNametag: false,
            isChange: false,
            l1Balance: 0,
            balanceLoading: false,
            ipnsLoading: false,
          }]);
          setSelectedAddressPath(addr0.path);
          setStep("addressSelection");
        } else {
          setError(e instanceof Error ? e.message : "Scan failed");
          setStep("importFile");
        }
      } finally {
        if (!cancelled) {
          scanAbortRef.current = null;
          // Do NOT clear importedSphereRef here — post-scan handlers
          // (handleContinueWithAddress, handleDeriveNewAddress, etc.) still need it.
          // It's cleared in handleCompleteOnboarding / goToStart.
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanModal]);

  const handleFileImport = useCallback(async () => {
    if (!fileContent || !selectedFile) return;

    // Encrypted file → password prompt
    if (isEncrypted) {
      setStep("passwordPrompt");
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const result = await importFromFile({
        fileContent,
        fileName: selectedFile.name,
      });

      if (!result.success) {
        if (result.needsPassword) {
          setIsEncrypted(true);
          setStep("passwordPrompt");
          return;
        }
        setError(result.error || "Import failed");
        return;
      }

      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      }

      recordActivity("wallet_created", { isPublic: false });

      if (result.sphere) {
        routeAfterImport(result.sphere);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setIsBusy(false);
    }
  }, [fileContent, selectedFile, isEncrypted, importFromFile, routeAfterImport]);

  const handlePasswordSubmit = useCallback(async (password: string) => {
    if (!fileContent || !selectedFile) return;

    setIsBusy(true);
    setError(null);

    try {
      const result = await importFromFile({
        fileContent,
        fileName: selectedFile.name,
        password,
      });

      if (!result.success) {
        if (result.needsPassword) {
          setError("Incorrect password. Please try again.");
          return;
        }
        setError(result.error || "Decryption failed");
        return;
      }

      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      }

      recordActivity("wallet_created", { isPublic: false });

      if (result.sphere) {
        routeAfterImport(result.sphere);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decryption failed");
    } finally {
      setIsBusy(false);
    }
  }, [fileContent, selectedFile, importFromFile, routeAfterImport]);

  const handleCancelScan = useCallback(() => {
    scanAbortRef.current?.abort();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      await handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Action: Go to nametag step (wallet is NOT created yet)
  const handleCreateKeys = useCallback(async () => {
    setError(null);
    setStep("nametag");
  }, []);

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

    try {
      const mnemonic = words.join(" ");
      await importWallet(mnemonic);

      // SDK recovers nametag from Nostr during import.
      // If nametag was recovered, go straight to completion.
      // Otherwise, go to nametag step.
      if (sphere?.identity?.nametag) {
        setStep("processing");
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid recovery phrase";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [seedWords, importWallet, sphere]);

  // Action: Create wallet WITH nametag (or register nametag on imported wallet)
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);

    const cleanTag = nametagInput.trim().replace("@", "");

    setStep("processing");
    setProcessingStatus("Checking Unicity ID availability...");

    try {
      // Step 1: Check nametag availability via Nostr (no wallet needed)
      const existing = await resolveNametag(cleanTag);
      if (existing) {
        setError(`@${cleanTag} is already taken`);
        setStep("nametag");
        setIsBusy(false);
        return;
      }

      const activeSphere = importedSphereRef.current ?? sphere;
      if (activeSphere) {
        // Import flow — wallet already exists (in ref), just register nametag
        setProcessingStatus("Registering Unicity ID...");
        await activeSphere.registerNametag(cleanTag);
        recordActivity("wallet_created", { isPublic: false });
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
      } else {
        // Create flow — create wallet with nametag
        setProcessingStatus("Creating wallet and registering Unicity ID...");
        const mnemonic = await createWallet({ nametag: cleanTag });
        setGeneratedMnemonic(mnemonic);
        recordActivity("wallet_created", { isPublic: false });
        // WalletGate will transition to main app automatically
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to register Unicity ID";
      console.error("Wallet creation with nametag failed:", e);
      setError(message);
      setStep("nametag");
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, resolveNametag, createWallet, sphere]);

  // Action: Skip nametag — create wallet without nametag (or finalize imported wallet)
  const handleSkipNametag = useCallback(async () => {
    setIsBusy(true);
    setError(null);

    try {
      setStep("processing");

      if (importedSphereRef.current ?? sphere) {
        // Import flow — wallet already exists (in ref), just finalize
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
        recordActivity("wallet_created", { isPublic: false });
      } else {
        // Create flow — create wallet without nametag
        setProcessingStatus("Creating wallet...");
        const mnemonic = await createWallet();
        setGeneratedMnemonic(mnemonic);
        recordActivity("wallet_created", { isPublic: false });
        // WalletGate will transition to main app automatically
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create wallet";
      console.error("Wallet creation failed:", e);
      setError(message);
      setStep("nametag");
    } finally {
      setIsBusy(false);
    }
  }, [createWallet, sphere]);

  // Action: Complete onboarding (called when user clicks "Let's Go")
  const handleCompleteOnboarding = useCallback(async () => {
    // Mark wallet as existing so WalletGate transitions to main app.
    // For create flows walletExists is already true — this is a no-op for sphere.
    // For import flows this sets the sphere in context + walletExists = true.
    finalizeWallet(importedSphereRef.current ?? undefined);
    importedSphereRef.current = null;

    // Invalidate all queries to refresh with new identity
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });

    // Signal wallet creation for legacy listeners
    window.dispatchEvent(new Event("wallet-loaded"));
    window.dispatchEvent(new Event("wallet-updated"));

    setStep("start");
  }, [queryClient, finalizeWallet]);

  // Action: Derive new address (for address selection screen)
  const handleDeriveNewAddress = useCallback(async () => {
    const activeSphere = importedSphereRef.current ?? sphere;
    if (!activeSphere) return;
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const addr = activeSphere.deriveAddress(nextIndex);
      setDerivedAddresses((prev) => [
        ...prev,
        {
          index: nextIndex,
          l1Address: addr.address,
          l3Address: '', // Will be populated after switching
          path: addr.path,
          hasNametag: false,
          ipnsLoading: false,
          balanceLoading: false,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to derive new address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [derivedAddresses, sphere]);

  // Action: Go to address selection
  const goToAddressSelection = useCallback(
    async () => {
      const activeSphere = importedSphereRef.current ?? sphere;
      if (!activeSphere) return;
      setIsBusy(true);
      setError(null);
      try {
        const addresses = activeSphere.deriveAddresses(3);
        const results: DerivedAddressInfo[] = addresses.map((addr, i) => ({
          index: i,
          l1Address: addr.address,
          l3Address: '', // Populated on selection
          path: addr.path,
          hasNametag: false,
          ipnsLoading: false,
          balanceLoading: false,
        }));

        setDerivedAddresses(results);
        setSelectedAddressPath(results[0]?.path || null);
        setStep("addressSelection");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to derive addresses";
        setError(message);
      } finally {
        setIsBusy(false);
      }
    },
    [sphere]
  );

  // Action: Continue with selected address
  const handleContinueWithAddress = useCallback(async () => {
    const activeSphere = importedSphereRef.current ?? sphere;
    if (!activeSphere) return;
    setIsBusy(true);
    setError(null);

    try {
      const selectedAddress = derivedAddresses.find(
        (a) => a.path === selectedAddressPath
      ) || derivedAddresses[0];

      if (!selectedAddress) {
        throw new Error("No address selected");
      }

      // Switch SDK to selected address
      await activeSphere.switchToAddress(selectedAddress.index);

      // Check if this address already has a nametag
      if (activeSphere.identity?.nametag) {
        setStep("processing");
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to select address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [derivedAddresses, selectedAddressPath, sphere]);

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
    scanProgress,
    showScanModal,

    // Nametag state
    nametagInput,
    setNametagInput,
    nametagAvailability,
    processingStatus,
    isProcessingComplete,
    handleCompleteOnboarding,

    // Address selection state
    derivedAddresses,
    selectedAddressPath,
    showAddressDropdown,
    isCheckingIpns: false,
    ipnsFetchingNametag: false,
    setSelectedAddressPath,
    setShowAddressDropdown,

    // Actions
    handleCreateKeys,
    handleRestoreWallet,
    handleMintNametag,
    handleSkipNametag,
    handleDeriveNewAddress,
    handleContinueWithAddress,
    goToAddressSelection,

    // File import actions
    handleFileSelect,
    handleClearFile,
    handleScanCountChange,
    handleFileImport,
    handlePasswordSubmit,
    handleCancelScan,
    handleDragOver,
    handleDragLeave,
    handleDrop,

    // Wallet context
    identity: sphere?.identity ? {
      address: sphere.identity.directAddress ?? '',
      privateKey: '', // Not exposed by SDK public API
    } : null,
    nametag: sphere?.identity?.nametag ?? null,
    generatedMnemonic,
  };
}
