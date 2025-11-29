import { useParams, Navigate } from 'react-router-dom';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatSection } from '../components/chat/ChatSection';
import { SimpleAIChat } from '../components/agents/SimpleAIChat';
import { SportChat } from '../components/agents/SportChat';
import { AIWithSidebarChat } from '../components/agents/AIWithSidebarChat';
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
    switch (currentAgent.id) {
      case 'chat':
        return <ChatSection />;
      case 'games':
        return <SimpleAIChat agent={currentAgent} />;
      case 'sport':
        return <SportChat agent={currentAgent} />;
      case 'p2p':
      case 'merch':
        return <AIWithSidebarChat agent={currentAgent} />;
      default:
        return <ChatSection />;
    }
  };

  return (
    <>
      <div className="mb-8 relative">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="relative">
          <div className="relative p-8 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/50">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[600px]">
        <div className="lg:col-span-2 h-full">
          {renderChatComponent()}
        </div>
        <div className="h-full">
          <WalletPanel />
        </div>
      </div>
    </>
  );
}
