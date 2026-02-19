import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { IntroPage } from './pages/IntroPage';
import { HomePage } from './pages/HomePage';
import { AgentPage } from './pages/AgentPage';
import { ConnectPage } from './pages/ConnectPage';
import { useSphereEvents } from './sdk';

// Lazy-load non-core pages to reduce main bundle size
const DevelopersPage = lazy(() => import('./pages/DevelopersPage').then(m => ({ default: m.DevelopersPage })));
const MineAlphaPage = lazy(() => import('./pages/MineAlphaPage').then(m => ({ default: m.MineAlphaPage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then(m => ({ default: m.DocsPage })));
const MarketsPage = lazy(() => import('./pages/MarketsPage').then(m => ({ default: m.MarketsPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then(m => ({ default: m.AgentsPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  useSphereEvents();

  return (
    <Routes>
      <Route path="/" element={<IntroPage />} />
      <Route path="/connect" element={<ConnectPage />} />
      <Route element={<DashboardLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/agents/chat" element={<Navigate to="/agents/dm" replace />} />
        <Route path="/agents/:agentId" element={<AgentPage />} />
        <Route path="/ai" element={<Navigate to="/agents/ai" replace />} />
        <Route path="/developers" element={<Suspense fallback={<LazyFallback />}><DevelopersPage /></Suspense>} />
        <Route path="/mine" element={<Suspense fallback={<LazyFallback />}><MineAlphaPage /></Suspense>} />
        <Route path="/developers/docs" element={<Suspense fallback={<LazyFallback />}><DocsPage /></Suspense>} />
        <Route path="/markets" element={<Suspense fallback={<LazyFallback />}><MarketsPage /></Suspense>} />
        <Route path="/explore-agents" element={<Suspense fallback={<LazyFallback />}><AgentsPage /></Suspense>} />
        <Route path="/about" element={<Suspense fallback={<LazyFallback />}><AboutPage /></Suspense>} />
      </Route>
    </Routes>
  );
}
