import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChatState } from '../../hooks/useChatState';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatMainArea } from './components/ChatMainArea';
import { DMChatSection } from './dm/DMChatSection';
import type { ChatMode } from '../../types';

export function ChatSection() {
  const [searchParams] = useSearchParams();
  const [chatMode, setChatMode] = useState<ChatMode>('dm');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sellerId = searchParams.get('sellerId');
  const productName = searchParams.get('product');
  const productImage = searchParams.get('image');
  const productPrice = searchParams.get('price') ? Number(searchParams.get('price')) : undefined;
  const purchased = searchParams.get('purchased') === 'true';
  const chatState = useChatState(sellerId, productName, productImage, productPrice, purchased);

  const handleModeChange = (mode: ChatMode) => {
    setChatMode(mode);
  };

  // DM mode - render DMChatSection with mode toggle
  if (chatMode === 'dm') {
    return (
      <DMChatSection
        chatMode={chatMode}
        onModeChange={handleModeChange}
      />
    );
  }

  // Global chat mode - original layout with sidebar
  return (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden grid grid-cols-[auto_1fr] relative shadow-xl dark:shadow-2xl h-full min-h-0 theme-transition">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      {/* Left Sidebar */}
      <ChatSidebar
        chatMode={chatMode}
        handleModeChange={handleModeChange}
        users={chatState.users}
        onlineCount={chatState.onlineCount}
        selectedUser={chatState.selectedUser}
        handleUserSelect={chatState.handleUserSelect}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
      />

      {/* Main Chat Area */}
      <ChatMainArea
        {...chatState}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarOpen={sidebarOpen}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
      />
    </div>
  );
}
