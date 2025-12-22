import { ExternalLink } from 'lucide-react';
import type { AgentConfig } from '../../config/activities';
import { mockGames, type GameInfo } from '../../data/agentsMockData';
import { AgentChat, type AgentMessage } from './shared';
import { isMock } from '../../hooks/useAgentChat';

interface GamesChatProps {
  agent: AgentConfig;
}

// Card data containing games
interface GamesCardData {
  games: GameInfo[];
}

export function GamesChat({ agent }: GamesChatProps) {
  const isMockMode = isMock();

  // Process messages to attach game cards based on content (only in mock mode)
  const processMessage = (
    message: AgentMessage<GamesCardData>
  ): AgentMessage<GamesCardData> => {
    // Only process assistant messages without existing card data, and only in mock mode
    if (message.role !== 'assistant' || message.cardData || !isMockMode) {
      return message;
    }

    const content = message.content.toLowerCase();

    // Check if we should attach game cards (mock mode only)
    if (content.includes('quake') || content.includes('poker') || content.includes('game')) {
      let games: GameInfo[] = [];

      if (content.includes('quake') && !content.includes('poker')) {
        games = [mockGames[0]];
      } else if (content.includes('poker') && !content.includes('quake')) {
        games = [mockGames[1]];
      } else {
        games = mockGames;
      }

      return {
        ...message,
        cardData: { games },
      };
    }

    return message;
  };

  return (
    <AgentChat<GamesCardData>
      agent={agent}
      processMessage={processMessage}
      renderMessageCard={(cardData) => (
        <div className="mt-4 space-y-3">
          {cardData.games.map((game) => (
            <div key={game.id} className="rounded-xl overflow-hidden border border-neutral-600/50">
              <img src={game.image} alt={game.name} className="w-full h-28 object-cover" />
              <div className="p-3 bg-neutral-900/80">
                <h4 className="font-medium text-white">{game.name}</h4>
                <p className="text-sm text-neutral-400 mt-1">{game.description}</p>
                <a
                  href={game.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-linear-to-r ${agent.color} text-white text-sm font-medium`}
                >
                  Play Now <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      bgGradient={{ from: 'bg-purple-500/5', to: 'bg-pink-500/5' }}
    />
  );
}
