import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { MiniChatBubbles } from '../chat/mini';
import { useUIState } from '../../hooks/useUIState';

export function DashboardLayout() {
  const location = useLocation();
  const isMinePage = location.pathname === '/mine';
  const { isFullscreen } = useUIState();

  // Hide mini chat on the DM chat page (to avoid duplicate UI)
  // But show it when fullscreen is active
  const isChatPage = location.pathname === '/agents/chat';
  const showMiniChat = !isChatPage || isFullscreen;

  return (
    <div className="h-full flex flex-col bg-neutral-100 dark:bg-linear-to-br dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 theme-transition overflow-y-auto overflow-x-hidden">
      <Header />
      <div className="flex-1 min-h-0 flex">
        <div className={`flex-1 max-w-450 w-full mx-auto px-4 pt-4 pb-0 md:p-8 lg:pb-8 ${
          isMinePage ? 'bg-neutral-100 dark:bg-gray-950' : ''
        }`}>
          <Outlet />
        </div>
      </div>

      {/* Mini chat bubbles - hidden on chat page unless fullscreen */}
      {showMiniChat && <MiniChatBubbles />}
    </div>
  );
}
