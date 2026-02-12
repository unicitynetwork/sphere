import { createContext } from 'react';
import type { GroupChatService } from '../components/chat/services/GroupChatService';

export interface ServicesContextType {
  groupChatService: GroupChatService;
  isGroupChatConnected: boolean;
}

export const ServicesContext = createContext<ServicesContextType | undefined>(undefined);
