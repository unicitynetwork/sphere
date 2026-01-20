import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { WalletGate } from './components/auth/WalletGate';
import { IntroPage } from './pages/IntroPage';
import { AgentPage } from './pages/AgentPage';
import { DevelopersPage } from './pages/DevelopersPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IntroPage />} />
      <Route
        element={
          <WalletGate>
            <DashboardLayout />
          </WalletGate>
        }
      >
        <Route path="/home" element={<Navigate to="/agents/chat" replace />} />
        <Route path="/agents/:agentId" element={<AgentPage />} />
        <Route path="/ai" element={<Navigate to="/agents/ai" replace />} />
        <Route path="/developers" element={<DevelopersPage />} />
      </Route>
    </Routes>
  );
}