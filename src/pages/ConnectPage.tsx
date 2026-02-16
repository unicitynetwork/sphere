import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConnectHost, HOST_READY_TYPE } from '@unicitylabs/sphere-sdk/connect';
import type { DAppMetadata, PermissionScope } from '@unicitylabs/sphere-sdk/connect';
import { PostMessageTransport } from '@unicitylabs/sphere-sdk/connect/browser';
import { useSphereContext } from '../sdk/hooks/core/useSphere';
import { useConnectContext } from '../components/connect/ConnectContext';
import { WalletPanel } from '../components/wallet/WalletPanel';

/** localStorage key for remembering approved origins (localStorage persists across popup windows) */
const APPROVED_SESSIONS_KEY = 'sphere-connect:approved';

interface ApprovedSession {
  origin: string;
  dappName: string;
  permissions: PermissionScope[];
  approvedAt: number;
}

function getApprovedSession(origin: string): ApprovedSession | null {
  try {
    const data = localStorage.getItem(APPROVED_SESSIONS_KEY);
    if (!data) return null;
    const sessions: ApprovedSession[] = JSON.parse(data);
    return sessions.find((s) => s.origin === origin) ?? null;
  } catch {
    return null;
  }
}

function saveApprovedSession(session: ApprovedSession): void {
  try {
    const data = localStorage.getItem(APPROVED_SESSIONS_KEY);
    const sessions: ApprovedSession[] = data ? JSON.parse(data) : [];
    const idx = sessions.findIndex((s) => s.origin === session.origin);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.push(session);
    }
    localStorage.setItem(APPROVED_SESSIONS_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

export function ConnectPage() {
  const [searchParams] = useSearchParams();
  const origin = searchParams.get('origin');
  const { sphere, isLoading } = useSphereContext();
  const { requestApproval, requestIntent, setConnectHost } = useConnectContext();
  const hostRef = useRef<ConnectHost | null>(null);
  const transportRef = useRef<PostMessageTransport | null>(null);
  const [status, setStatus] = useState<'waiting' | 'ready' | 'error'>('waiting');
  const [errorMsg, setErrorMsg] = useState('');
  const [connectedDapp, setConnectedDapp] = useState<string | null>(null);

  // Stable refs so the effect doesn't re-run when these change
  const sphereRef = useRef(sphere);
  sphereRef.current = sphere;
  const requestApprovalRef = useRef(requestApproval);
  requestApprovalRef.current = requestApproval;
  const requestIntentRef = useRef(requestIntent);
  requestIntentRef.current = requestIntent;

  // Track whether sphere has been available at least once
  const sphereReady = !isLoading && !!sphere;

  // Prevent StrictMode double-mount from destroying the host.
  // In dev, React runs: mount → cleanup → mount. The cleanup would destroy host1,
  // then mount creates host2 — but the dApp already connected to host1.
  // Since this is a popup page, browser GC handles cleanup when the window closes.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!sphereReady) return;
    // Already initialized (incl. StrictMode second mount) — skip
    if (initializedRef.current) return;

    if (!origin) {
      setStatus('error');
      setErrorMsg('Missing origin parameter');
      return;
    }
    if (!window.opener) {
      setStatus('error');
      setErrorMsg('This page must be opened as a popup from a dApp');
      return;
    }

    initializedRef.current = true;
    const currentSphere = sphereRef.current!;

    const transport = PostMessageTransport.forHost(window.opener as Window, {
      allowedOrigins: [origin],
    });
    transportRef.current = transport;

    const host = new ConnectHost({
      sphere: currentSphere,
      transport,
      onConnectionRequest: async (dapp: DAppMetadata, perms: PermissionScope[]) => {
        // Check if this origin was already approved in this browser session
        const saved = getApprovedSession(origin);
        if (saved) {
          setConnectedDapp(saved.dappName);
          return { approved: true, grantedPermissions: saved.permissions };
        }

        // First time — show approval modal
        const result = await requestApprovalRef.current(dapp, perms);
        if (result.approved) {
          setConnectedDapp(dapp.name);
          saveApprovedSession({
            origin,
            dappName: dapp.name,
            permissions: result.grantedPermissions,
            approvedAt: Date.now(),
          });
        }
        return result;
      },
      onIntent: (action, params) =>
        requestIntentRef.current(action, params),
    });
    hostRef.current = host;
    setConnectHost(host);

    setStatus('ready');

    // Signal to dApp that host is ready
    try {
      (window.opener as Window).postMessage(
        { type: HOST_READY_TYPE },
        origin,
      );
    } catch {
      try {
        (window.opener as Window).postMessage(
          { type: HOST_READY_TYPE },
          '*',
        );
      } catch { /* ignore */ }
    }

    // No cleanup — popup page is GC'd when window closes.
    // Returning a cleanup would break StrictMode (destroy host on first unmount).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sphereReady, origin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-neutral-950 dark:to-neutral-900 flex flex-col items-center p-4 pt-8">
      <div className="w-full max-w-sm space-y-3">
        {/* Connection status bar */}
        {status === 'ready' && (
          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-gray-200 dark:border-neutral-700 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                {connectedDapp ? `Connected to ${connectedDapp}` : 'Ready for connections'}
              </span>
            </div>
            {origin && (
              <div className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
                Origin: <span className="font-mono">{origin}</span>
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800 p-4 text-center text-red-600 dark:text-red-400 text-sm">
            {errorMsg}
          </div>
        )}

        {/* Wallet panel — same component as the main app */}
        <div className="h-[520px]">
          <WalletPanel />
        </div>

        {/* Hint */}
        {status === 'ready' && (
          <p className="text-xs text-center text-gray-400 dark:text-neutral-500 px-4">
            You can close this window. It will re-open automatically when the dApp needs your wallet.
          </p>
        )}
      </div>
    </div>
  );
}
