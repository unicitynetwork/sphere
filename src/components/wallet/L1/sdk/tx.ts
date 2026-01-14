/**
 * Transaction handling for L1 wallet
 *
 * Uses pure transaction functions from SDK.
 * Only browser-specific parts (browserProvider, vestingState) remain here.
 */
import { browserProvider } from "./network";
import { decodeBech32, WalletAddressHelper } from "../../sdk";
import {
  signTransaction,
  selectUtxos,
  broadcastTransactions,
  SATS_PER_COIN,
} from "../../sdk/transaction/transaction";
import type { Wallet, TransactionPlan, Transaction, UTXO } from "./types";
import { vestingState } from "./vestingState";

// Re-export SDK transaction building functions for backwards compatibility
export {
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
} from "../../sdk/transaction/transaction";


/**
 * Create and sign a transaction
 * Uses the private key for the specific address being spent from
 */
export function createAndSignTransaction(
  wallet: Wallet,
  txPlan: Transaction
): { raw: string; txid: string } {
  // Find the address entry that matches the input address
  const fromAddress = txPlan.input.address;
  const addressEntry = wallet.addresses.find(a => a.address === fromAddress);

  // Use the private key from the address entry, or fall back to childPrivateKey/masterPrivateKey
  let privateKeyHex: string | undefined;

  if (addressEntry?.privateKey) {
    // Use the specific private key for this address
    privateKeyHex = addressEntry.privateKey;
  } else if (wallet.childPrivateKey) {
    // Fall back to childPrivateKey (first address)
    privateKeyHex = wallet.childPrivateKey;
  } else {
    // Last resort: use master key
    privateKeyHex = wallet.masterPrivateKey;
  }

  if (!privateKeyHex) {
    throw new Error("No private key available for address: " + fromAddress);
  }

  // Convert Transaction to the format expected by SDK signTransaction
  const txPlanForSign = {
    input: {
      tx_hash: txPlan.input.txid,
      tx_pos: txPlan.input.vout,
      value: txPlan.input.value,
    },
    outputs: txPlan.outputs,
  };

  // Use SDK signTransaction
  const tx = signTransaction(txPlanForSign, privateKeyHex);

  return {
    raw: tx.hex,
    txid: tx.txid,
  };
}

/**
 * Collect UTXOs for required amount
 * @deprecated Use selectUtxos from SDK instead
 *
 * Wrapper around SDK selectUtxos for backwards compatibility.
 */
export function collectUtxosForAmount(
  utxoList: UTXO[],
  amountSats: number,
  recipientAddress: string,
  senderAddress: string
): TransactionPlan {
  // Use SDK selectUtxos - types are compatible
  return selectUtxos(utxoList, amountSats, recipientAddress, senderAddress) as TransactionPlan;
}

/**
 * Create transaction plan from wallet
 * @param wallet - The wallet
 * @param toAddress - Recipient address
 * @param amountAlpha - Amount in ALPHA
 * @param fromAddress - Optional: specific address to send from (defaults to first address)
 */
export async function createTransactionPlan(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
): Promise<TransactionPlan> {
  if (!decodeBech32(toAddress)) {
    throw new Error("Invalid recipient address");
  }

  // Use specified fromAddress or default to first external address
  const defaultAddr = WalletAddressHelper.getDefault(wallet);
  const senderAddress = fromAddress || defaultAddr.address;
  const amountSats = Math.floor(amountAlpha * SATS_PER_COIN);

  // Get UTXOs filtered by current vesting mode (set in SendModal)
  let utxos: UTXO[];
  const currentMode = vestingState.getMode();

  if (vestingState.hasClassifiedData(senderAddress)) {
    // Use vesting-filtered UTXOs based on selected mode
    utxos = vestingState.getFilteredUtxos(senderAddress);
    console.log(`Using ${utxos.length} ${currentMode} UTXOs`);
  } else {
    // Fall back to all UTXOs if not yet classified
    utxos = await browserProvider.getUtxos(senderAddress);
    console.log(`Using ${utxos.length} UTXOs (vesting not classified yet)`);
  }

  if (!Array.isArray(utxos) || utxos.length === 0) {
    const modeText = currentMode !== 'all' ? ` (${currentMode} coins)` : '';
    throw new Error(`No UTXOs available${modeText} for address: ` + senderAddress);
  }

  return collectUtxosForAmount(utxos, amountSats, toAddress, senderAddress);
}

/**
 * Send ALPHA to address
 * @param wallet - The wallet
 * @param toAddress - Recipient address
 * @param amountAlpha - Amount in ALPHA
 * @param fromAddress - Optional: specific address to send from
 */
export async function sendAlpha(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
) {
  const plan = await createTransactionPlan(wallet, toAddress, amountAlpha, fromAddress);

  if (!plan.success) {
    throw new Error(plan.error || "Transaction planning failed");
  }

  // Sign all transactions
  const signedTxs = plan.transactions.map(tx => createAndSignTransaction(wallet, tx));

  // Broadcast using SDK function with browser provider
  return broadcastTransactions(signedTxs, (rawHex) => browserProvider.broadcast(rawHex));
}
