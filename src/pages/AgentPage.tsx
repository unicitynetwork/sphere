import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { DesktopLayout } from '../components/desktop/DesktopLayout';
import { getAgentConfig } from '../config/activities';
import { useDesktopState } from '../hooks/useDesktopState';

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { openTab, activeTabId } = useDesktopState();

  // Sync URL → desktop state: when URL says a specific agent, open it as a tab
  useEffect(() => {
    if (agentId && agentId !== activeTabId) {
      openTab(agentId);
    }
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to DM if invalid agent ID
  if (agentId && !getAgentConfig(agentId)) {
    return <Navigate to="/agents/dm" replace />;
  }

  return <DesktopLayout />;
}
