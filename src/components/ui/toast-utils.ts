export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface TransferToastData {
  sender: string;
  amount: string;
  symbol: string;
  iconUrl?: string | null;
  memo?: string;
}

export interface ShowToastDetail {
  message: string;
  type?: ToastType;
  duration?: number;
  transfer?: TransferToastData;
}

// Helper function to show a toast from anywhere
export function showToast(message: string, type: ToastType = 'info', duration?: number) {
  window.dispatchEvent(
    new CustomEvent<ShowToastDetail>('show-toast', {
      detail: { message, type, duration },
    })
  );
}

export function showTransferToast(transfer: TransferToastData, duration = 6000) {
  const message = `${transfer.sender} sent you ${transfer.amount} ${transfer.symbol}`;
  window.dispatchEvent(
    new CustomEvent<ShowToastDetail>('show-toast', {
      detail: { message, type: 'success', duration, transfer },
    })
  );
}
