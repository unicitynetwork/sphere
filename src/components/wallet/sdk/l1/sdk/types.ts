export interface Wallet {
  masterPrivateKey: string;
  chainCode: string;
  addresses: WalletAddress[];
  createdAt: number;
}

export interface WalletAddress {
  address: string;
  publicKey: string;
  privateKey: string;
  path: string;
  index: number;
}

export interface StoredWallet {
  key: string;
  data: Wallet;
}
