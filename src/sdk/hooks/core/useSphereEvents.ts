import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';

export function useSphereEvents(): void {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sphere) return;

    const handleIncomingTransfer = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.tokens.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.balance.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.transactions.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.assets.all,
      });
    };

    const handleTransferConfirmed = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.tokens.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.balance.all,
      });
    };

    const handleNametagChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    };

    const handleIdentityChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });
    };

    const handleSyncCompleted = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.tokens.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.balance.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.assets.all,
      });
    };

    const handleDmReceived = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.communications.all,
      });
    };

    sphere.on('transfer:incoming', handleIncomingTransfer);
    sphere.on('transfer:confirmed', handleTransferConfirmed);
    sphere.on('nametag:registered', handleNametagChange);
    sphere.on('nametag:recovered', handleNametagChange);
    sphere.on('identity:changed', handleIdentityChange);
    sphere.on('sync:completed', handleSyncCompleted);
    sphere.on('message:dm', handleDmReceived);

    return () => {
      sphere.off('transfer:incoming', handleIncomingTransfer);
      sphere.off('transfer:confirmed', handleTransferConfirmed);
      sphere.off('nametag:registered', handleNametagChange);
      sphere.off('nametag:recovered', handleNametagChange);
      sphere.off('identity:changed', handleIdentityChange);
      sphere.off('sync:completed', handleSyncCompleted);
      sphere.off('message:dm', handleDmReceived);
    };
  }, [sphere, queryClient]);
}
