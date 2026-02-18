import { useQuery } from '@tanstack/react-query';
import { useServices } from '../../../contexts/useServices';
import { useIdentity } from '../../../sdk/hooks/core/useIdentity';
import { buildAddressId } from '../data/chatTypes';
import { groupChatKeys } from './useGroupChat';

export function useGroupUnreadCount(): number {
  const { groupChat, isGroupChatConnected } = useServices();
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';

  const { data = 0 } = useQuery({
    queryKey: groupChatKeys(addressId).unreadCount,
    queryFn: () => groupChat?.getTotalUnreadCount() ?? 0,
    enabled: !!groupChat && isGroupChatConnected,
    staleTime: 5000,
  });

  return data;
}
