import React, { useEffect, useState, useRef, type ReactNode } from 'react';
import { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import { NostrService } from '../components/wallet/L3/services/NostrService';
import { InventoryBackgroundLoopsManager } from '../components/wallet/L3/services/InventoryBackgroundLoops';
import { OutboxRecoveryService } from '../components/wallet/L3/services/OutboxRecoveryService';
import { GroupChatService } from '../components/chat/services/GroupChatService';
import { ServicesContext } from './ServicesContext';

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isNostrConnected, setIsNostrConnected] = useState(false);
  const [loopsManager, setLoopsManager] = useState<InventoryBackgroundLoopsManager | null>(null);
  const [isGroupChatConnected, setIsGroupChatConnected] = useState(false);

  // Create singleton instances once
  const identityManager = IdentityManager.getInstance();
  const nostrService = NostrService.getInstance(identityManager);
  const groupChatService = GroupChatService.getInstance(identityManager);

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
        // CRITICAL: Must initialize BEFORE NostrService can receive tokens
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

        // Start Nostr service (for DMs and token transfers)
        console.log("🚀 Starting Nostr service from ServicesProvider...");
        await nostrService.start();

        if (isMounted) {
          setIsNostrConnected(true);
          console.log("✅ Nostr service connected");

          // Initialize OutboxRecoveryService (centralized, single lifecycle)
          const recoveryService = OutboxRecoveryService.getInstance();
          recoveryService.setIdentityManager(identityManager);

          // Run initial recovery
          const pendingCount = recoveryService.getPendingCount(identity.address);
          if (pendingCount > 0) {
            console.log(`📤 ServicesProvider: Found ${pendingCount} pending outbox entries, starting recovery...`);
            const result = await recoveryService.recoverPendingTransfers(identity.address, nostrService);
            console.log(`📤 ServicesProvider: Initial recovery - ${result.recovered} recovered, ${result.failed} failed`);
          }

          // Start periodic retry (once, centralized)
          recoveryService.startPeriodicRetry(identity.address, nostrService);
        }

        // GroupChatService starts lazily when user opens group chat
      } catch (error) {
        console.error("❌ Failed to initialize services:", error);
      }
    };

    // Initialize on mount
    initializeServices();

    // Re-initialize when wallet is created/restored
    const handleWalletLoaded = async () => {
      console.log("📢 Wallet loaded, resetting and reinitializing services...");

      // Stop OutboxRecoveryService (will be restarted with new identity)
      OutboxRecoveryService.getInstance().stopPeriodicRetry();

      // Shutdown existing loops manager
      if (loopsInitialized.current) {
        InventoryBackgroundLoopsManager.resetInstance();
        loopsInitialized.current = false;
        setLoopsManager(null);
      }

      // Reset services to use new identity's keypair
      await nostrService.reset();
      await groupChatService.reset();
      setIsNostrConnected(false);
      setIsGroupChatConnected(false);

      // Re-initialize all services
      initializeServices();
    };

    window.addEventListener('wallet-loaded', handleWalletLoaded);

    return () => {
      isMounted = false;
      window.removeEventListener('wallet-loaded', handleWalletLoaded);

      // Stop OutboxRecoveryService
      OutboxRecoveryService.getInstance().stopPeriodicRetry();

      // Shutdown background loops on unmount
      if (loopsInitialized.current) {
        console.log("🛑 ServicesProvider cleanup - shutting down background loops");
        InventoryBackgroundLoopsManager.resetInstance();
        loopsInitialized.current = false;
      }

      console.log("🛑 ServicesProvider cleanup complete");
    };
  }, [identityManager, nostrService, groupChatService]);

  return (
    <ServicesContext.Provider
      value={{
        identityManager,
        nostrService,
        isNostrConnected,
        loopsManager,
        groupChatService,
        isGroupChatConnected,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
};
