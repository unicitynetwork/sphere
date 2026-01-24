/**
 * WebSocket Adapter Interface
 *
 * Platform-agnostic WebSocket abstraction.
 * Implementations provide platform-specific WebSocket connections.
 *
 * Browser: native WebSocket
 * Node.js: 'ws' package
 * React Native: platform WebSocket
 */

/**
 * WebSocket connection state
 */
export type WebSocketState = 'connecting' | 'open' | 'closing' | 'closed';

/**
 * WebSocket message handler
 */
export type MessageHandler = (data: string) => void;

/**
 * WebSocket close handler
 */
export type CloseHandler = (code?: number, reason?: string) => void;

/**
 * WebSocket error handler
 */
export type ErrorHandler = (error: Error) => void;

/**
 * WebSocket adapter interface
 *
 * Implementations must provide platform-specific WebSocket functionality.
 * The L1Wallet class uses this interface for network communication.
 */
export interface WebSocketAdapter {
  /**
   * Connect to WebSocket server
   * @param url WebSocket URL (wss://...)
   * @returns Promise that resolves when connected
   */
  connect(url: string): Promise<void>;

  /**
   * Send data through WebSocket
   * @param data String data to send
   */
  send(data: string): void;

  /**
   * Register message handler
   * @param handler Called when message received
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register close handler
   * @param handler Called when connection closes
   */
  onClose(handler: CloseHandler): void;

  /**
   * Register error handler
   * @param handler Called on WebSocket error
   */
  onError(handler: ErrorHandler): void;

  /**
   * Close the WebSocket connection
   */
  close(): void;

  /**
   * Get current connection state
   */
  getState(): WebSocketState;

  /**
   * Check if connected
   */
  isConnected(): boolean;
}
