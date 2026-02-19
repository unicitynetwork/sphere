import { useEffect } from 'react';
import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { DesktopLayout } from '../components/desktop/DesktopLayout';
import { getAgentConfig } from '../config/activities';
import { useDesktopState } from '../hooks/useDesktopState';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const { openTab, activeTabId } = useDesktopState();

  // Extract URL param as a stable string for the dependency array
  const customUrl = agentId === 'custom' ? searchParams.get('url') : null;

  // Sync URL → desktop state: when URL says a specific agent, open it as a tab
  useEffect(() => {
    if (!agentId) return;

    // Custom agent with ?url= parameter — open iframe directly
    if (agentId === 'custom' && customUrl) {
      try {
        const hostname = new URL(customUrl).hostname;
        openTab('custom', { url: customUrl, label: hostname });
      } catch {
        // Invalid URL — fall through to open the custom URL prompt
        openTab(agentId);
      }
      return;
    }

    if (agentId !== activeTabId) {
      openTab(agentId);
    }
  }, [agentId, customUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to home if invalid agent ID (except custom which is always valid)
  if (agentId && agentId !== 'custom' && !getAgentConfig(agentId)) {
    return <Navigate to="/home" replace />;
  }

  return <DesktopLayout />;
}
