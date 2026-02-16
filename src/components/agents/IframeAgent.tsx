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
  const initializedRef = useRef(false);
  const { sphere } = useSphereContext();
  const { requestApproval, requestIntent, setConnectHost } = useConnectContext();

  // Stable refs to avoid effect re-runs
  const sphereRef = useRef(sphere);
  sphereRef.current = sphere;
  const requestApprovalRef = useRef(requestApproval);
  requestApprovalRef.current = requestApproval;
  const requestIntentRef = useRef(requestIntent);
  requestIntentRef.current = requestIntent;

  // Track sphere availability so the effect re-runs when sphere loads
  const sphereReady = !!sphere;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !sphereRef.current || !agent.iframeUrl) return;
    // Prevent StrictMode double-init
    if (initializedRef.current) return;

    let origin: string;
    try {
      origin = new URL(agent.iframeUrl).origin;
    } catch {
      console.warn('[Connect] Invalid iframe URL:', agent.iframeUrl);
      return;
    }

    initializedRef.current = true;

    const transport = PostMessageTransport.forHost(iframe, {
      allowedOrigins: [origin],
    });
    transportRef.current = transport;

    const host = new ConnectHost({
      sphere: sphereRef.current,
      transport,
      onConnectionRequest: (dapp: DAppMetadata, perms: PermissionScope[]) =>
        requestApprovalRef.current(dapp, perms),
      onIntent: (action, params) => requestIntentRef.current(action, params),
    });
    hostRef.current = host;
    setConnectHost(host);

    // Real cleanup only when component actually unmounts (navigate away)
    return () => {
      // In StrictMode, initializedRef prevents re-creation so cleanup is safe
      hostRef.current?.destroy();
      hostRef.current = null;
      setConnectHost(null);
      transportRef.current?.destroy();
      transportRef.current = null;
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.iframeUrl, sphereReady]);

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
