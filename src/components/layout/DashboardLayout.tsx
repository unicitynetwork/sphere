import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { MiniChatBubbles } from '../chat/mini';
import { useUIState } from '../../hooks/useUIState';
import { useDesktopState } from '../../hooks/useDesktopState';
import { TutorialOverlay } from '../tutorial/TutorialOverlay';
import { useTutorial } from '../../hooks/useTutorial';

export function DashboardLayout() {
  const location = useLocation();
  const isMinePage = location.pathname === '/mine';
  const { isFullscreen } = useUIState();
  const { activeTabId } = useDesktopState();
  const tutorial = useTutorial();

  // Hide mini chat only when the DM tab is actively open (to avoid duplicate UI)
  // Show it when fullscreen is active regardless
  const isAgentPage = location.pathname.startsWith('/agents/');
  const isDmTabActive = isAgentPage && activeTabId === 'dm';
  const showMiniChat = !isDmTabActive || isFullscreen;

  return (
    <div className="h-full flex flex-col bg-neutral-100 dark:bg-linear-to-br dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 theme-transition overflow-y-auto overflow-x-hidden">
      <Header />
      <div className="flex-1 min-h-0 flex">
        <div className={`flex-1 w-full mx-auto ${isFullscreen ? 'p-0' : 'max-w-450 px-4 pt-4 pb-0 md:p-8 lg:pb-8'} ${
          isMinePage ? 'bg-neutral-100 dark:bg-gray-950' : ''
        }`}>
          <Outlet />
        </div>
      </div>

      {/* Mini chat bubbles - hidden on chat page unless fullscreen */}
      {showMiniChat && <MiniChatBubbles />}

      {/* Onboarding tutorial overlay */}
      {isAgentPage && tutorial.isActive && (
        <TutorialOverlay
          isActive={tutorial.isActive}
          currentStep={tutorial.currentStep}
          currentStepIndex={tutorial.currentStepIndex}
          totalSteps={tutorial.totalSteps}
          isLastStep={tutorial.isLastStep}
          onNext={tutorial.next}
          onDismiss={tutorial.dismiss}
        />
      )}
    </div>
  );
}
