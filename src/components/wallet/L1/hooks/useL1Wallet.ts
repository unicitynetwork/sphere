import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  importWallet,
  exportWallet,
  downloadWalletFile,
  generateHDAddress,
  generateHDAddressBIP32,
  getBalance,
  getTransactionHistory,
  getTransaction,
  getCurrentBlockHeight,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  getUtxo,
  vestingState,
  type Wallet,
  type TransactionHistoryItem,
  type TransactionDetail,
  type VestingMode,
  type VestingBalances,
} from "../sdk";
import { subscribeBlocks } from "../sdk/network";
import { loadWalletFromUnifiedKeyManager, getUnifiedKeyManager } from "../sdk/unifiedWalletBridge";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { WalletRepository } from "../../../../repositories/WalletRepository";

// Query keys for L1 wallet
export const L1_KEYS = {
  WALLET: ["l1", "wallet"],
  BALANCE: (address: string) => ["l1", "balance", address],
  TOTAL_BALANCE: ["l1", "totalBalance"],
  TRANSACTIONS: (address: string) => ["l1", "transactions", address],
  BLOCK_HEIGHT: ["l1", "blockHeight"],
  VESTING: (address: string) => ["l1", "vesting", address],
};


export function useL1Wallet(selectedAddress?: string) {
  const queryClient = useQueryClient();
  const selectedAddressRef = useRef<string>(selectedAddress || "");

  // Update ref when address changes
  useEffect(() => {
    selectedAddressRef.current = selectedAddress || "";
  }, [selectedAddress]);

  // Subscribe to new blocks for auto-refresh
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        const unsub = (await subscribeBlocks(() => {
          if (mounted && selectedAddressRef.current) {
            // Invalidate balance, transactions and vesting on new block
            queryClient.invalidateQueries({
              queryKey: L1_KEYS.BALANCE(selectedAddressRef.current),
            });
            queryClient.invalidateQueries({
              queryKey: L1_KEYS.TOTAL_BALANCE,
            });
            queryClient.invalidateQueries({
              queryKey: L1_KEYS.TRANSACTIONS(selectedAddressRef.current),
            });
            queryClient.invalidateQueries({
              queryKey: L1_KEYS.VESTING(selectedAddressRef.current),
            });
            queryClient.invalidateQueries({
              queryKey: L1_KEYS.BLOCK_HEIGHT,
            });
          }
        }) as unknown) as () => void;

        if (mounted) {
          unsubscribe = unsub;
        } else {
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
  }, [queryClient]);

  // Query: Wallet from UnifiedKeyManager
  const walletQuery = useQuery({
    queryKey: L1_KEYS.WALLET,
    queryFn: async () => {
      const wallet = await loadWalletFromUnifiedKeyManager();
      return wallet;
    },
    staleTime: Infinity, // Wallet doesn't change unless we mutate it
  });

  // Query: Balance for selected address
  const balanceQuery = useQuery({
    queryKey: L1_KEYS.BALANCE(selectedAddress || ""),
    queryFn: () => getBalance(selectedAddress!),
    enabled: !!selectedAddress,
    staleTime: 30000, // 30 seconds
  });

  // Query: Total balance for all addresses
  const totalBalanceQuery = useQuery({
    queryKey: [...L1_KEYS.TOTAL_BALANCE, walletQuery.data?.addresses.map(a => a.address).join(",")],
    queryFn: async () => {
      const wallet = walletQuery.data;
      if (!wallet || wallet.addresses.length === 0) return 0;

      const balances = await Promise.all(
        wallet.addresses.map(addr => getBalance(addr.address))
      );
      return balances.reduce((sum, bal) => sum + bal, 0);
    },
    enabled: !!walletQuery.data && walletQuery.data.addresses.length > 0,
    staleTime: 30000, // 30 seconds
  });

  // Query: Current block height
  const blockHeightQuery = useQuery({
    queryKey: L1_KEYS.BLOCK_HEIGHT,
    queryFn: getCurrentBlockHeight,
    staleTime: 60000, // 1 minute
  });

  // Query: Transaction history
  const transactionsQuery = useQuery({
    queryKey: L1_KEYS.TRANSACTIONS(selectedAddress || ""),
    queryFn: async () => {
      if (!selectedAddress) return { transactions: [], details: {} };

      const history = await getTransactionHistory(selectedAddress);
      const sorted = [...history].sort((a, b) => {
        if (a.height === 0 && b.height === 0) return 0;
        if (a.height === 0) return -1;
        if (b.height === 0) return 1;
        return b.height - a.height;
      });

      // Fetch details for each transaction
      const details: Record<string, TransactionDetail> = {};
      for (const tx of sorted) {
        try {
          const detail = (await getTransaction(tx.tx_hash)) as TransactionDetail;
          details[tx.tx_hash] = detail;
        } catch (err) {
          console.error(`Error loading transaction ${tx.tx_hash}:`, err);
        }
      }

      return { transactions: sorted, details };
    },
    enabled: !!selectedAddress,
    staleTime: 30000,
  });

  // Query: Vesting balances for selected address
  const vestingQuery = useQuery({
    queryKey: L1_KEYS.VESTING(selectedAddress || ""),
    queryFn: async (): Promise<{
      balances: VestingBalances;
      mode: VestingMode;
      isClassifying: boolean;
    }> => {
      if (!selectedAddress) {
        return {
          balances: { vested: 0n, unvested: 0n, all: 0n },
          mode: vestingState.getMode(),
          isClassifying: false,
        };
      }

      // Get UTXOs and classify them
      const utxos = await getUtxo(selectedAddress);

      if (utxos.length > 0) {
        await vestingState.classifyAddressUtxos(selectedAddress, utxos);
      }

      return {
        balances: vestingState.getAllBalances(selectedAddress),
        mode: vestingState.getMode(),
        isClassifying: vestingState.isClassifying(),
      };
    },
    enabled: !!selectedAddress,
    staleTime: 60000, // 1 minute - vesting classification is expensive
  });

  // Mutation: Create new wallet via UnifiedKeyManager
  const createWalletMutation = useMutation({
    mutationFn: async () => {
      const keyManager = getUnifiedKeyManager();
      await keyManager.generateNew(12);
      // Load the wallet from UnifiedKeyManager
      const wallet = await loadWalletFromUnifiedKeyManager();
      if (!wallet) {
        throw new Error("Failed to create wallet");
      }
      return wallet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
      // Also invalidate L3 queries since wallet changed
      queryClient.invalidateQueries({ queryKey: ["l3", "identity"] });
      queryClient.invalidateQueries({ queryKey: ["l3", "nametag"] });
      queryClient.invalidateQueries({ queryKey: ["l3", "tokens"] });
    },
  });

  // Mutation: Import wallet from file via UnifiedKeyManager
  const importWalletMutation = useMutation({
    mutationFn: async ({
      file,
      password,
    }: {
      file: File;
      password?: string;
    }) => {
      const keyManager = getUnifiedKeyManager();

      // Read file content
      const content = await file.text();

      // Use UnifiedKeyManager's import (handles decryption if needed)
      if (password) {
        // For encrypted files, use the SDK's importWallet to decrypt first
        const result = await importWallet(file, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        // Then import the decrypted content via UnifiedKeyManager
        // Construct a text file format from the decrypted wallet
        const masterKey = result.wallet.masterPrivateKey;
        const chainCode = result.wallet.chainCode;
        let textContent = `MASTER PRIVATE KEY:\n${masterKey}`;
        if (chainCode) {
          textContent += `\n\nMASTER CHAIN CODE:\n${chainCode}`;
        }
        await keyManager.importFromFileContent(textContent);
      } else {
        // For unencrypted txt files, import directly
        await keyManager.importFromFileContent(content);
      }

      // Load the wallet from UnifiedKeyManager
      const wallet = await loadWalletFromUnifiedKeyManager();
      if (!wallet) {
        throw new Error("Failed to import wallet");
      }
      return wallet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
      // Also invalidate L3 queries since wallet changed
      queryClient.invalidateQueries({ queryKey: ["l3", "identity"] });
      queryClient.invalidateQueries({ queryKey: ["l3", "nametag"] });
      queryClient.invalidateQueries({ queryKey: ["l3", "tokens"] });
    },
  });

  // Mutation: Delete wallet via UnifiedKeyManager
  const deleteWalletMutation = useMutation({
    mutationFn: async () => {
      // 1. Clear UnifiedKeyManager localStorage and reset singleton
      const keyManager = getUnifiedKeyManager();
      keyManager.clear();
      UnifiedKeyManager.resetInstance();

      // 2. Clear IdentityManager selected index
      localStorage.removeItem("l3_selected_address_index");

      // 3. Reset WalletRepository in-memory state (keeps localStorage intact for tokens/nametags)
      WalletRepository.getInstance().resetInMemoryState();
    },
    onSuccess: () => {
      // Clear ALL L1 queries
      queryClient.removeQueries({ queryKey: ["l1"] });

      // Clear ALL L3 queries
      queryClient.removeQueries({ queryKey: ["l3"] });

      // Force page reload for clean state
      window.location.reload();
    },
  });

  // Mutation: Send transaction
  const sendTransactionMutation = useMutation({
    mutationFn: async ({
      wallet,
      destination,
      amount,
      fromAddress,
    }: {
      wallet: Wallet;
      destination: string;
      amount: string;
      fromAddress?: string;
    }) => {
      const amountAlpha = Number(amount);
      if (isNaN(amountAlpha) || amountAlpha <= 0) {
        throw new Error("Invalid amount");
      }

      const plan = await createTransactionPlan(
        wallet,
        destination,
        amountAlpha,
        fromAddress
      );

      if (!plan.success) {
        throw new Error(plan.error || "Failed to create transaction plan");
      }

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

      if (errors.length > 0) {
        throw new Error(`Some transactions failed:\n${errors.join("\n")}`);
      }

      return results;
    },
    onSuccess: () => {
      // Invalidate balance and transactions after sending
      if (selectedAddress) {
        queryClient.invalidateQueries({
          queryKey: L1_KEYS.BALANCE(selectedAddress),
        });
        queryClient.invalidateQueries({
          queryKey: L1_KEYS.TRANSACTIONS(selectedAddress),
        });
      }
    },
  });

  // Export wallet utility (not a mutation since it doesn't change state)
  const handleExportWallet = (
    wallet: Wallet,
    filename: string,
    password?: string
  ) => {
    try {
      const content = exportWallet(wallet, {
        password: password || undefined,
        filename: filename,
      });
      downloadWalletFile(content, filename);
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Analyze transaction helper
  const analyzeTransaction = (
    _tx: TransactionHistoryItem,
    detail: TransactionDetail | undefined,
    wallet: Wallet,
    currentAddress?: string
  ) => {
    if (!detail || !wallet) {
      return {
        direction: "unknown" as const,
        amount: 0,
        fromAddresses: [] as string[],
        toAddresses: [] as string[],
      };
    }

    const walletAddresses = new Set(
      wallet.addresses.map((a) => a.address.toLowerCase())
    );
    const selectedAddr = currentAddress?.toLowerCase();

    // Include potential change addresses
    if (wallet.masterPrivateKey && wallet.chainCode) {
      // Use descriptorPath if available for BIP32 wallets
      const basePath = wallet.descriptorPath
        ? `m/${wallet.descriptorPath}`
        : wallet.isImportedAlphaWallet
          ? "m/84'/1'/0'"
          : null;

      for (let i = 0; i < 20; i++) {
        try {
          let changeAddr;
          if (basePath) {
            // BIP32 change addresses use chain 1
            changeAddr = generateHDAddressBIP32(
              wallet.masterPrivateKey,
              wallet.chainCode,
              i,
              basePath,
              true // isChange = true
            );
          } else {
            // Legacy derivation
            changeAddr = generateHDAddress(
              wallet.masterPrivateKey,
              wallet.chainCode,
              1000000 + i
            );
          }
          walletAddresses.add(changeAddr.address.toLowerCase());
        } catch (err) {
          console.error(`Failed to generate change address ${i}:`, err);
        }
      }
    }

    // Get cached transaction details for input analysis
    const cachedDetails = transactionsQuery.data?.details || {};

    let isOurInput = false;
    let totalInputAmount = 0;
    const allInputAddresses: string[] = [];

    if (detail.vin) {
      for (const input of detail.vin) {
        if (!input.txid) continue;

        const prevTx = cachedDetails[input.txid];
        if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
          const prevOutput = prevTx.vout[input.vout];
          const addresses =
            prevOutput.scriptPubKey.addresses ||
            (prevOutput.scriptPubKey.address
              ? [prevOutput.scriptPubKey.address]
              : []);

          allInputAddresses.push(...addresses);

          const isFromCurrentAddress = selectedAddr
            ? addresses.some((addr) => addr.toLowerCase() === selectedAddr)
            : addresses.some((addr) => walletAddresses.has(addr.toLowerCase()));

          if (isFromCurrentAddress) {
            isOurInput = true;
            totalInputAmount += prevOutput.value;
          }
        }
      }
    }

    let amountToUs = 0;
    let amountToOthers = 0;
    const toAddresses: string[] = [];
    const allOutputAddresses: string[] = [];

    for (const output of detail.vout) {
      const addresses =
        output.scriptPubKey.addresses ||
        (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);

      allOutputAddresses.push(...addresses);

      const isToCurrentAddress = selectedAddr
        ? addresses.some((addr) => addr.toLowerCase() === selectedAddr)
        : addresses.some((addr) => walletAddresses.has(addr.toLowerCase()));

      if (isToCurrentAddress) {
        amountToUs += output.value;
      } else {
        amountToOthers += output.value;
        toAddresses.push(...addresses);
      }
    }

    const direction: "sent" | "received" = isOurInput ? "sent" : "received";
    let amount: number;

    if (direction === "sent") {
      if (amountToOthers > 0) {
        amount = amountToOthers;
      } else {
        const totalOutputAmount = amountToUs;
        const fee = totalInputAmount - totalOutputAmount;
        amount = fee > 0 ? fee : 0;
      }
    } else {
      amount = amountToUs;
    }

    let finalFromAddresses: string[] = [];
    let finalToAddresses: string[] = [];

    if (direction === "sent") {
      finalToAddresses =
        toAddresses.length > 0 ? toAddresses : allOutputAddresses;
    } else {
      finalFromAddresses = selectedAddr
        ? allInputAddresses
        : allInputAddresses.filter(
            (addr) => !walletAddresses.has(addr.toLowerCase())
          );
    }

    return {
      direction,
      amount,
      fromAddresses: finalFromAddresses,
      toAddresses: finalToAddresses,
    };
  };

  // Set vesting mode
  const setVestingMode = (mode: VestingMode) => {
    vestingState.setMode(mode);
    if (selectedAddress) {
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.VESTING(selectedAddress),
      });
    }
  };

  // Manual refresh function
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });
    if (selectedAddress) {
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.BALANCE(selectedAddress),
      });
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.TRANSACTIONS(selectedAddress),
      });
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.VESTING(selectedAddress),
      });
    }
  };

  return {
    // Wallet state
    wallet: walletQuery.data,
    isLoadingWallet: walletQuery.isLoading,

    // Balance state
    balance: balanceQuery.data ?? 0,
    totalBalance: totalBalanceQuery.data ?? 0,
    isLoadingBalance: balanceQuery.isLoading,

    // Transaction state
    transactions: transactionsQuery.data?.transactions ?? [],
    transactionDetails: transactionsQuery.data?.details ?? {},
    isLoadingTransactions: transactionsQuery.isLoading,

    // Block height
    currentBlockHeight: blockHeightQuery.data ?? 0,

    // Vesting state
    vestingBalances: vestingQuery.data?.balances ?? { vested: 0n, unvested: 0n, all: 0n },
    vestingMode: vestingQuery.data?.mode ?? "all",
    isLoadingVesting: vestingQuery.isLoading,
    isClassifyingVesting: vestingQuery.data?.isClassifying ?? false,

    // Mutations
    createWallet: createWalletMutation.mutateAsync,
    isCreatingWallet: createWalletMutation.isPending,

    importWallet: importWalletMutation.mutateAsync,
    isImportingWallet: importWalletMutation.isPending,
    importError: importWalletMutation.error,

    deleteWallet: deleteWalletMutation.mutateAsync,
    isDeletingWallet: deleteWalletMutation.isPending,

    sendTransaction: sendTransactionMutation.mutateAsync,
    isSendingTransaction: sendTransactionMutation.isPending,
    sendError: sendTransactionMutation.error,

    // Utilities
    exportWallet: handleExportWallet,
    analyzeTransaction,
    refreshAll,
    setVestingMode,

    // Direct query client access for advanced use cases
    invalidateWallet: () =>
      queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET }),
    invalidateBalance: () =>
      selectedAddress &&
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.BALANCE(selectedAddress),
      }),
    invalidateTransactions: () =>
      selectedAddress &&
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.TRANSACTIONS(selectedAddress),
      }),
    invalidateVesting: () =>
      selectedAddress &&
      queryClient.invalidateQueries({
        queryKey: L1_KEYS.VESTING(selectedAddress),
      }),
  };
}
