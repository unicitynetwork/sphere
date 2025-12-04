import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout';

// Auth
import { WalletGate } from './components/auth/WalletGate';

// Pages
import { IntroPage } from './pages/IntroPage';
import { AgentPage } from './pages/AgentPage';

export default function App() {
  const location = useLocation();

  // Use base path as key to prevent remounting when switching agents
  const routeKey = location.pathname.startsWith('/agents/') ? '/agents' : location.pathname;

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={routeKey}>
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
        </Route>
      </Routes>
    </AnimatePresence>
  );
}