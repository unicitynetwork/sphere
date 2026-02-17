import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { HashRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ThemeInitializer } from './components/theme'
import { SphereProvider } from './sdk/SphereProvider'
import { ServicesProvider } from './contexts/ServicesProvider'
import { ConnectProvider } from './components/connect'
import { ToastContainer } from './components/ui/Toast'
import mixpanel from 'mixpanel-browser'


mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN || '19d06212425213a4eeb34337016d0186', {
  autocapture: true,
  record_sessions_percent: 100,
  api_host: 'https://api-eu.mixpanel.com',
})


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SphereProvider network="testnet">
        <ServicesProvider>
          <ConnectProvider>
            <ThemeInitializer>
              <HashRouter>
                <App />
              </HashRouter>
              <ToastContainer />
            </ThemeInitializer>
          </ConnectProvider>
        </ServicesProvider>
      </SphereProvider>
    </QueryClientProvider>
  </StrictMode>,
)
