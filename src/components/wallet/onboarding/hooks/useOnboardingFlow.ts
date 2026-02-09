/**
 * useOnboardingFlow - Manages onboarding flow state and navigation
 * Simplified version using sphere-sdk
 */
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSphereContext } from "../../../../sdk/hooks/core/useSphere";
import { SPHERE_KEYS } from "../../../../sdk/queryKeys";
import { recordActivity } from "../../../../services/ActivityService";
import type { DerivedAddressInfo } from "../components/AddressSelectionScreen";

export type OnboardingStep =
  | "start"
  | "restoreMethod"
  | "restore"
  | "importFile"
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
  handleSkipNametag: () => Promise<void>;
  handleDeriveNewAddress: () => Promise<void>;
  handleContinueWithAddress: () => Promise<void>;
  goToAddressSelection: (skipIpnsCheck?: boolean) => Promise<void>;

  // Wallet context (kept for component compatibility)
  identity: { address: string; privateKey: string } | null | undefined;
  nametag: string | null | undefined;
  generatedMnemonic: string | null;
}

export function useOnboardingFlow(): UseOnboardingFlowReturn {
  const queryClient = useQueryClient();
  const { sphere, createWallet, importWallet } = useSphereContext();

  // Step management — start at "nametag" if wallet exists but no nametag yet
  const [step, setStep] = useState<OnboardingStep>(
    sphere && !sphere.identity?.nametag ? "nametag" : "start"
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

  // Nametag state
  const [nametagInput, setNametagInput] = useState("");
  const [processingStatus, setProcessingStatus] = useState("");
  const [isProcessingComplete, setIsProcessingComplete] = useState(false);

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
    setScanCount(10);
    setNeedsScanning(true);
    setIsDragging(false);
    setError(null);
  }, []);

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

  // Action: Create wallet WITH nametag
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);

    try {
      const cleanTag = nametagInput.trim().replace("@", "");

      setStep("processing");
      setProcessingStatus("Creating wallet and minting Unicity ID...");

      // Create wallet with nametag — SDK handles minting + Nostr broadcast
      const mnemonic = await createWallet({ nametag: cleanTag });
      setGeneratedMnemonic(mnemonic);

      // Record activity
      recordActivity("wallet_created", { isPublic: false });

      // WalletGate will transition to main app automatically
      // since walletExists becomes true
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create wallet";
      console.error("Wallet creation with nametag failed:", e);
      setError(message);
      setStep("nametag");
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, createWallet]);

  // Action: Skip nametag — create wallet without nametag
  const handleSkipNametag = useCallback(async () => {
    setIsBusy(true);
    setError(null);

    try {
      setStep("processing");
      setProcessingStatus("Creating wallet...");

      const mnemonic = await createWallet();
      setGeneratedMnemonic(mnemonic);

      recordActivity("wallet_created", { isPublic: false });

      // WalletGate will transition to main app automatically
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create wallet";
      console.error("Wallet creation failed:", e);
      setError(message);
      setStep("nametag");
    } finally {
      setIsBusy(false);
    }
  }, [createWallet]);

  // Action: Complete onboarding (called when user clicks "Let's Go")
  const handleCompleteOnboarding = useCallback(async () => {
    // Invalidate all queries to refresh with new identity
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });

    // Signal wallet creation for legacy listeners
    window.dispatchEvent(new Event("wallet-loaded"));
    window.dispatchEvent(new Event("wallet-updated"));

    setStep("start");
  }, [queryClient]);

  // Action: Derive new address (for address selection screen)
  const handleDeriveNewAddress = useCallback(async () => {
    if (!sphere) return;
    setIsBusy(true);
    try {
      const nextIndex = derivedAddresses.length;
      const addr = sphere.deriveAddress(nextIndex);
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
      if (!sphere) return;
      setIsBusy(true);
      setError(null);
      try {
        const addresses = sphere.deriveAddresses(3);
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
    if (!sphere) return;
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
      await sphere.switchToAddress(selectedAddress.index);

      // Check if this address already has a nametag
      if (sphere.identity?.nametag) {
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

    // Wallet context
    identity: sphere?.identity ? {
      address: sphere.identity.directAddress ?? '',
      privateKey: '', // Not exposed by SDK public API
    } : null,
    nametag: sphere?.identity?.nametag ?? null,
    generatedMnemonic,
  };
}
