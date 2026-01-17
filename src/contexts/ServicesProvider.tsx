import React, { useEffect, useState, useRef, type ReactNode } from 'react';
import { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import { NostrService } from '../components/wallet/L3/services/NostrService';
import { InventoryBackgroundLoopsManager } from '../components/wallet/L3/services/InventoryBackgroundLoops';
import { ServicesContext } from './ServicesContext';

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isNostrConnected, setIsNostrConnected] = useState(false);
  const [loopsManager, setLoopsManager] = useState<InventoryBackgroundLoopsManager | null>(null);

  // Create singleton instances once
  const identityManager = IdentityManager.getInstance();
  const nostrService = NostrService.getInstance(identityManager);

  // Track initialization state to prevent double-init
  const loopsInitialized = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const initializeServices = async () => {
      try {
        // Check if user has identity before starting services
        const identity = await identityManager.getCurrentIdentity();
        if (!identity) {
          console.log("🔕 No identity found. Services on standby.");
          return;
        }

        // Initialize background loops (for token receive batching and delivery queue)
        if (!loopsInitialized.current) {
          console.log("⚡ Initializing background loops from ServicesProvider...");
          const manager = InventoryBackgroundLoopsManager.getInstance(identityManager);
          await manager.initialize();

          // Wire up NostrService to the delivery queue
          const deliveryQueue = manager.getDeliveryQueue();
          deliveryQueue.setNostrService(nostrService);

          if (isMounted) {
            setLoopsManager(manager);
            loopsInitialized.current = true;
            console.log("✅ Background loops initialized and wired to NostrService");
          }
        }

        // Start Nostr service
        console.log("🚀 Starting Nostr service from ServicesProvider...");
        await nostrService.start();

        if (isMounted) {
          setIsNostrConnected(true);
          console.log("✅ Nostr service connected");
        }
      } catch (error) {
        console.error("❌ Failed to initialize services:", error);
      }
    };

    // Initialize on mount
    initializeServices();

    // Re-initialize when wallet is created/restored
    const handleWalletLoaded = async () => {
      console.log("📢 Wallet loaded, resetting and reinitializing services...");

      // Shutdown existing loops manager
      if (loopsInitialized.current) {
        InventoryBackgroundLoopsManager.resetInstance();
        loopsInitialized.current = false;
        setLoopsManager(null);
      }

      // Reset Nostr to use new identity's keypair
      await nostrService.reset();
      setIsNostrConnected(false);

      // Re-initialize all services
      initializeServices();
    };

    window.addEventListener('wallet-loaded', handleWalletLoaded);

    return () => {
      isMounted = false;
      window.removeEventListener('wallet-loaded', handleWalletLoaded);

      // Shutdown background loops on unmount
      if (loopsInitialized.current) {
        console.log("🛑 ServicesProvider cleanup - shutting down background loops");
        InventoryBackgroundLoopsManager.resetInstance();
        loopsInitialized.current = false;
      }

      console.log("🛑 ServicesProvider cleanup complete");
    };
  }, [identityManager, nostrService]);

  return (
    <ServicesContext.Provider value={{ identityManager, nostrService, isNostrConnected, loopsManager }}>
      {children}
    </ServicesContext.Provider>
  );
};
