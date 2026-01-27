export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ShowToastDetail {
  message: string;
  type?: ToastType;
  duration?: number;
}

// Helper function to show a toast from anywhere
export function showToast(message: string, type: ToastType = 'info', duration?: number) {
  window.dispatchEvent(
    new CustomEvent<ShowToastDetail>('show-toast', {
      detail: { message, type, duration },
    })
  );
}
