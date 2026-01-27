import type { AgentConfig } from '../../config/activities';
import { AgentChat } from './shared';

interface AIChatProps {
  agent: AgentConfig;
}

export function AIChat({ agent }: AIChatProps) {
  return (
    <AgentChat<unknown>
      agent={agent}
      bgGradient={{ from: 'bg-orange-500/5', to: 'bg-amber-500/5' }}
    />
  );
}
