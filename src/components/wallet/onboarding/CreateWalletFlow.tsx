/**
 * CreateWalletFlow - Main onboarding flow component
 * Uses extracted hooks for state management and screen components for UI
 */
import { AnimatePresence } from "framer-motion";
import { useOnboardingFlow } from "./hooks/useOnboardingFlow";
import { useWalletImport } from "./hooks/useWalletImport";
import { WalletScanModal } from "../L1/components/modals/WalletScanModal";
import { LoadPasswordModal } from "../L1/components/modals/LoadPasswordModal";

// Import screen components
import {
  StartScreen,
  RestoreScreen,
  RestoreMethodScreen,
  ImportFileScreen,
  AddressSelectionScreen,
  NametagScreen,
  ProcessingScreen,
} from "./components";

export type { OnboardingStep } from "./hooks/useOnboardingFlow";

export function CreateWalletFlow() {
  // Main onboarding flow hook
  const {
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

    // Nametag state
    nametagInput,
    setNametagInput,
    processingStatus,

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
  } = useOnboardingFlow();

  // File import hook
  const walletImport = useWalletImport({
    getUnifiedKeyManager,
    goToAddressSelection,
    setError,
    setIsBusy,
  });

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
            selectedFile={walletImport.selectedFile}
            scanCount={walletImport.scanCount}
            needsScanning={walletImport.needsScanning}
            isDragging={walletImport.isDragging}
            isBusy={isBusy}
            error={error}
            onFileSelect={walletImport.handleFileSelect}
            onClearFile={() => walletImport.setSelectedFile(null)}
            onScanCountChange={walletImport.setScanCount}
            onDragOver={walletImport.handleDragOver}
            onDragLeave={walletImport.handleDragLeave}
            onDrop={walletImport.handleDrop}
            onImport={walletImport.handleConfirmImport}
            onBack={() => {
              walletImport.setSelectedFile(null);
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
        show={walletImport.showLoadPasswordModal}
        onConfirm={walletImport.onConfirmLoadWithPassword}
        onCancel={() => {
          walletImport.setShowLoadPasswordModal(false);
          walletImport.setSelectedFile(null);
        }}
      />

      {/* Wallet Scan Modal for .dat and BIP32 .txt files */}
      <WalletScanModal
        show={walletImport.showScanModal}
        wallet={walletImport.pendingWallet}
        initialScanCount={walletImport.initialScanCount}
        onSelectAddress={walletImport.onSelectScannedAddress}
        onSelectAll={walletImport.onSelectAllScannedAddresses}
        onCancel={walletImport.onCancelScan}
      />
    </div>
  );
}
