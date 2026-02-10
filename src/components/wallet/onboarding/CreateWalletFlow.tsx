/**
 * CreateWalletFlow - Main onboarding flow component
 * Uses extracted hooks for state management and screen components for UI
 */
import { AnimatePresence } from "framer-motion";
import { useOnboardingFlow } from "./hooks/useOnboardingFlow";

// Import screen components
import {
  StartScreen,
  RestoreScreen,
  RestoreMethodScreen,
  ImportFileScreen,
  PasswordPromptScreen,
  ScanningScreen,
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
    isCheckingIpns,
    ipnsFetchingNametag,
    setSelectedAddressPath,
    setShowAddressDropdown,

    // Actions
    handleCreateKeys,
    handleRestoreWallet,
    handleMintNametag,
    handleSkipNametag,
    handleDeriveNewAddress,
    handleContinueWithAddress,

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
    identity,
    nametag,
  } = useOnboardingFlow();

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
            onClearFile={handleClearFile}
            onScanCountChange={handleScanCountChange}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onImport={handleFileImport}
            onBack={() => setStep("restoreMethod")}
          />
        )}

        {step === "passwordPrompt" && (
          <PasswordPromptScreen
            fileName={selectedFile?.name || ""}
            isBusy={isBusy}
            error={error}
            onSubmit={handlePasswordSubmit}
            onBack={() => setStep("importFile")}
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
            availability={nametagAvailability}
            onNametagChange={setNametagInput}
            onSubmit={handleMintNametag}
            onSkip={handleSkipNametag}
            onBack={goToStart}
          />
        )}

        {step === "processing" && (
          <ProcessingScreen
            status={processingStatus}
            isComplete={isProcessingComplete}
            onComplete={handleCompleteOnboarding}
          />
        )}
      </AnimatePresence>

      {/* Scan modal rendered outside AnimatePresence to avoid step-transition issues */}
      <ScanningScreen
        open={showScanModal}
        progress={scanProgress}
        onCancel={handleCancelScan}
      />
    </div>
  );
}
