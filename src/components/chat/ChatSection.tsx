import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DMChatSection } from './dm/DMChatSection';
import { GroupChatSection } from './group/GroupChatSection';
import type { ChatMode } from '../../types';

export function ChatSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [chatMode, setChatMode] = useState<ChatMode>('dm');
  const [pendingDmRecipient, setPendingDmRecipient] = useState<string | null>(null);

  // Handle URL params for DM navigation from other agents (P2P, SellAnything, etc.)
  useEffect(() => {
    const nametag = searchParams.get('nametag');
    if (nametag) {
      // Convert to nametag format (e.g., "Sarah Williams" → "sarah-williams")
      const formattedNametag = nametag.toLowerCase().replace(/\s+/g, '-');
      setPendingDmRecipient(formattedNametag);
      // Clear the URL params after reading them
      setSearchParams((prev) => {
        prev.delete('nametag');
        prev.delete('product');
        prev.delete('image');
        prev.delete('price');
        prev.delete('purchased');
        return prev;
      });
    }
  }, [searchParams, setSearchParams]);

  const handleModeChange = (mode: ChatMode, dmRecipient?: string) => {
    if (mode === 'dm' && dmRecipient) {
      setPendingDmRecipient(dmRecipient);
    }
    setChatMode(mode);
  };

  const handleDmRecipientHandled = () => {
    setPendingDmRecipient(null);
  };

  // DM mode - render DMChatSection
  if (chatMode === 'dm') {
    return (
      <DMChatSection
        onModeChange={handleModeChange}
        pendingRecipient={pendingDmRecipient}
        onPendingRecipientHandled={handleDmRecipientHandled}
      />
    );
  }

  // Global mode - render GroupChatSection
  return <GroupChatSection onModeChange={handleModeChange} />;
}
