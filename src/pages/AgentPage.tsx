import { useParams, Navigate } from 'react-router-dom';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatSection } from '../components/chat/ChatSection';
import { SportChat } from '../components/agents/SportChat';
import { AIWithSidebarChat } from '../components/agents/AIWithSidebarChat';
import { UnifiedAgentChat } from '../components/agents/UnifiedAgentChat';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { agents, getAgentConfig } from '../config/activities';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();

  const currentAgent = agentId ? getAgentConfig(agentId) : undefined;

  // Redirect to chat if invalid agent
  if (!currentAgent) {
    return <Navigate to="/agents/chat" replace />;
  }

  const renderChatComponent = () => {
    switch (currentAgent.type) {
      case 'chat':
        return <ChatSection />;
      case 'unified':
        return <UnifiedAgentChat agent={currentAgent} />;
      case 'ai-with-sidebar':
        // Sport has different UI, keep separate for now
        if (currentAgent.id === 'sport') {
          return <SportChat agent={currentAgent} />;
        }
        return <AIWithSidebarChat agent={currentAgent} />;
      default:
        return <ChatSection />;
    }
  };

  return (
    <>
      <div className="mb-4 md:mb-8 relative">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="relative">
          <div className="relative p-4 md:p-8 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/50">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  id={agent.id}
                  name={agent.name}
                  Icon={agent.Icon}
                  category={agent.category}
                  color={agent.color}
                  isSelected={agentId === agent.id}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8 lg:h-[600px]">
        <div className="lg:col-span-2 h-[400px] lg:h-full">
          {renderChatComponent()}
        </div>
        <div className="h-[500px] lg:h-full">
          <WalletPanel />
        </div>
      </div>
    </>
  );
}
