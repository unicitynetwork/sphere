import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [activeUrl, setActiveUrl] = useState(() => agent.iframeUrl ?? '');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<ConnectHost | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const initializedRef = useRef(false);
  const { sphere } = useSphereContext();
  const { requestApproval, requestIntent, setConnectHost } = useConnectContext();

  const hasUrlOptions = agent.iframeUrls && agent.iframeUrls.length > 1;

  // Stable refs to avoid effect re-runs
  const sphereRef = useRef(sphere);
  sphereRef.current = sphere;
  const requestApprovalRef = useRef(requestApproval);
  requestApprovalRef.current = requestApproval;
  const requestIntentRef = useRef(requestIntent);
  requestIntentRef.current = requestIntent;

  // Track sphere availability so the effect re-runs when sphere loads
  const sphereReady = !!sphere;

  const cleanup = useCallback(() => {
    hostRef.current?.destroy();
    hostRef.current = null;
    setConnectHost(null);
    transportRef.current?.destroy();
    transportRef.current = null;
    initializedRef.current = false;
  }, [setConnectHost]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !sphereRef.current || !activeUrl) return;
    // Prevent StrictMode double-init
    if (initializedRef.current) return;

    let origin: string;
    try {
      origin = new URL(activeUrl).origin;
    } catch {
      console.warn('[Connect] Invalid iframe URL:', activeUrl);
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

    return () => {
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, sphereReady]);

  const handleUrlSwitch = (url: string) => {
    if (url === activeUrl) return;
    cleanup();
    setIsLoading(true);
    setActiveUrl(url);
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {hasUrlOptions && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800/50 bg-neutral-50/80 dark:bg-neutral-800/40 shrink-0">
          {agent.iframeUrls!.map((option) => (
            <button
              key={option.url}
              onClick={() => handleUrlSwitch(option.url)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 ${
                activeUrl === option.url
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/40'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative flex-1 min-h-0">
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
          src={activeUrl}
          title={agent.name}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          allow="clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
