import { ReactNode } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useWallet } from "../wallet/L3/hooks/useWallet";
import { CreateWalletFlow } from "../wallet/L3/onboarding/CreateWalletFlow";

interface WalletGateProps {
  children: ReactNode;
}

function AnimatedBackground() {
  return (
    <>
      {/* Animated orbs - centered with transform to prevent clipping */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-96 md:h-96 bg-orange-500/20 rounded-full blur-2xl md:blur-3xl will-change-transform"
        style={{ animation: "pulse-slow 4s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-1/3 left-1/2 -translate-x-1/2 translate-y-1/2 w-64 h-64 md:w-96 md:h-96 bg-purple-500/20 rounded-full blur-2xl md:blur-3xl will-change-transform"
        style={{ animation: "pulse-slow 5s ease-in-out infinite 1s" }}
      />

      {/* Mesh gradient overlay */}
      <div
        className="absolute inset-0 opacity-20 md:opacity-30 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(at 20% 30%, rgba(251, 146, 60, 0.15) 0px, transparent 50%),
            radial-gradient(at 80% 70%, rgba(168, 85, 247, 0.15) 0px, transparent 50%)
          `,
        }}
      />

      {/* CSS animation */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.15); opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) {
          .will-change-transform {
            animation: none !important;
          }
        }
      `}</style>
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
    <div className="min-h-screen bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 flex items-center justify-center relative overflow-hidden">
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

  const isLoading = isLoadingIdentity || (!!identity && isLoadingNametag);
  const isAuthenticated = !!identity && !!nametag;

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <OnboardingScreen />;
  }

  return <>{children}</>;
}
