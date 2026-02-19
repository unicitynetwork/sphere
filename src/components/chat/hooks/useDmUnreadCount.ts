import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../../sdk/hooks/core/useIdentity';
import { buildAddressId, CHAT_KEYS } from '../data/chatTypes';

export function useDmUnreadCount(): number {
  const { sphere } = useSphereContext();
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';

  const { data = 0 } = useQuery({
    queryKey: CHAT_KEYS.unreadCount(addressId),
    queryFn: () => sphere?.communications.getUnreadCount() ?? 0,
    enabled: !!sphere,
    staleTime: 5000,
  });

  return data;
}
