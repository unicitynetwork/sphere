import type { AgentConfig } from '../../config/activities';
import { AgentChat, type SidebarItem } from './shared';

interface AIChatProps {
  agent: AgentConfig;
}

type NoSidebarItem = SidebarItem;

export function AIChat({ agent }: AIChatProps) {
  return (
    <AgentChat<unknown, NoSidebarItem>
      agent={agent}
      bgGradient={{ from: 'bg-orange-500/5', to: 'bg-amber-500/5' }}
    />
  );
}
