import { type ReactNode, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useWallet } from "../wallet/L3/hooks/useWallet";
import { CreateWalletFlow } from "../wallet/onboarding/CreateWalletFlow";
import { NostrPinPublisher } from "../wallet/L3/services/NostrPinPublisher";
import { NOSTR_PIN_CONFIG } from "../../config/nostrPin.config";
import { STORAGE_KEYS } from "../../config/storageKeys";

interface WalletGateProps {
  children: ReactNode;
}

function AnimatedBackground() {
  return (
    <>
      <motion.div
        className="absolute top-1/4 right-1/4 w-64 h-64 bg-orange-500/20 rounded-full blur-3xl pointer-events-none"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl pointer-events-none"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
    </>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 flex items-center justify-center relative overflow-hidden">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center relative z-10"
      >
        <div className="relative mx-auto w-20 h-20 mb-6">
          <div className="absolute inset-0 border-4 border-neutral-800 rounded-full" />
          <div className="absolute inset-0 border-4 border-orange-500 rounded-full border-t-transparent animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        </div>
        <p className="text-neutral-400">Loading wallet...</p>
      </motion.div>
    </div>
  );
}

function OnboardingScreen() {
  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-100 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 flex items-center justify-center relative overflow-hidden">
      <AnimatedBackground />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <CreateWalletFlow />
      </motion.div>
    </div>
  );
}

export function WalletGate({ children }: WalletGateProps) {
  const { identity, nametag, isLoadingIdentity, isLoadingNametag } = useWallet();

  // Track onboarding state - show onboarding screen until user clicks "Let's Go"
  const [isOnboarding, setIsOnboarding] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS) === 'true';
  });

  // Listen for onboarding completion (when user clicks "Let's Go")
  useEffect(() => {
    const checkOnboardingFlag = () => {
      const flag = localStorage.getItem(STORAGE_KEYS.ONBOARDING_IN_PROGRESS);
      setIsOnboarding(flag === 'true');
    };

    // Check on wallet-updated event (fired when onboarding completes)
    window.addEventListener('wallet-updated', checkOnboardingFlag);
    window.addEventListener('storage', checkOnboardingFlag);

    return () => {
      window.removeEventListener('wallet-updated', checkOnboardingFlag);
      window.removeEventListener('storage', checkOnboardingFlag);
    };
  }, []);

  const isLoading = isLoadingIdentity || (!!identity && isLoadingNametag);
  const isAuthenticated = !!identity && !!nametag && !isOnboarding;

  // Start NostrPinPublisher when authenticated
  // This enables automatic CID announcements to Nostr for pinning
  useEffect(() => {
    if (isAuthenticated && NOSTR_PIN_CONFIG.enabled) {
      const publisher = NostrPinPublisher.getInstance();
      publisher.start().catch((err) => {
        console.error("Failed to start NostrPinPublisher:", err);
      });

      return () => {
        publisher.stop();
      };
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <OnboardingScreen />;
  }

  return <>{children}</>;
}
