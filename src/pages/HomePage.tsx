import { useEffect } from 'react';
import { DesktopLayout } from '../components/desktop/DesktopLayout';
import { useDesktopState } from '../hooks/useDesktopState';

export function HomePage() {
  const { activeTabId, showDesktop } = useDesktopState();

  // Always show desktop (no active tab) when navigating to /home
  useEffect(() => {
    if (activeTabId !== null) {
      showDesktop();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <DesktopLayout />;
}
