/**
 * useOnboardingFlow - Manages onboarding flow state and navigation
 * Simplified version using sphere-sdk
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sphere } from "@unicitylabs/sphere-sdk";
import type { LegacyFileType } from "@unicitylabs/sphere-sdk";
import { useSphereContext } from "../../../../sdk/hooks/core/useSphere";
import { SPHERE_KEYS } from "../../../../sdk/queryKeys";
import { addrKey } from "../components/addrKey";
import { createWalletThenRegister } from "./createWalletThenRegister";
import { buildWalletBackup } from "./buildWalletBackup";
import type { DerivedAddressInfo } from "../components/AddressSelectionScreen";
import type { NametagAvailability } from "../components/NametagScreen";
import { provisionOrRecoverKey, getStorePlans } from "../../../../services/subscriptionApi";
import { SUBSCRIPTION_ENABLED, PAID_PLANS_ENABLED } from "../../../../config/subscription";
import { getStoredSubscriptionKey, setStoredSubscriptionKey } from "../../../../config/subscriptionKeyCache";
import { saveWalletKey } from "../../../../sdk/subscription/keyVault";
import { isFreePlanName, hasPaidOffers } from "../../../subscription/planFeatures";

/** Cap onboarding's subscription provisioning; on expiry we use the env key. */
const PROVISION_TIMEOUT_MS = 8000;

/**
 * Cap the catalogue read that decides whether the plan step has anything to
 * offer. Much shorter than provisioning: nothing depends on the answer except
 * whether to show one screen, and entering the wallet must not wait on the
 * store. On expiry we show the step — the same fail-open hasPaidOffers applies
 * to an unresolved catalogue everywhere else.
 */
const CATALOGUE_TIMEOUT_MS = 2500;

/** Whether this network's gateway has anything to sell, as far as we can tell in time. */
async function catalogueHasOffers(): Promise<boolean> {
  if (!PAID_PLANS_ENABLED) return false;
  try {
    const plans = await Promise.race([
      getStorePlans(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), CATALOGUE_TIMEOUT_MS)),
    ]);
    return hasPaidOffers(plans, PAID_PLANS_ENABLED);
  } catch {
    return true; // fail open, exactly as hasPaidOffers does on an unresolved catalogue
  }
}

export type OnboardingStep =
  | "start"
  | "restoreMethod"
  | "restore"
  | "importFile"
  | "passwordPrompt"
  | "addressSelection"
  | "nametag"
  | "processing"
  | "mnemonicShow"
  | "mnemonicConfirm"
  | "setPassword"
  | "backupDownload"
  | "planCapabilities";

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
  isDragging: boolean;

  // Nametag state
  nametagInput: string;
  setNametagInput: (value: string) => void;
  nametagAvailability: NametagAvailability;
  processingStatus: string;
  processingStep: number;
  processingTotalSteps: number;
  processingTitle: string;
  processingCompleteTitle: string;
  isProcessingComplete: boolean;
  handleCompleteOnboarding: () => Promise<void>;
  /**
   * Advances from the mnemonic SHOW step to the mnemonic CONFIRM step
   * (#449 create-flow reorder: show -> confirm -> password -> download).
   */
  handleMnemonicShowContinue: () => void;
  /**
   * Verifies the re-entered recovery phrase against `generatedMnemonic`
   * (both sides normalized: trim / collapse whitespace / lowercase). On a
   * match, advances to `setPassword`; on a mismatch, surfaces an inline
   * `error` and stays on the confirm step — never advances on a wrong
   * phrase.
   */
  handleConfirmMnemonic: (entered: string) => void;
  /** Returns from the mnemonic CONFIRM step back to the SHOW step. */
  handleMnemonicConfirmBack: () => void;
  /** Finalizes the wallet after the backup-download step. */
  handleBackupDownloadComplete: () => void;
  handleDownloadBackup: () => Promise<void>;
  /**
   * True once a wallet password was set in this create flow's `setPassword`
   * step (which now runs BEFORE the backup-download screen). The SAME
   * password is what `handleDownloadBackup` threads into the exported backup
   * file, so this also tells `BackupDownloadScreen` which label/copy to
   * show.
   */
  backupEncrypted: boolean;
  /**
   * Set/Skip handler for `SetPasswordScreen` (#449 / #449 follow-up / #449
   * Task C). Reached from THREE flows, all handled identically now:
   *  - Create: the wallet is ALREADY persisted (plaintext) by the time this
   *    screen shows (reached via show -> confirm -> here).
   *  - Restore-from-mnemonic / plain file import: the wallet is ALREADY
   *    persisted (plaintext) by `importWallet`/`importFromFile` before this
   *    screen shows (reached after address selection + nametag).
   * In every case a chosen password is applied via the reviewed-SAFE
   * in-place re-encrypt (`setWalletPassword` from `useSphereContext()`) —
   * NEVER a second `importWallet()`/`Sphere.import()` call, which would be a
   * wallet-loss/lockout hazard (it unconditionally `Sphere.clear()`s
   * existing storage before rebuilding). See the implementation comment
   * for full detail. Omit `password` to skip.
   */
  handleSetPassword: (password?: string) => Promise<void>;

  // Subscription plan-capabilities state (post-finalize provisioning)
  planName: string | null;
  planCreated: boolean;
  handlePlanCapabilitiesContinue: () => Promise<void>;

  // Address selection state (multi-select)
  derivedAddresses: DerivedAddressInfo[];
  selectedKeys: Set<string>;

  // Actions
  handleCreateKeys: () => Promise<void>;
  handleRestoreWallet: () => Promise<void>;
  handleMintNametag: () => Promise<void>;
  handleSkipNametag: () => Promise<void>;
  handleDeriveNewAddress: () => Promise<void>;
  handleContinueWithAddress: () => Promise<void>;
  goToAddressSelection: () => Promise<void>;

  // Multi-select actions
  handleToggleSelect: (key: string) => void;
  handleSelectAll: () => void;
  handleDeselectAll: () => void;

  // File import actions
  handleFileSelect: (file: File) => Promise<void>;
  handleClearFile: () => void;
  handleFileImport: () => Promise<void>;
  handlePasswordSubmit: (password: string) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;

  // Wallet context (kept for component compatibility)
  identity: { address: string; privateKey: string } | null | undefined;
  nametag: string | null | undefined;
  generatedMnemonic: string | null;
}

