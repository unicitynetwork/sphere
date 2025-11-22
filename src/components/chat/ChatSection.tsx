import { useChatState } from '../../hooks/useChatState';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatMainArea } from './components/ChatMainArea';

export function ChatSection() {
  const chatState = useChatState();

  return (
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex relative shadow-2xl h-full">
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
      />

      {/* Main Chat Area */}
      <ChatMainArea {...chatState} />
    </div>
  );
}