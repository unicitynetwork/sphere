import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout';

// Pages
import { IntroPage } from './pages/IntroPage';
import { AgentPage } from './pages/AgentPage';

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<IntroPage />} />
        <Route element={<DashboardLayout />}>
          <Route path="/home" element={<Navigate to="/agents/chat" replace />} />
          <Route path="/agents/:agentId" element={<AgentPage />} />
          <Route path="/ai" element={<Navigate to="/agents/ai" replace />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}