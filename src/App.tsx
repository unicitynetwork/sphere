import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { IntroPage } from './pages/IntroPage';
import { AgentPage } from './pages/AgentPage';
import { DevelopersPage } from './pages/DevelopersPage';
import { MineAlphaPage } from './pages/MineAlphaPage';
import { DocsPage } from './pages/DocsPage';
import { ConnectPage } from './pages/ConnectPage';
import { MarketsPage } from './pages/MarketsPage';
import { AgentsPage } from './pages/AgentsPage';
import { AboutPage } from './pages/AboutPage';
import { useSphereEvents } from './sdk';

export default function App() {
  useSphereEvents();

  return (
    <Routes>
      <Route path="/" element={<IntroPage />} />
      <Route path="/connect" element={<ConnectPage />} />
      <Route element={<DashboardLayout />}>
        <Route path="/home" element={<Navigate to="/agents/dm" replace />} />
        <Route path="/agents/chat" element={<Navigate to="/agents/dm" replace />} />
        <Route path="/agents/:agentId" element={<AgentPage />} />
        <Route path="/ai" element={<Navigate to="/agents/ai" replace />} />
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/mine" element={<MineAlphaPage />} />
        <Route path="/developers/docs" element={<DocsPage />} />
        <Route path="/markets" element={<MarketsPage />} />
        <Route path="/explore-agents" element={<AgentsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>
    </Routes>
  );
}
