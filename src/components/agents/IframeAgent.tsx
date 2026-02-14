import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentConfig } from '../../config/activities';

interface IframeAgentProps {
  agent: AgentConfig;
}

export function IframeAgent({ agent }: IframeAgentProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-3xl border border-neutral-200 dark:border-neutral-800/50 overflow-hidden relative lg:shadow-xl dark:lg:shadow-2xl h-full min-h-0 theme-transition">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-neutral-900/80">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              Loading {agent.name}...
            </span>
          </div>
        </div>
      )}
      <iframe
        src={agent.iframeUrl}
        title={agent.name}
        className="w-full h-full border-0"
        onLoad={() => setIsLoading(false)}
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
