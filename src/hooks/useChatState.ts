import { useState, useMemo, useEffect } from 'react';
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

export const useChatState = (
  sellerId?: string | null,
  productName?: string | null,
  productImage?: string | null,
  productPrice?: number,
  purchased?: boolean
): ChatState => {
  const initialMode = 'global' as ChatMode;
  const initialMessages = initialMode === 'global' ? globalMessages : dmMessages;

  const [chatMode, setChatMode] = useState<ChatMode>(initialMode);
  const [message, setMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState<IUserContact | null>(mockUsers[0]);
  const [messages, setMessages] = useState<IMessage[]>(initialMessages);

  // Handle sellerId from URL - open DM with seller (from P2P purchase)
  useEffect(() => {
    if (sellerId) {
      const seller = mockUsers.find(u => u.id === sellerId);
      if (seller) {
        setChatMode('dm');
        setSelectedUser(seller);

        // Different messages based on purchase status
        let userMessage: string;
        let sellerResponse: string;

        if (purchased) {
          // After purchase - discussing delivery
          userMessage = `Hi! I just purchased this item. When can I expect delivery?`;
          sellerResponse = "Hi! Thanks for your purchase! I'm already on my way, should be there in about 20 minutes 🚗";
        } else {
          // Before purchase - asking about availability
          userMessage = `Hi! I'm interested in this item. Is it still available?`;
          sellerResponse = `Hey! Yes, it's still available. Would you like to proceed with the purchase?`;
        }

        const p2pSellerMessages: IMessage[] = [];

        // Add product context card first (if product info available)
        if (productName && productImage) {
          p2pSellerMessages.push({
            id: '0',
            sender: 'System',
            avatar: '',
            content: '',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isOwn: false,
            isContextCard: true,
            productCard: {
              title: productName,
              image: productImage,
              price: productPrice,
            },
          });
        }

        // User message
        p2pSellerMessages.push({
          id: '1',
          sender: 'You',
          avatar: 'ME',
          content: userMessage,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isOwn: true,
        });

        // Seller response
        p2pSellerMessages.push({
          id: '2',
          sender: seller.name,
          avatar: seller.avatar,
          content: sellerResponse,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isOwn: false,
        });

        setMessages(p2pSellerMessages);
      }
    }
  }, [sellerId, productName, productImage, productPrice, purchased]);

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