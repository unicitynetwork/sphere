import React, { useEffect, useState, type ReactNode } from 'react';
import { NostrKeyManager } from '@unicitylabs/nostr-js-sdk';
import { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import { NostrService } from '../components/wallet/L3/services/NostrService';
import { GroupChatService } from '../components/chat/services/GroupChatService';
import { ServicesContext } from './ServicesContext';

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isNostrConnected, setIsNostrConnected] = useState(false);
  const [isGroupChatConnected, setIsGroupChatConnected] = useState(false);

  // Create singleton instances once
  const identityManager = IdentityManager.getInstance();
  const nostrService = NostrService.getInstance(identityManager);
  const groupChatService = GroupChatService.getInstance(identityManager);

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

        const nostrKeyManager = NostrKeyManager.fromPrivateKey(Buffer.from(identity.privateKey, 'hex'));
        console.log("🔑 Nostr pubkey:", nostrKeyManager.getPublicKeyHex());

        // Start Nostr service (for DMs and token transfers)
        await nostrService.start();

        if (isMounted) {
          setIsNostrConnected(true);
        }

        // GroupChatService starts lazily when user opens group chat
      } catch (error) {
        console.error("❌ Failed to start services:", error);
      }
    };

    // Initialize on mount
    initializeServices();

    // Re-initialize when wallet is created/restored
    const handleWalletLoaded = async () => {
      // Reset services to use new identity's keypair
      await nostrService.reset();
      await groupChatService.reset();
      setIsNostrConnected(false);
      setIsGroupChatConnected(false);
      initializeServices();
    };

    window.addEventListener('wallet-loaded', handleWalletLoaded);

    return () => {
      isMounted = false;
      window.removeEventListener('wallet-loaded', handleWalletLoaded);
      console.log("🛑 ServicesProvider cleanup");
    };
  }, [identityManager, nostrService, groupChatService]);

  return (
    <ServicesContext.Provider
      value={{
        identityManager,
        nostrService,
        isNostrConnected,
        groupChatService,
        isGroupChatConnected,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
};
