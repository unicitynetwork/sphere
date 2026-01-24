/**
 * Browser Transaction Helpers
 *
 * Browser-specific transaction creation and broadcasting.
 * Uses BrowserNetworkProvider and VestingStateManager.
 */

import { getBrowserProvider } from '../network';
import { getVestingState } from '../vesting';
import { decodeBech32 } from '../../address/bech32';
import { WalletAddressHelper } from '../../address/addressHelpers';
import {
  signTransaction,
  selectUtxos,
  broadcastTransactions,
  SATS_PER_COIN,
} from '../../transaction/transaction';
import type { BaseWallet, L1UTXO } from '../../types';

// Re-export SDK transaction functions
export {
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
} from '../../transaction/transaction';

// Import and re-export SendResult from wallets module (single source of truth)
import type { SendResult } from '../../wallets/L1Wallet';
export type { SendResult };

// ==========================================
// Types
// ==========================================

export interface TransactionInput {
  txid: string;
  vout: number;
  value: number;
  address: string;
}

export interface TransactionOutput {
  value: number;
  address: string;
}

export interface Transaction {
  input: TransactionInput;
  outputs: TransactionOutput[];
  fee: number;
  changeAmount: number;
  changeAddress: string;
}

export interface TransactionPlan {
  success: boolean;
  transactions: Transaction[];
  error?: string;
}

export interface SignedTransaction {
  raw: string;
  txid: string;
}

// ==========================================
// Transaction Functions
// ==========================================

/**
 * Create and sign a transaction
 * Uses the private key for the specific address being spent from
 */
export function createAndSignTransaction(
  wallet: BaseWallet,
  txPlan: Transaction
): SignedTransaction {
  // Find the address entry that matches the input address
  const fromAddress = txPlan.input.address;
  const addressEntry = wallet.addresses.find(a => a.address === fromAddress);

  // Use the private key from the address entry, or fall back to childPrivateKey/masterPrivateKey
  let privateKeyHex: string | undefined;

  if (addressEntry?.privateKey) {
    privateKeyHex = addressEntry.privateKey;
  } else if (wallet.childPrivateKey) {
    privateKeyHex = wallet.childPrivateKey;
  } else {
    privateKeyHex = wallet.masterPrivateKey;
  }

  if (!privateKeyHex) {
    throw new Error('No private key available for address: ' + fromAddress);
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

  const tx = signTransaction(txPlanForSign, privateKeyHex);

  return {
    raw: tx.hex,
    txid: tx.txid,
  };
}

/**
 * Collect UTXOs for required amount
 *
 * Wrapper around SDK selectUtxos for backwards compatibility.
 */
export function collectUtxosForAmount(
  utxoList: L1UTXO[],
  amountSats: number,
  recipientAddress: string,
  senderAddress: string
): TransactionPlan {
  return selectUtxos(utxoList, amountSats, recipientAddress, senderAddress) as TransactionPlan;
}

/**
 * Create transaction plan from wallet
 *
 * Uses vesting state to filter UTXOs based on current mode.
 */
export async function createTransactionPlan(
  wallet: BaseWallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
): Promise<TransactionPlan> {
  if (!decodeBech32(toAddress)) {
    throw new Error('Invalid recipient address');
  }

  const defaultAddr = WalletAddressHelper.getDefault(wallet);
  const senderAddress = fromAddress || defaultAddr.address;
  const amountSats = Math.floor(amountAlpha * SATS_PER_COIN);

  const vestingState = getVestingState();
  const browserProvider = getBrowserProvider();

  // Get UTXOs filtered by current vesting mode
  let utxos: L1UTXO[];
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
  wallet: BaseWallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
): Promise<SendResult> {
  const plan = await createTransactionPlan(wallet, toAddress, amountAlpha, fromAddress);

  if (!plan.success) {
    return {
      success: false,
      txids: [],
      error: plan.error || 'Transaction planning failed',
    };
  }

  // Sign all transactions
  const signedTxs = plan.transactions.map(tx => createAndSignTransaction(wallet, tx));

  // Broadcast using SDK function with browser provider
  const browserProvider = getBrowserProvider();
  const results = await broadcastTransactions(
    signedTxs,
    (rawHex) => browserProvider.broadcast(rawHex)
  );

  return {
    success: true,
    txids: results.map(r => r.txid),
  };
}

/**
 * Broadcast raw transaction hex
 */
export async function broadcastTransaction(rawHex: string): Promise<string> {
  const browserProvider = getBrowserProvider();
  return browserProvider.broadcast(rawHex);
}
