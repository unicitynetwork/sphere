import React, { useEffect, useState, type ReactNode } from 'react';
import { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import { NostrService } from '../components/wallet/L3/services/NostrService';
import { ServicesContext } from './ServicesContext';

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isNostrConnected, setIsNostrConnected] = useState(false);

  // Create singleton instances once
  const identityManager = IdentityManager.getInstance();
  const nostrService = NostrService.getInstance(identityManager);

  useEffect(() => {
    let isMounted = true;

    const initializeNostr = async () => {
      try {
        // Check if user has identity before starting Nostr
        const identity = await identityManager.getCurrentIdentity();
        if (!identity) {
          console.log("🔕 No identity found. Nostr service on standby.");
          return;
        }

        console.log("🚀 Starting Nostr service from ServicesProvider...");
        await nostrService.start();

        if (isMounted) {
          setIsNostrConnected(true);
          console.log("✅ Nostr service connected");
        }
      } catch (error) {
        console.error("❌ Failed to start Nostr service:", error);
      }
    };

    // Initialize on mount
    initializeNostr();

    // Re-initialize when wallet is created/restored
    const handleWalletLoaded = () => {
      console.log("📢 Wallet loaded, initializing Nostr...");
      initializeNostr();
    };

    window.addEventListener('wallet-loaded', handleWalletLoaded);

    return () => {
      isMounted = false;
      window.removeEventListener('wallet-loaded', handleWalletLoaded);
      console.log("🛑 ServicesProvider cleanup");
    };
  }, [identityManager, nostrService]);

  return (
    <ServicesContext.Provider value={{ identityManager, nostrService, isNostrConnected }}>
      {children}
    </ServicesContext.Provider>
  );
};
