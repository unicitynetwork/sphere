import { createContext } from 'react';
import type { IdentityManager } from '../components/wallet/L3/services/IdentityManager';
import type { NostrService } from '../components/wallet/L3/services/NostrService';
import type { GroupChatService } from '../components/chat/services/GroupChatService';

export interface ServicesContextType {
  identityManager: IdentityManager;
  nostrService: NostrService;
  isNostrConnected: boolean;
  groupChatService: GroupChatService;
  isGroupChatConnected: boolean;
}

export const ServicesContext = createContext<ServicesContextType | undefined>(undefined);
