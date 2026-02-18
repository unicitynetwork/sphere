import { useQuery } from '@tanstack/react-query';
import { agents } from '../../config/activities';
import { useDesktopState } from '../../hooks/useDesktopState';
import { useSphereContext } from '../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../sdk/hooks/core/useIdentity';
import { CHAT_KEYS } from '../chat/data/chatTypes';
import { DesktopIcon } from './DesktopIcon';

function buildAddressId(directAddress: string): string {
  let hash = directAddress;
  if (hash.startsWith('DIRECT://')) hash = hash.slice(9);
  else if (hash.startsWith('DIRECT:')) hash = hash.slice(7);
  const first = hash.slice(0, 6).toLowerCase();
  const last = hash.slice(-6).toLowerCase();
  return `DIRECT_${first}_${last}`;
}

export function DesktopShortcuts() {
  const { openTab, openTabs } = useDesktopState();
  const { sphere } = useSphereContext();
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';

  const { data: dmUnreadCount = 0 } = useQuery({
    queryKey: CHAT_KEYS.unreadCount(addressId),
    queryFn: () => sphere?.communications.getUnreadCount() ?? 0,
    enabled: !!sphere,
    staleTime: 5000,
  });

  const openAppIds = new Set(openTabs.map((t) => t.appId));

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
              badge={agent.id === 'dm' ? dmUnreadCount : undefined}
              onClick={() => openTab(agent.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
