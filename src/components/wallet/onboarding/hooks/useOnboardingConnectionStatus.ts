/**
 * useOnboardingConnectionStatus - Manages L1 WebSocket connection for onboarding
 * Similar to L1's useConnectionStatus but simplified for onboarding needs
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { connect, isWebSocketConnected, disconnect } from "../../L1/sdk/network";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ConnectionStatus {
  state: ConnectionState;
  message: string;
  error?: string;
}

export function useOnboardingConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(() => ({
    state: isWebSocketConnected() ? "connected" : "disconnected",
    message: isWebSocketConnected() ? "Connected to Fulcrum" : "Not connected",
  }));

  const isMountedRef = useRef(true);
  const isConnectingRef = useRef(false);

  const attemptConnect = useCallback(async () => {
    if (!isMountedRef.current || isConnectingRef.current) return;

    isConnectingRef.current = true;

    setStatus({
      state: "connecting",
      message: "Connecting to Fulcrum server...",
    });

    try {
      await connect();

      if (!isMountedRef.current) return;

      setStatus({
        state: "connected",
        message: "Connected to Fulcrum",
      });
    } catch (err) {
      if (!isMountedRef.current) return;

      const errorMessage = err instanceof Error ? err.message : "Connection failed";

      setStatus({
        state: "error",
        message: "Connection failed after multiple attempts",
        error: errorMessage,
      });
    } finally {
      isConnectingRef.current = false;
    }
  }, []);

  const manualConnect = useCallback(() => {
    attemptConnect();
  }, [attemptConnect]);

  const cancelConnect = useCallback(() => {
    isConnectingRef.current = false;
    disconnect();
    setStatus({
      state: "disconnected",
      message: "Connection cancelled",
    });
  }, []);

  // Initial connection on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (!isWebSocketConnected()) {
      attemptConnect();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [attemptConnect]);

  // Monitor connection state changes
  useEffect(() => {
    const checkConnection = () => {
      if (!isMountedRef.current) return;

      const connected = isWebSocketConnected();

      if (connected && status.state !== "connected") {
        setStatus({
          state: "connected",
          message: "Connected to Fulcrum",
        });
      } else if (!connected && status.state === "connected") {
        // Connection was lost, start reconnecting
        attemptConnect();
      }
    };

    const interval = setInterval(checkConnection, 2000);
    return () => clearInterval(interval);
  }, [status.state, attemptConnect]);

  return {
    ...status,
    isConnected: status.state === "connected",
    isConnecting: status.state === "connecting",
    manualConnect,
    cancelConnect,
  };
}
