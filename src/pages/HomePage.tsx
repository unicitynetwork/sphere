import { useState } from 'react';
import { AgentCard } from '../components/agents/AgentCard';
import { ChatSection } from '../components/chat/ChatSection';
import { WalletPanel } from '../components/wallet/WalletPanel';
import { publicAgents } from '../data/mockData';

export function HomePage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>('OTC Swap Deck');

  return (
    <>
      <div className="mb-8 relative">
          <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
          <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
          
          <div className="relative">
             <div className="relative p-8 rounded-2xl bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/50">
               <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                 {publicAgents.map((agent) => (
                   <AgentCard
                     key={agent.id}
                     {...agent}
                     isSelected={selectedAgent === agent.name}
                     onClick={() => setSelectedAgent(agent.name)}
                   />
                 ))}
               </div>
             </div>
          </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[600px]">
        <div className="lg:col-span-2 h-full">
          <ChatSection />
        </div>
        <div className='h-full'>
          <WalletPanel />
        </div>
      </div>
    </>
  );
}