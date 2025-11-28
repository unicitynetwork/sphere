import { useQuery } from "@tanstack/react-query";
import { NostrService } from "../services/NostrService";
import { KEYS } from "./useWallet";
import { IdentityManager } from "../services/IdentityManager";
import { useEffect } from "react";

const SESSION_KEY = "user-pin-1234";

export const useIncomingTransfers = () => {
  const { data: identity } = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: () => new IdentityManager(SESSION_KEY).getCurrentIdentity(),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!identity) {
      console.log("🔕 Wallet not ready. Nostr standby.");
      return;
    }

    const identityManager = new IdentityManager(SESSION_KEY);
    const nostrService = NostrService.getInstance(identityManager);

    console.log(`🚀 Starting Nostr background service for ${identity.address.slice(0, 8)}...`);
    
    nostrService.start();

    return () => {
      console.log("🛑 Stopping Nostr background service.");
    };
    
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.address]);
};