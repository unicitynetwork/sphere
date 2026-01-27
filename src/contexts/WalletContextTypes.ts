/**
 * WalletContext types and context definition
 *
 * Separated from WalletProvider for React Fast Refresh compliance.
 */

import { createContext } from 'react';
import type { AggregatedAsset, Token } from '../components/wallet/L3/data/model';
import type { UserIdentity } from '../components/wallet/L3/services/IdentityManager';
import type { UnifiedKeyManager } from '../components/wallet/shared/services/UnifiedKeyManager';

export interface WalletContextValue {
  identity: UserIdentity | null | undefined;
  isLoadingIdentity: boolean;
  l1Address: string | null;
  nametag: string | null | undefined;
  isLoadingNametag: boolean;
  assets: AggregatedAsset[];
  isLoadingAssets: boolean;
  assetsUpdatedAt: number;
  tokens: Token[];
  tokensUpdatedAt: number;
  isValidatingTokens: boolean;
  createWallet: () => Promise<UserIdentity>;
  restoreWallet: (mnemonic: string) => Promise<UserIdentity>;
  mintNametag: (nametag: string) => Promise<{ status: string; message?: string }>;
  sentToken: (params: { recipientNametag: string; token: Token }) => Promise<boolean>;
  sendAmount: (params: {
    recipientNametag: string;
    amount: string;
    coinId: string;
    eventId?: string;
  }) => Promise<boolean>;
  isSending: boolean;
  getSeedPhrase: () => Promise<string[] | null>;
  getL1Address: () => Promise<string | null>;
  getUnifiedKeyManager: () => UnifiedKeyManager;
  checkNametagAvailability: (nametag: string) => Promise<boolean>;
}

export const WalletContext = createContext<WalletContextValue | undefined>(undefined);

// Module-level flag to prevent multiple instances from triggering initial sync
let _initialSyncTriggered = false;

export function getInitialSyncTriggered(): boolean {
  return _initialSyncTriggered;
}

export function setInitialSyncTriggered(value: boolean): void {
  _initialSyncTriggered = value;
}

export function resetInitialSyncFlag(): void {
  _initialSyncTriggered = false;
}
