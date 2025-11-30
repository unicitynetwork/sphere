import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChatState } from '../../hooks/useChatState';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatMainArea } from './components/ChatMainArea';

export function ChatSection() {
  const [searchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sellerId = searchParams.get('sellerId');
  const productName = searchParams.get('product');
  const productImage = searchParams.get('image');
  const productPrice = searchParams.get('price') ? Number(searchParams.get('price')) : undefined;
  const purchased = searchParams.get('purchased') === 'true';
  const chatState = useChatState(sellerId, productName, productImage, productPrice, purchased);

  return (
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden grid grid-cols-[auto_1fr] relative shadow-2xl h-full min-h-0">
      {/* Background decorative elements */}
      <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      {/* Left Sidebar */}
      <ChatSidebar
        chatMode={chatState.chatMode}
        handleModeChange={chatState.handleModeChange}
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