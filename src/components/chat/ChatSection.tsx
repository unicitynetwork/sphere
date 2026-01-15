import { useState } from 'react';
import { DMChatSection } from './dm/DMChatSection';
import { GroupChatSection } from './group/GroupChatSection';
import type { ChatMode } from '../../types';

export function ChatSection() {
  const [chatMode, setChatMode] = useState<ChatMode>('dm');

  const handleModeChange = (mode: ChatMode) => {
    setChatMode(mode);
  };

  // DM mode - render DMChatSection
  if (chatMode === 'dm') {
    return <DMChatSection onModeChange={handleModeChange} />;
  }

  // Global mode - render GroupChatSection
  return <GroupChatSection onModeChange={handleModeChange} />;
}
