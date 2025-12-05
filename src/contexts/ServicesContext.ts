import { createContext } from 'react';
import type { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import type { NostrService } from '../components/wallet/L3/services/NostrService';

export interface ServicesContextType {
  identityManager: IdentityManager;
  nostrService: NostrService;
  isNostrConnected: boolean;
}

export const ServicesContext = createContext<ServicesContextType | undefined>(undefined);
