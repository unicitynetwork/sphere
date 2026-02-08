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
            onSelectFile={() => setStep("restore")}
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

        {step === "processing" && (
          <ProcessingScreen
            status={processingStatus}
            isComplete={isProcessingComplete}
            onComplete={handleCompleteOnboarding}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
