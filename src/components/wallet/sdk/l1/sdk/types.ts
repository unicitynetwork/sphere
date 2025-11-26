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
