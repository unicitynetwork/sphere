import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout';

// Pages
import { IntroPage } from './pages/IntroPage';
import { HomePage } from './pages/HomePage';
import { AIPage } from './pages/AIPage';

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<IntroPage />} />
        <Route element={<DashboardLayout />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/ai" element={<AIPage />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}