export interface Wallet {
  masterPrivateKey: string;
  chainCode?: string;
  addresses: WalletAddress[];
  createdAt?: number;
  isEncrypted?: boolean;
  encryptedMasterKey?: string;
  childPrivateKey?: string | null;
  isImportedAlphaWallet?: boolean;
  masterChainCode?: string | null;
}

export interface WalletAddress {
  address: string;
  publicKey?: string;
  privateKey?: string;
  path: string | null;
  index: number;
  createdAt?: string;
}

export interface StoredWallet {
  key: string;
  data: Wallet;
}

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

export interface UTXO {
  txid?: string;
  tx_hash?: string;
  vout?: number;
  tx_pos?: number;
  value: number;
  height?: number;
  address?: string;
}

export interface RestoreWalletResult {
  success: boolean;
  wallet: Wallet;
  message?: string;
  error?: string;
}

export interface ExportOptions {
  password?: string;
  filename?: string;
}
