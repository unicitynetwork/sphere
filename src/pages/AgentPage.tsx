import { useEffect, useRef } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatSection } from '../components/chat/ChatSection';
import { SportChat } from '../components/agents/SportChat';
import { P2PChat } from '../components/agents/P2PChat';
import { MerchChat } from '../components/agents/MerchChat';
import { TriviaChat } from '../components/agents/TriviaChat';
import { GamesChat } from '../components/agents/GamesChat';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { agents, getAgentConfig } from '../config/activities';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const currentAgent = agentId ? getAgentConfig(agentId) : undefined;

  // Scroll to chat on mobile when agent changes
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile && chatContainerRef.current) {
      chatContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [agentId]);

  // Redirect to chat if invalid agent
  if (!currentAgent) {
    return <Navigate to="/agents/chat" replace />;
  }

  const renderChatComponent = () => {
    switch (currentAgent.id) {
      case 'chat':
        return <ChatSection />;
      case 'trivia':
        return <TriviaChat agent={currentAgent} />;
      case 'games':
        return <GamesChat agent={currentAgent} />;
      case 'sport':
        return <SportChat agent={currentAgent} />;
      case 'p2p':
        return <P2PChat agent={currentAgent} />;
      case 'merch':
        return <MerchChat agent={currentAgent} />;
      default:
        return <ChatSection />;
    }
  };

  return (
    <>
      <div className="mb-2 md:mb-8 relative">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />

        <div className="relative">
          <div className="relative p-2 md:p-8 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/50">
            <div className="grid grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4">
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
      <div className="lg:grid lg:grid-cols-3 lg:gap-8 lg:h-[650px]">
        <div ref={chatContainerRef} className="lg:col-span-2 h-[calc(100dvh-180px)] min-h-[500px] lg:h-full">
          {renderChatComponent()}
        </div>
        <div className="mt-4 lg:mt-0 h-[calc(100dvh-200px)] min-h-[450px] lg:h-full overflow-hidden">
          <WalletPanel />
        </div>
      </div>
    </>
  );
}
