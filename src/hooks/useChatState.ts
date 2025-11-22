import { useState, useMemo } from 'react';
import { globalMessages, dmMessages, mockUsers } from '../data/mockData';
import type { IMessage, IUserContact, ChatMode } from '../types';

export interface ChatState {
  chatMode: ChatMode;
  message: string;
  selectedUser: IUserContact | null;
  messages: IMessage[];
  users: IUserContact[];
  onlineCount: number;
  setMessage: (msg: string) => void;
  handleSend: () => void;
  handleModeChange: (mode: ChatMode) => void;
  handleUserSelect: (user: IUserContact) => void;
}

export const useChatState = (): ChatState => {
  const initialMode = 'global' as ChatMode;
  const initialMessages = initialMode === 'global' ? globalMessages : dmMessages;
  
  const [chatMode, setChatMode] = useState<ChatMode>(initialMode);
  const [message, setMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState<IUserContact | null>(mockUsers[0]);
  const [messages, setMessages] = useState<IMessage[]>(initialMessages);

  const onlineCount = useMemo(() => mockUsers.filter(u => u.status === 'online').length, []);

  const handleSend = () => {
    if (message.trim()) {
      setMessages([
        ...messages,
        {
          id: Date.now().toString(),
          sender: 'You',
          avatar: 'ME',
          content: message,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isOwn: true,
        },
      ]);
      setMessage('');
    }
  };

  const handleModeChange = (mode: ChatMode) => {
    setChatMode(mode);
    if (mode === 'global') {
      setMessages(globalMessages);
      setSelectedUser(null);
    } else {
      setSelectedUser(mockUsers[0]);
      setMessages(dmMessages);
    }
  };

  const handleUserSelect = (user: IUserContact) => {
    setSelectedUser(user);
    setChatMode('dm');
    setMessages(dmMessages);
  };
  
  return {
    chatMode,
    message,
    selectedUser,
    messages,
    users: mockUsers,
    onlineCount,
    setMessage,
    handleSend,
    handleModeChange,
    handleUserSelect,
  };
};