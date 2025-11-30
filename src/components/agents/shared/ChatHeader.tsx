import type { AgentConfig } from '../../../config/activities';

interface ChatHeaderProps {
  agent: AgentConfig;
  rightContent?: React.ReactNode;
}

export function ChatHeader({ agent, rightContent }: ChatHeaderProps) {
  return (
    <div className="p-4 border-b border-neutral-800/50 relative z-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
            <agent.Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg text-white font-medium">{agent.name}</h2>
            <p className="text-sm text-neutral-400">{agent.description}</p>
          </div>
        </div>
        {rightContent}
      </div>
    </div>
  );
}
