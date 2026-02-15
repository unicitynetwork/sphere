import { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectHost } from '@unicitylabs/sphere-sdk/connect';
import type { DAppMetadata, PermissionScope } from '@unicitylabs/sphere-sdk/connect';
import { PostMessageTransport } from '@unicitylabs/sphere-sdk/connect/browser';
import type { AgentConfig } from '../../config/activities';
import { useSphereContext } from '../../sdk/hooks/core/useSphere';
import { useConnectContext } from '../connect/ConnectContext';

interface IframeAgentProps {
  agent: AgentConfig;
}

export function IframeAgent({ agent }: IframeAgentProps) {
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<ConnectHost | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const { sphere } = useSphereContext();
  const { requestApproval, requestIntent } = useConnectContext();

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !sphere || !agent.iframeUrl) return;

    // Don't re-create if already set up for this iframe
    if (hostRef.current) return;

    let origin: string;
    try {
      origin = new URL(agent.iframeUrl).origin;
    } catch {
      console.warn('[Connect] Invalid iframe URL:', agent.iframeUrl);
      return;
    }

    const transport = PostMessageTransport.forHost(iframe, {
      allowedOrigins: [origin],
    });
    transportRef.current = transport;

    const host = new ConnectHost({
      sphere,
      transport,
      onConnectionRequest: (dapp: DAppMetadata, perms: PermissionScope[]) => requestApproval(dapp, perms),
      onIntent: (action: string, params: Record<string, unknown>) => requestIntent(action, params),
    } as any);
    hostRef.current = host;

    return () => {
      hostRef.current?.destroy();
      hostRef.current = null;
      transportRef.current?.destroy();
      transportRef.current = null;
    };
  }, [sphere, agent.iframeUrl, requestApproval, requestIntent]);

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
        ref={iframeRef}
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
