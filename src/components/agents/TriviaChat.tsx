import type { AgentConfig } from '../../config/activities';
import { AgentChat } from './shared';

interface TriviaChatProps {
  agent: AgentConfig;
}

export function TriviaChat({ agent }: TriviaChatProps) {
  return (
    <AgentChat<unknown>
      agent={agent}
      bgGradient={{ from: 'bg-indigo-500/5', to: 'bg-cyan-500/5' }}
    />
  );
}
