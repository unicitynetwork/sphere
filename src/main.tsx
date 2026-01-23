import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeInitializer } from './components/theme'
import { ServicesProvider } from './contexts/ServicesProvider'
import mixpanel from 'mixpanel-browser'

// DEBUG: Check localStorage state at the VERY START before any app code runs
// This helps diagnose wallet data corruption issues
(function debugStartupState() {
  console.log("🚀 [STARTUP] main.tsx executing - checking localStorage BEFORE any imports...");
  try {
    const walletKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sphere_wallet_DIRECT://")) {
        walletKeys.push(key);
      }
    }
    if (walletKeys.length === 0) {
      console.log("🚀 [STARTUP] No wallet data found in localStorage");
    } else {
      for (const key of walletKeys) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            const parsed = JSON.parse(value);
            console.log(`🚀 [STARTUP] Wallet: size=${value.length} bytes, id=${parsed.id?.slice(0, 8)}..., tokens=${parsed.tokens?.length || 0}`);
          } catch {
            console.log(`🚀 [STARTUP] Wallet: size=${value.length} bytes (JSON parse error)`);
          }
        }
      }
    }
  } catch (e) {
    console.error("🚀 [STARTUP] Error checking localStorage:", e);
  }
})();

mixpanel.init('19d06212425213a4eeb34337016d0186', {
  autocapture: true,
  record_sessions_percent: 100,
  api_host: 'https://api-eu.mixpanel.com',
})

// Register dev tools in development mode only
if (import.meta.env.DEV) {
  import('./utils/devTools').then(({ registerDevTools }) => {
    registerDevTools();
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <ThemeInitializer>
          <HashRouter>
            <App />
          </HashRouter>
        </ThemeInitializer>
      </ServicesProvider>
    </QueryClientProvider>
  </StrictMode>,
)
