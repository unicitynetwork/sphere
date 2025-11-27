import { useState, useCallback } from "react";
import {
  createWallet,
  deleteWallet,
  importWallet,
  exportWallet,
  downloadWalletFile,
  generateHDAddress,
  saveWalletToStorage,
  type Wallet,
} from "../sdk";

export function useWalletOperations() {
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleCreateWallet = useCallback(async (): Promise<Wallet> => {
    const w = createWallet();
    return w;
  }, []);

  const handleDeleteWallet = useCallback(() => {
    deleteWallet();
  }, []);

  const handleImportWallet = useCallback(
    async (file: File, password?: string): Promise<{ success: boolean; wallet?: Wallet; error?: string }> => {
      try {
        const result = await importWallet(file, password);

        if (result.success && result.wallet) {
          // Regenerate addresses for BIP32 wallets
          if (result.wallet.isImportedAlphaWallet && result.wallet.chainCode) {
            const addresses = [];
            for (let i = 0; i < (result.wallet.addresses.length || 1); i++) {
              const addr = generateHDAddress(
                result.wallet.masterPrivateKey,
                result.wallet.chainCode,
                i
              );
              addresses.push(addr);
            }
            result.wallet.addresses = addresses;
          }

          // Save to localStorage
          saveWalletToStorage("main", result.wallet);

          return { success: true, wallet: result.wallet };
        } else {
          return { success: false, error: result.error };
        }
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const handleExportWallet = useCallback(
    (wallet: Wallet, filename: string, password?: string) => {
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
    },
    []
  );

  return {
    pendingFile,
    setPendingFile,
    handleCreateWallet,
    handleDeleteWallet,
    handleImportWallet,
    handleExportWallet,
  };
}
