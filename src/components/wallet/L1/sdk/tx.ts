/**
 * Transaction handling for L1 wallet
 *
 * Re-exports from SDK browser module with L1-specific types.
 * Core implementation is in ../../sdk/browser/tx.ts
 */

import { browserProvider } from "./network";
import { vestingState } from "./vestingState";
import { decodeBech32, WalletAddressHelper } from "../../sdk";
import {
  signTransaction,
  selectUtxos,
  broadcastTransactions,
  SATS_PER_COIN,
} from "../../sdk/transaction/transaction";
import type { Wallet, TransactionPlan, Transaction, UTXO } from "./types";

// Re-export SDK transaction building functions for backwards compatibility
export {
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
} from "../../sdk/transaction/transaction";

// Re-export browser tx types (excluding TransactionInput/TransactionOutput which are in ./types)
export type {
  SignedTransaction,
  SendResult,
} from "../../sdk/browser/tx";

/**
 * Create and sign a transaction
 * Uses the private key for the specific address being spent from
 */
export function createAndSignTransaction(
  wallet: Wallet,
  txPlan: Transaction
): { raw: string; txid: string } {
  const fromAddress = txPlan.input.address;
  const addressEntry = wallet.addresses.find(a => a.address === fromAddress);

  let privateKeyHex: string | undefined;

  if (addressEntry?.privateKey) {
    privateKeyHex = addressEntry.privateKey;
  } else if (wallet.childPrivateKey) {
    privateKeyHex = wallet.childPrivateKey;
  } else {
    privateKeyHex = wallet.masterPrivateKey;
  }

  if (!privateKeyHex) {
    throw new Error("No private key available for address: " + fromAddress);
  }

  const txPlanForSign = {
    input: {
      tx_hash: txPlan.input.txid,
      tx_pos: txPlan.input.vout,
      value: txPlan.input.value,
    },
    outputs: txPlan.outputs,
  };

  const tx = signTransaction(txPlanForSign, privateKeyHex);

  return {
    raw: tx.hex,
    txid: tx.txid,
  };
}

/**
 * Collect UTXOs for required amount
 * @deprecated Use selectUtxos from SDK instead
 */
export function collectUtxosForAmount(
  utxoList: UTXO[],
  amountSats: number,
  recipientAddress: string,
  senderAddress: string
): TransactionPlan {
  return selectUtxos(utxoList, amountSats, recipientAddress, senderAddress) as TransactionPlan;
}

/**
 * Create transaction plan from wallet
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

  const defaultAddr = WalletAddressHelper.getDefault(wallet);
  const senderAddress = fromAddress || defaultAddr.address;
  const amountSats = Math.floor(amountAlpha * SATS_PER_COIN);

  let utxos: UTXO[];
  const currentMode = vestingState.getMode();

  if (vestingState.hasClassifiedData(senderAddress)) {
    utxos = vestingState.getFilteredUtxos(senderAddress);
    console.log(`Using ${utxos.length} ${currentMode} UTXOs`);
  } else {
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

  const signedTxs = plan.transactions.map(tx => createAndSignTransaction(wallet, tx));

  return broadcastTransactions(signedTxs, (rawHex) => browserProvider.broadcast(rawHex));
}
