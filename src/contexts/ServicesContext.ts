import { createContext } from 'react';
import type { GroupChatModule } from '@unicitylabs/sphere-sdk';

export interface ServicesContextType {
  groupChat: GroupChatModule | null;
  isGroupChatConnected: boolean;
}

export const ServicesContext = createContext<ServicesContextType | undefined>(undefined);