export interface UseOnboardingFlowOptions {
  /**
   * True when this flow was entered via the UnlockScreen's "forgot password
   * → restore from recovery phrase" lock-escape (#449): a REAL, still-
   * recoverable (locked) wallet sits on disk. In this mode `goToStart()`
   * must never land on the generic StartScreen — its "Create New Wallet"
   * button would call `createWallet()` against storage that still holds the
   * locked wallet, which SDK-level `Sphere.init`/`Sphere.load` cannot open
   * without the password, tripping the create-wallet failure cleanup and
   * wiping it. `onExitToUnlock` is called instead wherever `goToStart()`
   * would otherwise fire.
   */
  fromLock?: boolean;
  /** Called instead of showing the "start" step when `fromLock` is true. */
  onExitToUnlock?: () => void;
}

export function useOnboardingFlow(
  initialStep?: OnboardingStep,
  options?: UseOnboardingFlowOptions,
): UseOnboardingFlowReturn {
  const { fromLock, onExitToUnlock } = options ?? {};
  const queryClient = useQueryClient();
  const { sphere, network, createWallet, resolveNametag, importWallet, importFromFile, finalizeWallet, walletExists, initProgress, setWalletPassword } = useSphereContext();

  // Step management — start at "nametag" only if wallet is fully finalized but missing nametag
  // (e.g. page refresh after wallet creation without nametag).
  // During import flow, walletExists is false (deferred to finalizeWallet) so we always start at "start".
  // `initialStep` (e.g. "restoreMethod") lets a caller drop the user straight
  // into a specific screen — used by the UnlockScreen "forgot password" escape
  // (#449) so it doesn't have to re-click through the start screen.
  const [step, setStep] = useState<OnboardingStep>(
    initialStep ?? (sphere && walletExists && !sphere.identity?.nametag ? "nametag" : "start")
  );

  // Common state
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Block page reload / tab close during wallet creation. "setPassword" is
  // included here too (#449 / #449 follow-up / #449 Task C): by the time any
  // flow reaches it (create, restore-from-mnemonic, or file import), the
  // wallet is ALREADY persisted (plaintext) on disk, and this step's
  // in-place re-encrypt (setWalletPassword) may be about to run or in
  // flight. "mnemonicShow"/"mnemonicConfirm"/"backupDownload" (#449
  // create-flow reorder, create flow only) are also covered: a reload
  // mid-flow would silently drop the user back to onboarding while a real
  // wallet sits on disk — same hazard the original guard was written for.
  const isProcessingActive =
    step === "processing" ||
    step === "mnemonicShow" ||
    step === "mnemonicConfirm" ||
    step === "setPassword" ||
    step === "backupDownload";
  useEffect(() => {
    if (!isProcessingActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isProcessingActive]);

  // Mnemonic restore state
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(""));

  // File import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [, setDetectedFileType] = useState<LegacyFileType>('unknown');
  const [isEncrypted, setIsEncrypted] = useState(false);
  // Holds the imported Sphere instance during the import flow.
  // NOT set in SphereProvider context until finalizeWallet() to avoid premature re-renders.
  const importedSphereRef = useRef<Sphere | null>(null);
  // True when the current flow created a brand-new wallet (vs import/restore).
  const isCreateFlowRef = useRef(false);
  // #449 Task C: true once an encrypted file's decrypt password has already
  // been auto-applied as the wallet's at-rest password (handlePasswordSubmit)
  // — set on a successful `setWalletPassword` there. The "processing
  // complete" auto-transition below checks this to skip the optional
  // `setPassword` screen for a wallet that's already protected. Import/file
  // flow only; always `false` for the create flow and for restore-from-
  // mnemonic (which always shows the optional screen). Reset in `goToStart`.
  const passwordAutoAppliedRef = useRef(false);
  // Create flow only (#449 UX refinement): remembers the password chosen on
  // `setPassword` — which now runs BEFORE the backup screen — purely in
  // memory (never persisted as its own secret) so `handleDownloadBackup`,
  // reached moments later on the backup screen, can reuse the SAME password
  // to encrypt the exported file instead of asking for a second one (the
  // #450 separate backup-file password is gone). `null` means no password
  // was set (skipped, or this is the restore/import flow, which has no
  // backup screen at all).
  const createBackupPasswordRef = useRef<string | null>(null);
  // #449: re-entrancy guard for handleSetPassword. SetPasswordScreen doesn't
  // disable its Set/Skip buttons while busy, so a double-click (or a fast
  // Set-then-Skip) could otherwise fire two overlapping `setWalletPassword()`
  // calls against the same in-flight re-encrypt (read → encrypt → write) of
  // the mnemonic storage key.
  const isPersistingRef = useRef(false);

  // Nametag state
  const [nametagInput, setNametagInput] = useState("");
  const [nametagAvailability, setNametagAvailability] = useState<NametagAvailability>('idle');
  const [processingStatus, setProcessingStatus] = useState("");
  const [processingStep, setProcessingStep] = useState(0);
  const [processingTotalSteps, setProcessingTotalSteps] = useState(3);
  const [processingTitle, setProcessingTitle] = useState("Setting up Profile...");
  const [processingCompleteTitle, setProcessingCompleteTitle] = useState("Profile Ready!");
  const [isProcessingComplete, setIsProcessingComplete] = useState(false);

  // Subscription plan-capabilities state (post-finalize provisioning)
  const [planName, setPlanName] = useState<string | null>(null);
  const [planCreated, setPlanCreated] = useState(false);

  // Debounced nametag availability check with retry on transport failure
  useEffect(() => {
    const cleanTag = nametagInput.trim().replace(/^@/, '');
    if (!cleanTag || cleanTag.length < 2) {
      setNametagAvailability('idle');
      return;
    }

    let cancelled = false;
    setNametagAvailability('checking');

    const timer = setTimeout(async () => {
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          const existing = await resolveNametag(cleanTag);
          if (!cancelled) {
            setNametagAvailability(existing ? 'taken' : 'available');
          }
          return;
        } catch {
          if (attempt < maxAttempts) {
            // Wait before retry — transport may still be connecting
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      }
      // All attempts failed
      if (!cancelled) {
        setNametagAvailability('idle');
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nametagInput, resolveNametag]);

  // Sync SDK progress to processing screen status text
  useEffect(() => {
    if (!initProgress || step !== 'processing') return;
    setProcessingStatus(initProgress.message);
    // Advance step indicator based on SDK progress
    switch (initProgress.step) {
      case 'recovering_nametag':
      case 'syncing_identity':
      case 'registering_nametag':
        setProcessingStep(prev => Math.max(prev, 1));
        break;
      case 'syncing_tokens':
      case 'discovering_addresses':
      case 'finalizing':
      case 'complete':
        setProcessingStep(prev => Math.max(prev, 2));
        break;
    }
  }, [initProgress, step]);

  // Address selection state (multi-select, using composite keys to distinguish receive vs change)
  const [derivedAddresses, setDerivedAddresses] = useState<DerivedAddressInfo[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Generated mnemonic (from create flow)
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);

  // Go back to start screen
  const goToStart = useCallback(() => {
    setSeedWords(Array(12).fill(""));
    setSelectedFile(null);
    setFileContent(null);
    setDetectedFileType('unknown');
    setIsEncrypted(false);
    setIsDragging(false);
    importedSphereRef.current = null;
    isCreateFlowRef.current = false;
    createBackupPasswordRef.current = null;
    passwordAutoAppliedRef.current = false;
    setError(null);
    // #449 no-wallet-loss: entered via the lock-escape → never show the
    // generic StartScreen (its "Create New Wallet" would run against storage
    // that still holds the locked, recoverable wallet). Exit back up to the
    // UnlockScreen instead; the caller (WalletPanel) resets its
    // "restoreFromLock" flag so the lock gate renders UnlockScreen again.
    if (fromLock) {
      onExitToUnlock?.();
      return;
    }
    setStep("start");
  }, [fromLock, onExitToUnlock]);

  // ---- File import handlers ----

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setError(null);

    // Read file content
    // Backups are text (.txt / .json / a bare mnemonic). Bitcoin Core .dat
    // import was removed from the SDK — the wallet is L3-only.
    const content: string = await file.text();
    setFileContent(content);

    // Detect file type and encryption
    const fileType = Sphere.detectLegacyFileType(file.name, content);
    setDetectedFileType(fileType);
    const encrypted = Sphere.isLegacyFileEncrypted(file.name, content);
    setIsEncrypted(encrypted);
  }, []);

  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setFileContent(null);
    setDetectedFileType('unknown');
    setIsEncrypted(false);
    setError(null);
  }, []);

  // Route after successful import: show address selection (if multiple addresses discovered)
  // or go to nametag. SDK's discoverAddresses() already ran during import, so all addresses
  // are already tracked. We just read them and present the selection UI.
  const routeAfterImport = useCallback((importedSphere: Sphere) => {
    importedSphereRef.current = importedSphere;

    // Get all tracked addresses discovered by the SDK during import
    const allAddresses = importedSphere.getAllTrackedAddresses();

    if (allAddresses.length >= 1) {
      // Show address selection so user can review discovered addresses
      const addresses: DerivedAddressInfo[] = allAddresses.map(a => ({
        index: a.index,
        l3Address: a.directAddress,
        chainPubkey: a.chainPubkey,
        path: `m/44'/60'/0'/0/${a.index}`,
        hasNametag: !!a.nametag,
        existingNametag: a.nametag,
        isChange: false,
        balanceLoading: false,
      }));
      setDerivedAddresses(addresses);
      setSelectedKeys(new Set(addresses.map(a => addrKey(a.index, false))));
      setStep("addressSelection");
    } else if (importedSphere.identity?.nametag) {
      setStep("processing");
      setProcessingTitle("Importing Wallet...");
      setProcessingCompleteTitle("Import Complete!");
      setProcessingTotalSteps(3);
      setProcessingStep(2);
      setProcessingStatus("Setup complete!");
      setIsProcessingComplete(true);
    } else {
      setStep("nametag");
    }
  }, []);

  const handleFileImport = useCallback(async () => {
    if (!fileContent || !selectedFile) return;

    // Encrypted file → password prompt
    if (isEncrypted) {
      setStep("passwordPrompt");
      return;
    }

    setIsBusy(true);
    setError(null);

    // Show processing screen during import
    setStep("processing");
    setProcessingTitle("Importing Wallet...");
    setProcessingCompleteTitle("Import Complete!");
    setProcessingStep(0);
    setProcessingTotalSteps(3);
    setProcessingStatus("Importing wallet...");
    setIsProcessingComplete(false);

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
        setStep("importFile");
        return;
      }

      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      }


      if (result.sphere) {
        routeAfterImport(result.sphere);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStep("importFile");
    } finally {
      setIsBusy(false);
    }
  }, [fileContent, selectedFile, isEncrypted, importFromFile, routeAfterImport]);

  const handlePasswordSubmit = useCallback(async (password: string) => {
    if (!fileContent || !selectedFile) return;

    setIsBusy(true);
    setError(null);

    // Show processing screen during import
    setStep("processing");
    setProcessingTitle("Importing Wallet...");
    setProcessingCompleteTitle("Import Complete!");
    setProcessingStep(0);
    setProcessingTotalSteps(3);
    setProcessingStatus("Decrypting and importing wallet...");
    setIsProcessingComplete(false);

    try {
      const result = await importFromFile({
        fileContent,
        fileName: selectedFile.name,
        password,
      });

      if (!result.success) {
        if (result.needsPassword) {
          setError("Incorrect password. Please try again.");
          setStep("passwordPrompt");
          return;
        }
        setError(result.error || "Decryption failed");
        setStep("passwordPrompt");
        return;
      }

      if (result.mnemonic) {
        setGeneratedMnemonic(result.mnemonic);
      }

      if (result.sphere) {
        // #449 Task C: this file needed `password` to DECRYPT it — apply that
        // SAME password as the wallet's new at-rest password automatically.
        // The wallet was just persisted PLAINTEXT regardless of the file's
        // own encryption: `importFromFile`/`Sphere.importFromLegacyFile` only
        // ever uses `password` to decrypt the legacy file's contents — it is
        // never threaded into the new on-disk mnemonic (verified against the
        // SDK: `baseOptions` passed to the internal `Sphere.import()` call
        // strips `password` out in every legacy-format branch). Applied via
        // the SAME reviewed-SAFE in-place re-encrypt as everywhere else
        // (`setWalletPassword`) — never a second `importWallet`/`Sphere.
        // import()` call.
        //
        // Only meaningful when the import actually recovered a MNEMONIC — a
        // master-key-only legacy import (.txt/legacy-JSON with no seed
        // phrase) has none, and `setWalletPassword`/`reencryptStoredMnemonic`
        // throws "No wallet mnemonic found" for that case. Caught and skipped
        // gracefully here (no scary error for an automatic step the user
        // never asked for) — the wallet simply stays plaintext. If there IS
        // a mnemonic, this succeeds and the optional `setPassword` screen
        // shown later (see the "processing complete" auto-transition below)
        // is skipped entirely — the wallet is already protected.
        try {
          await setWalletPassword(password);
          passwordAutoAppliedRef.current = true;
        } catch {
          // No mnemonic to protect (or some other re-encrypt hiccup) — leave
          // the wallet plaintext and fall through to the normal, optional
          // setPassword screen. If there really is no mnemonic, a manual
          // attempt there will (correctly) fail too, but as an ordinary
          // user-initiated error rather than a silent automatic one.
        }
        routeAfterImport(result.sphere);
      } else {
        setStep("nametag");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decryption failed");
      setStep("passwordPrompt");
    } finally {
      setIsBusy(false);
    }
  }, [fileContent, selectedFile, importFromFile, routeAfterImport, setWalletPassword]);

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

    const mnemonic = words.join(" ");

    // #449 no-wallet-loss: validate the mnemonic BEFORE calling importWallet.
    // Sphere.import() clears any existing wallet from storage BEFORE it
    // validates the mnemonic internally — so a wrong/typo'd recovery phrase
    // would otherwise wipe whatever wallet (locked or plaintext) is
    // currently on disk before ever discovering it can't even use the
    // phrase it just destroyed the wallet for. Checking here means an
    // invalid phrase never reaches importWallet: nothing touches storage.
    if (!Sphere.validateMnemonic(mnemonic)) {
      setError("Invalid recovery phrase. Please check the words and try again.");
      return;
    }

    setError(null);
    setIsBusy(true);

    // #449 Task C: import PLAINTEXT immediately — no password threaded into
    // this call anymore. The optional at-rest password is now offered near
    // the END of the flow (after address selection + nametag, same place the
    // create flow offers it), applied via the in-place `setWalletPassword`
    // re-encrypt — never a second `importWallet()`/`Sphere.import()` call.
    // This unifies the restore flow with the create flow and the plain
    // file-import flow: all three route through `routeAfterImport` and the
    // shared "processing complete" auto-transition below.
    setStep("processing");
    setProcessingTitle("Importing Wallet...");
    setProcessingCompleteTitle("Import Complete!");
    setProcessingStep(0);
    setProcessingTotalSteps(3);
    setProcessingStatus("Importing wallet...");
    setIsProcessingComplete(false);

    try {
      const instance = await importWallet(mnemonic);
      routeAfterImport(instance);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid recovery phrase";
      setError(message);
      setStep("restore");
    } finally {
      setIsBusy(false);
    }
  }, [seedWords, importWallet, routeAfterImport]);

  // Action: Create wallet WITH nametag (or register nametag on imported wallet)
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);

    const cleanTag = nametagInput.trim().replace("@", "");

    setStep("processing");
    setProcessingTitle("Setting up Profile...");
    setProcessingCompleteTitle("Profile Ready!");
    setProcessingStep(0);
    setProcessingTotalSteps(3);
    setProcessingStatus("Checking Unicity ID availability...");
    setIsProcessingComplete(false);

    try {
      // Step 1: Check nametag availability via Nostr (no wallet needed)
      const existing = await resolveNametag(cleanTag);
      if (existing) {
        setError(`@${cleanTag} is already taken`);
        setStep("nametag");
        setIsBusy(false);
        return;
      }

      setProcessingStep(1);

      const activeSphere = importedSphereRef.current ?? sphere;
      if (activeSphere) {
        // Import flow — wallet already exists (in ref), just register nametag
        setProcessingStatus("Registering Unicity ID...");
        await activeSphere.registerNametag(cleanTag);
          setProcessingStep(2);
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
      } else {
        // Create flow — create the wallet WITHOUT a nametag first (no Nostr
        // binding is published, so a failure here can safely wipe storage), then
        // register the nametag as a separate step. A registration failure never
        // re-runs createWallet and never wipes the wallet, so the key survives
        // and the nametag can't be burned (#448).
        setProcessingStatus("Creating wallet...");
        await createWalletThenRegister({
          createWallet,
          nametag: cleanTag,
          onWalletCreated: (result) => {
            setGeneratedMnemonic(result.mnemonic);
            importedSphereRef.current = result.sphere;
            isCreateFlowRef.current = true;
            setProcessingStatus("Registering Unicity ID...");
          },
        });
        setProcessingStep(2);
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
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
      setProcessingTitle("Setting up Profile...");
      setProcessingCompleteTitle("Profile Ready!");
      setProcessingStep(0);
      setIsProcessingComplete(false);

      if (importedSphereRef.current ?? sphere) {
        // Import flow — wallet already exists (in ref), just finalize
        setProcessingTotalSteps(1);
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
        } else {
        // Create flow — create wallet without nametag
        setProcessingTotalSteps(2);
        setProcessingStatus("Creating wallet...");
        const result = await createWallet();
        setGeneratedMnemonic(result.mnemonic);
        importedSphereRef.current = result.sphere;
        isCreateFlowRef.current = true;
          setProcessingStep(1);
        setProcessingStatus("Setup complete!");
        setIsProcessingComplete(true);
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

  // Finalize wallet and switch to wallet UI
  const finishFinalize = useCallback(() => {
    finalizeWallet(importedSphereRef.current ?? undefined);
    importedSphereRef.current = null;
    isCreateFlowRef.current = false;
    queryClient.removeQueries({ queryKey: SPHERE_KEYS.all });
    window.dispatchEvent(new Event("wallet-loaded"));
    window.dispatchEvent(new Event("wallet-updated"));
    setStep("start");
  }, [queryClient, finalizeWallet]);

  // Provision/recover the subscription key, then show capabilities. On any
  // failure (or flag off) fall through to finalize with the env-key fallback.
  const doFinalizeWallet = useCallback(async () => {
    const active = importedSphereRef.current ?? sphere;
    if (SUBSCRIPTION_ENABLED && active) {
      try {
        // Bound provisioning: a slow/blackholed SGW must not hang wallet
        // creation. On timeout we fall through to the env-key fallback exactly
        // like a provisioning error would.
        const result = await Promise.race([
          provisionOrRecoverKey(active),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('subscription provisioning timed out')), PROVISION_TIMEOUT_MS),
          ),
        ]);
        // Persist ONLY — do NOT re-init here. Re-initializing now (like
        // applySubscriptionKey does) would flip walletExists to true and
        // unmount CreateWalletFlow before the capabilities screen renders.
        // The stored key becomes the ACTIVE oracle key when finalizeWallet()
        // re-inits on wallet entry (SphereProvider) — which happens before any
        // send. With subscriptions on the env key is NOT a fallback
        // (oracleKey.ts ignores it), so until that re-init the oracle carries no
        // key; that's fine because the send gate blocks sends until it lands and
        // no L3 send happens on the onboarding screens anyway.
        setStoredSubscriptionKey(result.apiKey);
        // Durable per-identity copy; non-fatal if it fails (cache still set).
        await saveWalletKey(active, network, result.apiKey).catch(() => {});
        // Nothing to decide, two ways. A restored wallet whose key is already on
        // a PAID plan has bought past the line-up. And where this network's
        // gateway sells nothing there is no line-up at all: the screen
        // degenerates to one "Enter Wallet" button over a card nothing can be
        // done with. Walk both straight into the wallet.
        //
        // The CATALOGUE decides, not the network: a test network that does price
        // plans should offer them, and a real one that prices none should not.
        // The read is capped hard and fails open, so entering the wallet never
        // waits on the store for longer than a blink.
        //
        // Note what is NOT skipped: everything above this line still runs. With
        // subscriptions on, the env aggregator key is not a fallback
        // (oracleKey.ts), so a wallet that entered without provisioning its own
        // key could not send at all.
        if (!isFreePlanName(result.plan) || !(await catalogueHasOffers())) {
          finishFinalize();
          return;
        }
        setPlanName(result.plan);
        setPlanCreated(result.created);
        setStep("planCapabilities");
        return;
      } catch (err) {
        // Non-fatal: keep onboarding working on the env-key fallback.
        console.warn('subscription provisioning failed; using fallback key', err);
      }
    }
    finishFinalize();
  }, [sphere, network, finishFinalize]);

  // Auto-transition when processing completes.
  //  - Create flow ordering (#449 reorder): show -> confirm -> setPassword ->
  //    backupDownload -> finalize. The mnemonic must be SHOWN and re-entry
  //    VERIFIED before the optional password step, so the one password
  //    chosen there can still encrypt the backup-download file shown right
  //    after it (see handleSetPassword / handleDownloadBackup).
  //  - Restore/import flow (#449 Task C): no mnemonic show/confirm/backup
  //    screens — straight to the SAME optional `setPassword` screen the
  //    create flow uses, UNLESS an encrypted file's password was already
  //    auto-applied (handlePasswordSubmit), in which case the wallet is
  //    already protected and there's nothing to ask.
  useEffect(() => {
    if (isProcessingComplete && step === "processing") {
      const timer = setTimeout(() => {
        if (isCreateFlowRef.current && generatedMnemonic) {
          setStep("mnemonicShow");
        } else if (!isCreateFlowRef.current && !passwordAutoAppliedRef.current) {
          setStep("setPassword");
        } else {
          void doFinalizeWallet();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isProcessingComplete, generatedMnemonic, step, doFinalizeWallet]);

  // Legacy handler kept for interface compatibility (no longer shows "Let's Go")
  const handleCompleteOnboarding = useCallback(async () => {
    void doFinalizeWallet();
  }, [doFinalizeWallet]);

  // Action: advance from the mnemonic SHOW step to the mnemonic CONFIRM step
  // (#449 create-flow reorder: processing → mnemonicShow → mnemonicConfirm →
  // setPassword → backupDownload → planCapabilities → wallet).
  const handleMnemonicShowContinue = useCallback(() => {
    setError(null);
    setStep("mnemonicConfirm");
  }, []);

  // Action: verify the re-entered recovery phrase (#449 real backup
  // verification). Both sides are normalized — trimmed, internal whitespace
  // collapsed to single spaces, lowercased — before comparison, so stray
  // spacing/casing from the textarea doesn't cause a false mismatch. Only an
  // EXACT match (post-normalization) advances to the optional password step;
  // a mismatch surfaces an inline error and does NOT advance, so a user who
  // mistyped (or never actually wrote the phrase down) can't proceed
  // believing they have a working backup.
  const handleConfirmMnemonic = useCallback((entered: string) => {
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    if (!generatedMnemonic || normalize(entered) !== normalize(generatedMnemonic)) {
      setError("Recovery phrase doesn't match. Please check the words and try again.");
      return;
    }
    setError(null);
    setStep("setPassword");
  }, [generatedMnemonic]);

  // Action: back out of the CONFIRM step to re-view the phrase on SHOW.
  const handleMnemonicConfirmBack = useCallback(() => {
    setError(null);
    setStep("mnemonicShow");
  }, []);

  // Action: finalize after the backup-download step (the LAST create-flow
  // step — setPassword already ran right before it).
  const handleBackupDownloadComplete = useCallback(() => {
    void doFinalizeWallet();
  }, [doFinalizeWallet]);

  // Action: Set/Skip handler for SetPasswordScreen (#449 / #449 follow-up /
  // #449 Task C). Reached from THREE places, all handled the SAME way now:
  //
  //  1. Create flow (handleSkipNametag/handleMintNametag's processing
  //     auto-transition above, via mnemonicShow -> mnemonicConfirm -> here).
  //     Ordering: processing → mnemonicShow → mnemonicConfirm → setPassword
  //     → backupDownload → planCapabilities → wallet. The wallet was ALREADY
  //     persisted (plaintext) moments earlier by createWallet()/
  //     createWalletThenRegister() (#448's create-without-nametag step).
  //
  //  2. Restore-from-mnemonic (handleRestoreWallet) and plain file import
  //     (handleFileImport/handlePasswordSubmit), reached via the "processing
  //     complete" auto-transition after address selection + nametag. The
  //     wallet was ALREADY persisted (plaintext) by importWallet()/
  //     importFromFile() before this screen ever shows.
  //
  // In every case there is a real wallet on disk (with a token DB, etc.) by
  // the time this runs. A SECOND `importWallet()`/`Sphere.import()` call
  // here (re-creating that same wallet from its own mnemonic WITH the chosen
  // password) was the #449 CRITICAL wallet-loss bug: `Sphere.import()`
  // unconditionally `Sphere.clear()`s any already-persisted wallet before
  // rebuilding it. If that rebuild then threw (a network hiccup during
  // identity/nametag sync, etc.), storage was left cleared while the app
  // kept using the in-memory instance for the rest of the session — on next
  // reload the wallet could show unexpectedly LOCKED or vanish entirely. It
  // could also race a just-published Nostr nametag binding, risking
  // permanently burning it.
  //
  // Instead, a chosen password is ALWAYS applied via `setWalletPassword`
  // (from `useSphereContext()`) — the same reviewed-SAFE in-place mnemonic
  // re-encrypt built for Settings → Security: read mnemonic → encrypt →
  // write back to the MNEMONIC key ONLY, with read-back verify and
  // restore-on-failure. `Sphere.import`/`Sphere.clear` are never called; the
  // token DB and everything else already on disk are untouched. On success
  // the password is also remembered in `createBackupPasswordRef`
  // (memory-only) so the create flow's backup screen right after this one
  // can encrypt the exported file with the SAME password — see
  // handleDownloadBackup (a no-op for the restore/import flows, which have
  // no backup-download screen). On failure, `setWalletPassword` is itself
  // self-restoring (leaves the existing plaintext mnemonic intact), so the
  // wallet is never at risk — but unlike Skip, a rejection here does NOT
  // advance: it surfaces the error on this screen and lets the user retry or
  // explicitly Skip, rather than silently landing them in a wallet they
  // believe is password-protected while it's still plaintext (#449 review
  // fix).
  //
  // After applying (or skipping) the password: the create flow advances to
  // the backup-download screen; the restore/import flows have no such
  // screen and finalize directly.
  const handleSetPassword = useCallback(async (password?: string) => {
    // Re-entrancy guard: a double-click on "Set Password", or a fast
    // Set-then-Skip, must not fire two overlapping setWalletPassword()
    // calls (reencryptStoredMnemonic's read → encrypt → write cycle is not
    // safe to run concurrently against the same storage key).
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      if (password) {
        try {
          await setWalletPassword(password);
        } catch (e) {
          // Self-restoring on failure (see doc-comment above) — the
          // wallet is never at risk. Surface the failure and stay on this
          // screen (do NOT advance) so the user can retry or explicitly
          // Skip.
          const message = e instanceof Error ? e.message : "Failed to set a wallet password";
          setError(message);
          return;
        }
        // Remembered ONLY in memory — never persisted as its own secret —
        // so handleDownloadBackup (create flow only) can encrypt the backup
        // file with this SAME password.
        createBackupPasswordRef.current = password;
      } else {
        createBackupPasswordRef.current = null;
      }
      if (isCreateFlowRef.current) {
        setStep("backupDownload");
      } else {
        // Restore/import flow: no backup-download screen — finalize directly.
        void doFinalizeWallet();
      }
    } finally {
      isPersistingRef.current = false;
      setIsBusy(false);
    }
  }, [setWalletPassword, doFinalizeWallet]);

  // Action: Continue from the plan-capabilities screen into the wallet.
  //
  // A plan bought ON that screen (sphere#496) normally comes back as an
  // in-place upgrade of the key we just provisioned — same key string, nothing
  // to persist. But when the gateway mints a FRESH key instead (pre-upgrade
  // gateway, or the user's "buy a new key instead"), PlanScreen's
  // applySubscriptionKey can only reach the boot cache in the restore/import
  // flow: SphereProvider defers setSphere() to finalizeWallet, so the context
  // instance the vault write needs isn't there yet. Mirror the cached key into
  // the vault with the instance we DO hold, and await it — finishFinalize()
  // immediately triggers setupSubscriptionKey → resolveActiveKey, which reads
  // the vault and would otherwise restore the older free key.
  const handlePlanCapabilitiesContinue = useCallback(async () => {
    const active = importedSphereRef.current ?? sphere;
    const key = getStoredSubscriptionKey();
    if (SUBSCRIPTION_ENABLED && active && key) {
      setIsBusy(true);
      // Best-effort: the boot cache already carries the key, so a failed vault
      // write must not strand the user on the onboarding screen.
      await saveWalletKey(active, network, key).catch(() => {});
      setIsBusy(false);
    }
    finishFinalize();
  }, [sphere, network, finishFinalize]);

  // Action: Download wallet backup file. Reuses the SAME password chosen
  // moments earlier on the setPassword step (createBackupPasswordRef) to
  // encrypt the file (like the in-wallet "Save Wallet") — `undefined` when
  // that step was skipped, producing a plaintext export. The separate #450
  // backup-file password input is gone; the filename never leaks the handle.
  const handleDownloadBackup = useCallback(async () => {
    const activeSphere = importedSphereRef.current ?? sphere;
    if (!activeSphere) return;
    const password = createBackupPasswordRef.current ?? undefined;
    const { fileName, json } = buildWalletBackup(activeSphere, password);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [sphere]);

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
          l3Address: '', // Will be populated after switching
          path: addr.path,
          hasNametag: false,
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
          l3Address: '',
          path: addr.path,
          hasNametag: false,
          balanceLoading: false,
        }));

        setDerivedAddresses(results);
        setSelectedKeys(new Set(
          results.filter(a => !a.isChange).map(a => addrKey(a.index, false))
        ));
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

  // Action: Continue with selected addresses (multi-select)
  const handleContinueWithAddress = useCallback(async () => {
    const activeSphere = importedSphereRef.current ?? sphere;
    if (!activeSphere || selectedKeys.size === 0) return;
    setIsBusy(true);
    setError(null);

    try {
      // Bulk track non-change addresses with visibility (SDK only tracks receive addresses)
      const entries = derivedAddresses
        .filter(a => !a.isChange)
        .map(a => ({
          index: a.index,
          hidden: !selectedKeys.has(addrKey(a.index, false)),
          nametag: a.existingNametag,
        }));
      await activeSphere.trackScannedAddresses(entries);

      // Auto-select active address: first selected with nametag, or first selected
      const selectedAddrs = derivedAddresses.filter(
        a => !a.isChange && selectedKeys.has(addrKey(a.index, false))
      );
      const activeAddr = selectedAddrs.find(a => a.hasNametag) ?? selectedAddrs[0];
      if (activeAddr) {
        await activeSphere.switchToAddress(activeAddr.index);
      }

      // Route based on nametag
      if (activeSphere.identity?.nametag) {
        setStep("processing");
        setProcessingTitle("Importing Wallet...");
        setProcessingCompleteTitle("Import Complete!");
        setProcessingTotalSteps(3);
        setProcessingStep(2);
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
  }, [derivedAddresses, selectedKeys, sphere]);

  // ---- Multi-select handlers ----

  const handleToggleSelect = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedKeys(new Set(
      derivedAddresses.filter(a => !a.isChange).map(a => addrKey(a.index, false))
    ));
  }, [derivedAddresses]);

  const handleDeselectAll = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

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
    isDragging,

    // Nametag state
    nametagInput,
    setNametagInput,
    nametagAvailability,
    processingStatus,
    processingStep,
    processingTotalSteps,
    processingTitle,
    processingCompleteTitle,
    isProcessingComplete,
    handleCompleteOnboarding,
    handleMnemonicShowContinue,
    handleConfirmMnemonic,
    handleMnemonicConfirmBack,
    handleBackupDownloadComplete,
    handleDownloadBackup,
    backupEncrypted: createBackupPasswordRef.current !== null,
    handleSetPassword,

    // Subscription plan-capabilities state (post-finalize provisioning)
    planName,
    planCreated,
    handlePlanCapabilitiesContinue,

    // Address selection state (multi-select)
    derivedAddresses,
    selectedKeys,

    // Actions
    handleCreateKeys,
    handleRestoreWallet,
    handleMintNametag,
    handleSkipNametag,
    handleDeriveNewAddress,
    handleContinueWithAddress,
    goToAddressSelection,

    // Multi-select actions
    handleToggleSelect,
    handleSelectAll,
    handleDeselectAll,

    // File import actions
    handleFileSelect,
    handleClearFile,
    handleFileImport,
    handlePasswordSubmit,
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
