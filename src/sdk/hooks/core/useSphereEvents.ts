import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import { formatAmount } from '../../index';
import { showToast } from '../../../components/ui/toast-utils';
import { CHAT_KEYS, GROUP_CHAT_KEYS, type DmReceivedDetail } from '../../../components/chat/data/chatTypes';
import type { IncomingTransfer } from '@unicitylabs/sphere-sdk';

// SDK DM shape (local mirror — SDK DTS not always available)
interface SDKDirectMessage {
  id: string;
  senderPubkey: string;
  recipientPubkey: string;
}

export function useSphereEvents(): void {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When sphere instance changes (new wallet, delete, import) —
  // immediately sync identity cache so the UI never shows stale data
  // from the previous wallet.
  useEffect(() => {
    if (sphere?.identity) {
      queryClient.setQueryData(SPHERE_KEYS.identity.current, { ...sphere.identity });
    } else {
      queryClient.removeQueries({ queryKey: SPHERE_KEYS.identity.all });
    }
  }, [sphere, queryClient]);

  useEffect(() => {
    if (!sphere) return;

    // Debounced payment invalidation — SDK fires bursts of events during
    // init / sync, so we coalesce them into a single invalidation pass.
    // Uses the parent key so TanStack fires one notification (not four).
    const invalidatePayments = () => {
      if (invalidateTimerRef.current) return; // already scheduled
      invalidateTimerRef.current = setTimeout(() => {
        invalidateTimerRef.current = null;
        queryClient.invalidateQueries({
          queryKey: SPHERE_KEYS.payments.all,
        });
      }, 300);
    };

    const handleIncomingTransfer = (transfer: IncomingTransfer) => {
      invalidatePayments();

      // Build toast message
      const sender = transfer.senderNametag ? `@${transfer.senderNametag}` : 'Someone';
      const tokenSummary = transfer.tokens.map(t => {
        const amt = formatAmount(t.amount, t.decimals);
        return `${amt} ${t.symbol}`;
      }).join(', ');

      let message = `${sender} sent you ${tokenSummary}`;
      if (transfer.memo) {
        message += `\n"${transfer.memo}"`;
      }

      showToast(message, 'success', 6000);
    };
    const handleTransferConfirmed = invalidatePayments;

    // Write sphere.identity directly into the query cache — by the time SDK
    // fires these events, its internal state is already updated.  Plain
    // invalidation can race with the SDK update, returning stale data.
    const refreshIdentityCache = () => {
      if (sphere.identity) {
        queryClient.setQueryData(SPHERE_KEYS.identity.current, { ...sphere.identity });
      }
    };

    const handleNametagChange = () => {
      refreshIdentityCache();
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    };

    const handleIdentityChange = () => {
      refreshIdentityCache();
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });
      // Invalidate all chat queries so UI re-fetches for the new address
      queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: GROUP_CHAT_KEYS.all });
    };

    const handleSyncCompleted = invalidatePayments;

    const handleSyncRemoteUpdate = invalidatePayments;

    // Bridge incoming SDK DMs to lightweight custom event + query invalidation
    const handleDmReceived = (dm: SDKDirectMessage) => {
      const myPubkey = sphere.identity?.chainPubkey;
      const isFromMe = dm.senderPubkey === myPubkey;
      const peerPubkey = isFromMe ? dm.recipientPubkey : dm.senderPubkey;

      // Invalidate chat queries so UI re-reads from SDK
      queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });

      // Dispatch lightweight event for UI components (useChat, MiniChatWindow)
      const detail: DmReceivedDetail = { peerPubkey, messageId: dm.id, isFromMe };
      window.dispatchEvent(new CustomEvent('dm-received', { detail }));

      // Invalidate SDK communication queries
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.communications.all,
      });
    };

    // Bridge read receipts — SDK already updated isRead, just invalidate
    const handleMessageRead = () => {
      queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
    };

    // Bridge composing indicators to custom event
    const handleComposingStarted = (data: { senderPubkey: string; senderNametag?: string; expiresIn: number }) => {
      window.dispatchEvent(new CustomEvent('dm-typing', { detail: data }));
    };

    // Bridge incoming payment requests to custom event
    const handlePaymentRequestIncoming = () => {
      window.dispatchEvent(new Event('payment-requests-updated'));
    };

    // Invalidate history query immediately when SDK saves a new history entry
    const handleHistoryUpdated = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.transactions.history,
      });
    };

    sphere.on('transfer:incoming', handleIncomingTransfer);
    sphere.on('transfer:confirmed', handleTransferConfirmed);
    sphere.on('history:updated', handleHistoryUpdated);
    sphere.on('nametag:registered', handleNametagChange);
    sphere.on('nametag:recovered', handleNametagChange);
    sphere.on('identity:changed', handleIdentityChange);
    sphere.on('sync:completed', handleSyncCompleted);
    sphere.on('sync:remote-update', handleSyncRemoteUpdate);
    sphere.on('message:dm', handleDmReceived);
    sphere.on('message:read', handleMessageRead);
    sphere.on('composing:started', handleComposingStarted);
    sphere.on('payment_request:incoming', handlePaymentRequestIncoming);

    return () => {
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      sphere.off('transfer:incoming', handleIncomingTransfer);
      sphere.off('transfer:confirmed', handleTransferConfirmed);
      sphere.off('history:updated', handleHistoryUpdated);
      sphere.off('nametag:registered', handleNametagChange);
      sphere.off('nametag:recovered', handleNametagChange);
      sphere.off('identity:changed', handleIdentityChange);
      sphere.off('sync:completed', handleSyncCompleted);
      sphere.off('sync:remote-update', handleSyncRemoteUpdate);
      sphere.off('message:dm', handleDmReceived);
      sphere.off('message:read', handleMessageRead);
      sphere.off('composing:started', handleComposingStarted);
      sphere.off('payment_request:incoming', handlePaymentRequestIncoming);
    };
  }, [sphere, queryClient]);
}
