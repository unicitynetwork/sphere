import { useState } from 'react';
import { Header } from './components/layout/Header';
import { AgentCard } from './components/agents/AgentCard';
import { ChatSection } from './components/chat/ChatSection';
import { WalletPanel } from './components/wallet/WalletPanel';
import { publicAgents } from './data/mockData';
import { Zap } from 'lucide-react';

export default function App() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>('OTC Swap Deck');

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 overflow-x-hidden">
      <Header />
      
      <div className="max-w-[1800px] mx-auto p-8">
        {/* Agents Grid */}
        <div className="mb-8 relative">
          {/* Background decorative elements */}
          <div className="absolute -top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
          <div className="absolute -top-10 -right-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
          
          {/* Content */}
          <div className="relative">
            {/* Header with glass effect */}
            <div className="mb-6 p-6 rounded-2xl bg-linear-to-r from-neutral-900/80 to-neutral-800/50 backdrop-blur-xl border border-neutral-800/50 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-1.5 h-8 bg-linear-to-b from-orange-500 to-orange-600 rounded-full" />
                    <h2 className="text-2xl text-white">Agent Marketplace</h2>
                    <span className="px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs">
                      {publicAgents.length} Agents Available
                    </span>
                  </div>
                  <p className="text-neutral-400 ml-5">Select an agent to start interacting with the platform</p>
                </div>
                
                {/* Decorative icon */}
                <div className="hidden md:block relative">
                  <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-orange-500/20 to-purple-500/20 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                    <Zap className="w-8 h-8 text-orange-500" />
                  </div>
                  <div className="absolute inset-0 bg-orange-500/20 rounded-2xl blur-xl" />
                </div>
              </div>
            </div>
            
            {/* Cards container with decorative border */}
            <div className="relative p-8 rounded-2xl bg-linear-to-br from-neutral-900/40 to-neutral-800/20 backdrop-blur-sm border border-neutral-800/50">
              {/* Corner decorations */}
              <div className="absolute top-0 left-0 w-32 h-32 border-l-2 border-t-2 border-orange-500/30 rounded-tl-2xl" />
              <div className="absolute bottom-0 right-0 w-32 h-32 border-r-2 border-b-2 border-orange-500/30 rounded-br-2xl" />
              
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
        {/* Chat and Wallet Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 h-full">
            <ChatSection />
          </div>
          <div className='h-full'>
            <WalletPanel />
          </div>
        </div>
      </div>
    </div>
  );
}