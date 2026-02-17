import React, { useState, useEffect, useMemo, type ReactNode } from 'react';
import { ServicesContext } from './ServicesContext';
import { useSphereContext } from '../sdk/hooks/core/useSphere';

export const ServicesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isGroupChatConnected, setIsGroupChatConnected] = useState(false);
  const { sphere } = useSphereContext();

  const groupChat = sphere?.groupChat ?? null;

  // Auto-connect group chat when available
  useEffect(() => {
    if (!groupChat || !sphere) return;

    groupChat.connect().then(() => {
      setIsGroupChatConnected(groupChat.getConnectionStatus());
    }).catch((err) => {
      console.error('[ServicesProvider] Group chat connect failed:', err);
    });

    // On address change, reload group chat data and reconnect.
    // The SDK now stores groups per-address (STORAGE_KEYS_ADDRESS), so load()
    // reads the new address's data and connect() restores from relay if needed.
    const handleIdentityChange = async () => {
      setIsGroupChatConnected(false);
      try {
        await groupChat.load();
        await groupChat.connect();
        setIsGroupChatConnected(groupChat.getConnectionStatus());
      } catch (err) {
        console.error('[ServicesProvider] Group chat reconnect failed:', err);
      }
    };

    const unsubs = [
      sphere.on('groupchat:connection', (data) => {
        setIsGroupChatConnected(data.connected);
      }),
      sphere.on('identity:changed', handleIdentityChange),
    ];

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [groupChat, sphere]);

  const value = useMemo(() => ({
    groupChat,
    isGroupChatConnected,
  }), [groupChat, isGroupChatConnected]);

  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  );
};
