import React, { useState, useRef, useMemo, type ReactNode } from 'react';
import { GroupChatService, type GroupChatIdentityProvider } from '../components/chat/services/GroupChatService';
import { ServicesContext } from './ServicesContext';
import { useSphereContext } from '../sdk/hooks/core/useSphere';
import type { FullIdentity } from '@unicitylabs/sphere-sdk';

/**
 * Access the full identity (including privateKey) from Sphere.
 * Sphere.identity only returns public fields. The _identity field
 * holds the FullIdentity internally. This is a temporary bridge until
 * the SDK exposes a proper API for signing operations.
 */
function getFullIdentity(sphere: unknown): FullIdentity | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sphere as any)._identity ?? null;
}

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isGroupChatConnected] = useState(false);
  const { sphere } = useSphereContext();
  const groupChatServiceRef = useRef<GroupChatService | null>(null);

  // Bridge Sphere identity to GroupChatService's identity provider interface
  const identityProvider = useMemo<GroupChatIdentityProvider>(() => ({
    getCurrentIdentity: async () => {
      if (!sphere) return null;
      const fullId = getFullIdentity(sphere);
      if (!fullId) return null;
      return {
        privateKey: fullId.privateKey,
        publicKey: fullId.chainPubkey,
        address: fullId.directAddress ?? '',
      };
    },
    getNametag: () => sphere?.identity?.nametag ?? null,
  }), [sphere]);

  // Create GroupChatService singleton lazily
  if (!groupChatServiceRef.current && sphere) {
    groupChatServiceRef.current = GroupChatService.getInstance(identityProvider);
  }

  const value = useMemo(() => ({
    groupChatService: groupChatServiceRef.current!,
    isGroupChatConnected,
  }), [isGroupChatConnected]);

  // Don't render until sphere is ready (GroupChatService needs identity provider)
  if (!sphere || !groupChatServiceRef.current) {
    return <>{children}</>;
  }

  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  );
};
