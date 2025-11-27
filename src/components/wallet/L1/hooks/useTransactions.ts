import { useState, useCallback } from "react";
import {
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  getTransactionHistory,
  getTransaction,
  getCurrentBlockHeight,
  generateHDAddress,
  type Wallet,
  type TransactionPlan,
  type TransactionHistoryItem,
  type TransactionDetail,
} from "../sdk";

export function useTransactions() {
  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [transactions, setTransactions] = useState<TransactionHistoryItem[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [currentBlockHeight, setCurrentBlockHeight] = useState(0);
  const [transactionDetails, setTransactionDetails] = useState<Record<string, TransactionDetail>>({});
  const [transactionDetailsCache, setTransactionDetailsCache] = useState<Record<string, TransactionDetail>>({});

  const createTxPlan = useCallback(
    async (wallet: Wallet, destination: string, amount: string) => {
      try {
        if (!wallet) return { success: false, error: "No wallet" };
        if (!destination || !amount) {
          return { success: false, error: "Enter destination and amount" };
        }

        const amountAlpha = Number(amount);
        if (isNaN(amountAlpha) || amountAlpha <= 0) {
          return { success: false, error: "Invalid amount" };
        }

        const plan = await createTransactionPlan(wallet, destination, amountAlpha);

        if (!plan.success) {
          return { success: false, error: plan.error };
        }

        setTxPlan(plan);
        return { success: true, plan };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const sendTransaction = useCallback(
    async (wallet: Wallet, plan: TransactionPlan) => {
      if (!plan || !wallet) return { success: false, error: "No plan or wallet" };

      setIsSending(true);
      try {
        const results = [];
        const errors = [];

        for (const tx of plan.transactions) {
          try {
            const signed = createAndSignTransaction(wallet, tx);
            const result = await broadcast(signed.raw);
            results.push({ txid: signed.txid, raw: signed.raw, result });
          } catch (e: unknown) {
            console.error("Broadcast failed for tx", e);
            errors.push(e instanceof Error ? e.message : String(e));
          }
        }

        setTxPlan(null);

        if (errors.length > 0) {
          return {
            success: false,
            error: `Some transactions failed:\n${errors.join("\n")}`,
            results,
          };
        }

        return { success: true, results };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setIsSending(false);
      }
    },
    []
  );

  const loadTransactionHistory = useCallback(async (address: string) => {
    if (!address) return;

    setLoadingTransactions(true);
    try {
      const height = await getCurrentBlockHeight();
      setCurrentBlockHeight(height);

      const history = await getTransactionHistory(address);
      const sorted = [...history].sort((a, b) => {
        if (a.height === 0 && b.height === 0) return 0;
        if (a.height === 0) return -1;
        if (b.height === 0) return 1;
        return b.height - a.height;
      });
      setTransactions(sorted);

      const details: Record<string, TransactionDetail> = {};
      for (const tx of sorted) {
        try {
          const detail = (await getTransaction(tx.tx_hash)) as TransactionDetail;
          details[tx.tx_hash] = detail;
        } catch (err) {
          console.error(`Error loading transaction ${tx.tx_hash}:`, err);
        }
      }
      setTransactionDetails(details);

      // Collect all previous transaction IDs from inputs that we need to fetch
      const requiredPrevTxIds = new Set<string>();
      for (const tx of sorted) {
        const detail = details[tx.tx_hash];
        if (detail?.vin) {
          for (const input of detail.vin) {
            if (input.txid && !transactionDetailsCache[input.txid]) {
              requiredPrevTxIds.add(input.txid);
            }
          }
        }
      }

      console.log(`[loadTransactionHistory] Need to fetch ${requiredPrevTxIds.size} previous transactions`);

      // Fetch missing previous transactions and add to cache
      const newCache = { ...transactionDetailsCache };
      let fetchedCount = 0;
      let failedCount = 0;

      for (const txid of requiredPrevTxIds) {
        try {
          const prevTxDetail = (await getTransaction(txid)) as TransactionDetail;
          newCache[txid] = prevTxDetail;
          fetchedCount++;
        } catch (err) {
          console.error(`Failed to fetch prev tx ${txid}:`, err);
          failedCount++;
        }
      }

      console.log(`[loadTransactionHistory] Fetched ${fetchedCount} prev txs, failed ${failedCount}, cache now has ${Object.keys(newCache).length} entries`);
      setTransactionDetailsCache(newCache);
    } catch (err) {
      console.error("Error loading transactions:", err);
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }, [transactionDetailsCache]);

  const analyzeTransaction = useCallback(
    (tx: TransactionHistoryItem, detail: TransactionDetail | undefined, wallet: Wallet) => {
      if (!detail || !wallet) {
        return {
          direction: "unknown" as const,
          amount: 0,
          fromAddresses: [] as string[],
          toAddresses: [] as string[],
        };
      }

      // Build set of all our addresses including potential change addresses
      const walletAddresses = new Set(wallet.addresses.map((a) => a.address.toLowerCase()));

      // Debug: log our wallet addresses for problematic transactions
      if (detail.txid === '09865cce1160599b5bfa602710fa5c1fb040b964148d884b2610da5c7a2f6dfb' ||
          detail.txid === 'c3c48f4def4a07bf95346cec95eafe35b74f7a8635e9a544c2d331c89b50ec6e') {
        console.log(`[analyzeTransaction] TX ${detail.txid} our wallet addresses:`, Array.from(walletAddresses));
      }

      // IMPORTANT: Also include potential change addresses (first 20)
      // The wallet uses HD derivation for change, we need to check these too
      // Otherwise, change outputs will be counted as "sent to others"
      if (wallet.masterPrivateKey && wallet.chainCode) {
        // Generate first 20 potential change addresses and add them to our address set
        // This matches the behavior of the old wallet (index.html:7939-7952)
        for (let i = 0; i < 20; i++) {
          try {
            // Change addresses use indices 1000000 + i (standard HD wallet gap)
            // Or we might need to check the actual derivation path used by the wallet
            const changeAddr = generateHDAddress(
              wallet.masterPrivateKey,
              wallet.chainCode,
              1000000 + i // Standard change address offset
            );
            walletAddresses.add(changeAddr.address.toLowerCase());
          } catch (err) {
            console.error(`Failed to generate change address ${i}:`, err);
          }
        }
      }

      // Check inputs to determine if this is our transaction (we're spending)
      let isOurInput = false;
      let hasMissingInputData = false;
      let totalInputAmount = 0; // Sum of all input amounts (for fee calculation)
      const fromAddresses: string[] = [];

      if (detail.vin) {
        for (const input of detail.vin) {
          // Skip coinbase transactions (mining/generation) - they have no txid
          if (!input.txid) {
            // This is a coinbase input (newly mined coins) - we're receiving, not spending
            continue;
          }

          // Check cache for the previous transaction
          const prevTx = transactionDetailsCache[input.txid];
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            const addresses =
              prevOutput.scriptPubKey.addresses ||
              (prevOutput.scriptPubKey.address ? [prevOutput.scriptPubKey.address] : []);

            const isOurs = addresses.some((addr) =>
              walletAddresses.has(addr.toLowerCase())
            );

            if (isOurs) {
              isOurInput = true;
              // Add to total input amount for fee calculation
              totalInputAmount += prevOutput.value;
            } else {
              fromAddresses.push(...addresses);
            }
          } else {
            // Previous transaction not in cache - cannot determine input ownership
            hasMissingInputData = true;
            console.warn(`[analyzeTransaction] Missing prev tx ${input.txid} in cache for tx ${detail.txid}`);
          }
        }
      }

      // Analyze outputs to calculate amounts
      let amountToUs = 0;  // What we received (outputs to our addresses)
      let amountToOthers = 0;  // What was sent to others (outputs to non-our addresses)
      const toAddresses: string[] = [];

      for (const output of detail.vout) {
        const addresses =
          output.scriptPubKey.addresses ||
          (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);

        const isOurOutput = addresses.some((addr) =>
          walletAddresses.has(addr.toLowerCase())
        );

        if (isOurOutput) {
          amountToUs += output.value;
        } else {
          amountToOthers += output.value;
          toAddresses.push(...addresses);
        }

        // Debug: log all outputs for problematic transactions
        if (detail.txid === '09865cce1160599b5bfa602710fa5c1fb040b964148d884b2610da5c7a2f6dfb' ||
            detail.txid === 'c3c48f4def4a07bf95346cec95eafe35b74f7a8635e9a544c2d331c89b50ec6e') {
          console.log(`[analyzeTransaction] TX ${detail.txid} output:`, {
            addresses,
            value: output.value,
            isOurOutput,
            inOurAddressSet: addresses.map(a => ({
              addr: a,
              inSet: walletAddresses.has(a.toLowerCase())
            }))
          });
        }
      }

      // Determine direction based on inputs (like old wallet):
      // If ANY input is ours -> SENT (outgoing)
      // If NO inputs are ours -> RECEIVED (incoming)
      let direction: "sent" | "received";
      let amount: number;

      if (hasMissingInputData) {
        // Fallback: if we're missing input data, try to infer from outputs
        // If we have outputs to us but none to others -> likely RECEIVED
        // If we have outputs to others -> likely SENT
        if (amountToUs > 0 && amountToOthers === 0) {
          direction = "received";
          amount = amountToUs;
        } else if (amountToOthers > 0) {
          direction = "sent";
          amount = amountToOthers;
        } else {
          // Unknown case
          direction = "received";
          amount = amountToUs;
        }
        console.warn(`[analyzeTransaction] Using fallback direction for tx ${detail.txid}: ${direction}, amountToUs=${amountToUs}, amountToOthers=${amountToOthers}`);
      } else {
        // Normal case: we have complete input data
        direction = isOurInput ? "sent" : "received";

        if (direction === "sent") {
          if (amountToOthers > 0) {
            // Normal send: we sent to other addresses
            amount = amountToOthers;
          } else {
            // Special case: all outputs are back to us (internal transfer/consolidation)
            // Show only the fee amount (like old wallet does at index.html:8144-8148)
            // Fee = total inputs - total outputs
            const totalOutputAmount = amountToUs; // All outputs are to us
            const fee = totalInputAmount - totalOutputAmount;
            amount = fee > 0 ? fee : 0;
            console.log(`[analyzeTransaction] Internal transfer detected for tx ${detail.txid}: all outputs to our addresses, showing fee ${fee} ALPHA`);
          }
        } else {
          // Incoming transaction
          amount = amountToUs;
        }

        // Debug logging for problematic transactions
        if (amount === 0 || amount < 0.00001) {
          console.warn(`[analyzeTransaction] Small/zero amount for tx ${detail.txid}:`, {
            direction,
            isOurInput,
            amountToUs,
            amountToOthers,
            finalAmount: amount,
            voutCount: detail.vout.length,
            vinCount: detail.vin?.length || 0
          });
        }
      }

      return {
        direction,
        amount: amount, // output.value is already in ALPHA (decimal), not satoshis
        fromAddresses,
        toAddresses,
      };
    },
    [transactionDetailsCache]
  );

  return {
    txPlan,
    setTxPlan,
    isSending,
    transactions,
    loadingTransactions,
    currentBlockHeight,
    transactionDetails,
    createTxPlan,
    sendTransaction,
    loadTransactionHistory,
    analyzeTransaction,
  };
}
