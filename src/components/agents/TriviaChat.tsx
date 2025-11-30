import type { AgentConfig } from '../../config/activities';
import { AgentChat, type SidebarItem } from './shared';

interface TriviaChatProps {
  agent: AgentConfig;
}

// Placeholder type for sidebar item (not used but required by generic)
type NoSidebarItem = SidebarItem;

export function TriviaChat({ agent }: TriviaChatProps) {
  return (
    <AgentChat<unknown, NoSidebarItem>
      agent={agent}
      bgGradient={{ from: 'bg-indigo-500/5', to: 'bg-cyan-500/5' }}
    />
  );
}
