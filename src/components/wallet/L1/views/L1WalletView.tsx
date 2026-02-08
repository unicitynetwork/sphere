import { useState, useCallback } from "react";
import { useL1Balance, useL1Send } from "../../../../sdk";
import { useSphereContext } from "../../../../sdk/hooks/core/useSphere";
import { useIdentity } from "../../../../sdk";
import { MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [isSending, setIsSending] = useState(false);
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });

  // SDK hooks
  const { balance: l1BalanceData } = useL1Balance();
  const { sphere, deleteWallet } = useSphereContext();
  const { l1Address } = useIdentity();
  const { send: l1Send } = useL1Send();

  const selectedAddress = l1Address ?? "";

  // Derive balance values
  const balance = l1BalanceData
    ? Number(l1BalanceData.total) / 1e8
    : 0;
  const totalBalance = balance;

  // Vesting balances from SDK L1 data
  const vestingBalances = l1BalanceData ? {
    vested: BigInt(l1BalanceData.vested),
    unvested: BigInt(l1BalanceData.unvested),
    all: BigInt(l1BalanceData.total),
  } : { vested: 0n, unvested: 0n, all: 0n };

  // Message helpers
  const showMessage = useCallback((type: MessageType, title: string, message: string, txids?: string[]) => {
    setMessageModal({ show: true, type, title, message, txids });
  }, []);

  const closeMessage = useCallback(() => {
    setMessageModal((prev) => ({ ...prev, show: false }));
  }, []);

  // Delete wallet
  const onDeleteWallet = async () => {
    try {
      await deleteWallet();
    } catch {
      showMessage("error", "Error", "Failed to delete wallet");
    }
  };

  // Check if mnemonic is available
  const hasMnemonic = sphere?.getMnemonic() !== null;

  // Save wallet as JSON (using SDK export)
  const onSaveWallet = async (filename: string, password?: string) => {
    if (!sphere) {
      showMessage("warning", "No Wallet", "No wallet to save");
      return;
    }

    try {
      const jsonData = await sphere.exportToJSON({ password, includeMnemonic: true });
      const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage("success", "Wallet Saved", "Wallet saved as JSON successfully!");
    } catch (err) {
      showMessage("error", "Save Error", `Error saving wallet: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Send transaction via SDK L1
  const onSendTransaction = async (destination: string, amount: string) => {
    const amountAlpha = Number(amount);
    if (isNaN(amountAlpha) || amountAlpha <= 0) {
      showMessage("error", "Invalid Amount", "Please enter a valid amount");
      return;
    }

    setIsSending(true);
    try {
      // SDK L1 send expects amount in satoshis as string
      const amountSatoshis = Math.round(amountAlpha * 1e8).toString();
      const result = await l1Send({
        toAddress: destination,
        amount: amountSatoshis,
      });

      showMessage(
        "success",
        "Transaction Sent",
        "Transaction sent successfully!",
        result.txHash ? [result.txHash] : undefined
      );
    } catch (err) {
      showMessage(
        "error",
        "Transaction Failed",
        "Transaction failed: " + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setIsSending(false);
    }
  };

  // No wallet
  if (!sphere) {
    return null;
  }

  // Main view - simplified (SDK handles connections internally)
  return (
    <div className="h-full">
      <MainWalletView
        selectedAddress={selectedAddress}
        selectedPrivateKey=""
        addresses={selectedAddress ? [selectedAddress] : []}
        balance={balance}
        totalBalance={totalBalance}
        showBalances={showBalances}
        onShowHistory={() => {}}
        onSaveWallet={onSaveWallet}
        hasMnemonic={hasMnemonic}
        onDeleteWallet={onDeleteWallet}
        onSendTransaction={onSendTransaction}
        txPlan={null}
        isSending={isSending}
        onConfirmSend={async () => {}}
        vestingBalances={vestingBalances}
      />
      <MessageModal
        show={messageModal.show}
        type={messageModal.type}
        title={messageModal.title}
        message={messageModal.message}
        txids={messageModal.txids}
        onClose={closeMessage}
      />
    </div>
  );
}
