import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IdentityManager } from "../services/IdentityManager";
import { NostrService } from "../services/NostrService";
import { TransferService } from "../services/TransferService";
import { KEYS } from "./useWallet";

const SESSION_KEY = "user-pin-1234";

export const useIncomingTransfers = () => {
  const queryClient = useQueryClient();

  const { data: identity } = useQuery({
    queryKey: KEYS.IDENTITY,
    queryFn: () => new IdentityManager(SESSION_KEY).getCurrentIdentity(),
    staleTime: Infinity, // Не дергать лишний раз
  });

  useEffect(() => {
    if (!identity) {
      console.log("🔕 No wallet found. Listener paused.");
      return;
    }

    console.log(`🎧 Identity found. Starting listener...`);
    const identityManager = new IdentityManager(SESSION_KEY);
    const nostrService = NostrService.getInstance(identityManager);
    const transferService = TransferService.getInstance(identityManager);

    const startListening = async () => {
      await nostrService.listenForTransfers(async (payloadJson) => {
        console.log("📦 Incoming transfer package received!");

        await transferService.handleIncomingPackage(payloadJson);

        await queryClient.refetchQueries({ queryKey: KEYS.TOKENS });
        await queryClient.refetchQueries({ queryKey: KEYS.AGGREGATED });
      });
    };

    startListening();

    return () => {
      nostrService.stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.address, queryClient]);
};
