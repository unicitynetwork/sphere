import { useNavigate } from 'react-router-dom';
import { agents } from '../../config/activities';
import { useDesktopState } from '../../hooks/useDesktopState';
import { useDmUnreadCount } from '../chat/hooks/useDmUnreadCount';
import { useGroupUnreadCount } from '../chat/hooks/useGroupUnreadCount';
import { DesktopIcon } from './DesktopIcon';
import logoUrl from '/Union.svg';

export function DesktopShortcuts() {
  const navigate = useNavigate();
  const { openTabs } = useDesktopState();
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
      {/* Subtle gradient background — orange glow from bottom-left */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(ellipse at 0% 100%, rgba(251, 146, 60, 0.08) 0%, transparent 50%)`,
        }}
      />

      {/* Watermark — bottom-left, matches header branding */}
      <div className="absolute bottom-8 left-8 sm:bottom-12 sm:left-12 flex items-center gap-3 sm:gap-5 pointer-events-none select-none opacity-[0.06] dark:opacity-[0.07]">
        <img src={logoUrl} alt="" className="w-14 h-14 sm:w-20 sm:h-20" />
        <div className="relative">
          <span className="text-4xl sm:text-6xl text-neutral-900 dark:text-white">AgentSphere</span>
          <p className="text-lg sm:text-2xl text-neutral-500 dark:text-neutral-400">Agentic AI Marketplaces</p>
          <div className="absolute -bottom-2 left-0 w-24 sm:w-36 h-1 bg-linear-to-r from-orange-500 to-transparent rounded-full" />
        </div>
      </div>

      {/* Desktop icons grid */}
      <div className="relative flex-1 flex items-start justify-center px-4 pt-6 sm:px-8 sm:pt-10">
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
          {agents.map((agent) => (
            <DesktopIcon
              key={agent.id}
              agent={agent}
              isOpen={openAppIds.has(agent.id)}
              badge={getBadge(agent.id)}
              onClick={() => navigate(`/agents/${agent.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
