import { agents } from '../../config/activities';
import { useDesktopState } from '../../hooks/useDesktopState';
import { useDmUnreadCount } from '../chat/hooks/useDmUnreadCount';
import { useGroupUnreadCount } from '../chat/hooks/useGroupUnreadCount';
import { DesktopIcon } from './DesktopIcon';

export function DesktopShortcuts() {
  const { openTab, openTabs } = useDesktopState();
  const dmUnreadCount = useDmUnreadCount();
  const groupUnreadCount = useGroupUnreadCount();

  const openAppIds = new Set(openTabs.map((t) => t.appId));

  const getBadge = (agentId: string): number | undefined => {
    if (agentId === 'dm') return dmUnreadCount || undefined;
    if (agentId === 'group-chat') return groupUnreadCount || undefined;
    return undefined;
  };

  return (
    <div data-tutorial="desktop-shortcuts" className="absolute inset-0 overflow-auto flex flex-col">
      {/* Desktop icons grid */}
      <div className="flex-1 flex items-start justify-center px-4 pt-6 sm:px-8 sm:pt-10">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
          {agents.map((agent) => (
            <DesktopIcon
              key={agent.id}
              agent={agent}
              isOpen={openAppIds.has(agent.id)}
              badge={getBadge(agent.id)}
              onClick={() => openTab(agent.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
