/**
 * Browser WebSocket Adapter
 *
 * Browser-specific implementation of WebSocketAdapter using native WebSocket API.
 */

import type {
  WebSocketAdapter,
  WebSocketState,
  MessageHandler,
  CloseHandler,
  ErrorHandler,
} from '../../network/websocket';

/**
 * Browser implementation of WebSocketAdapter
 */
export class BrowserWSAdapter implements WebSocketAdapter {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private errorHandler: ErrorHandler | null = null;

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          resolve();
        };

        this.ws.onmessage = (event) => {
          if (this.messageHandler) {
            this.messageHandler(event.data);
          }
        };

        this.ws.onclose = (event) => {
          if (this.closeHandler) {
            this.closeHandler(event.code, event.reason);
          }
        };

        this.ws.onerror = () => {
          // Browser WebSocket doesn't expose error details for security
          const error = new Error('WebSocket connection error');
          if (this.errorHandler) {
            this.errorHandler(error);
          }
          // Reject only if not yet connected
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(error);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(data);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getState(): WebSocketState {
    if (!this.ws) return 'closed';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'open';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
      default:
        return 'closed';
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
