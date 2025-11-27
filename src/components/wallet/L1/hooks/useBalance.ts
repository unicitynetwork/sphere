import { useState, useCallback, useEffect, useRef } from "react";
import { getBalance } from "../sdk";
import { subscribeBlocks } from "../sdk/network";

export function useBalance(initialAddress?: string) {
  const [balance, setBalance] = useState<number>(0);
  const selectedAddressRef = useRef<string>(initialAddress || "");

  const refreshBalance = useCallback(async (addr: string) => {
    if (!addr) return;
    const bal = await getBalance(addr);
    setBalance(bal);
  }, []);

  useEffect(() => {
    selectedAddressRef.current = initialAddress || "";
  }, [initialAddress]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        const unsub = (await subscribeBlocks(() => {
          if (mounted && selectedAddressRef.current) {
            refreshBalance(selectedAddressRef.current);
          }
        }) as unknown) as () => void;

        if (mounted) {
          unsubscribe = unsub;
        } else {
          // If component unmounted before subscription completed, unsubscribe immediately
          unsub();
        }
      } catch (error) {
        console.error("Error subscribing to blocks:", error);
      }
    })();

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [refreshBalance]);

  return {
    balance,
    refreshBalance,
    selectedAddressRef,
  };
}
