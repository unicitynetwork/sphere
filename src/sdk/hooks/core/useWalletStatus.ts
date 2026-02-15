import { useSphereContext } from './useSphere';

export interface WalletStatus {
  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;
}

export function useWalletStatus(): WalletStatus {
  const { isLoading, isInitialized, walletExists, error } = useSphereContext();
  return { isLoading, isInitialized, walletExists, error };
}
