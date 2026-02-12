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
      // Connection events will fire on reconnect
    });

    const unsubscribe = sphere.on('groupchat:connection', (data) => {
      setIsGroupChatConnected(data.connected);
    });

    return () => {
      unsubscribe();
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
