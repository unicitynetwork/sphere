import { useState } from 'react';
import { Image as ImageIcon, ShoppingBag, MessageSquare, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { p2pListings, type SellerInfo } from '../../data/agentsMockData';
import { AgentChat, type SidebarItem, type AgentMessage } from './shared';

// Trade item for sidebar
interface TradeItem extends SidebarItem {
  status: 'pending' | 'completed' | 'cancelled';
  description?: string;
  seller?: SellerInfo;
}

// Card data for P2P items
interface P2PCardData {
  title: string;
  image: string;
  price: number;
  description?: string;
  seller: SellerInfo;
}

interface P2PChatProps {
  agent: AgentConfig;
}

export function P2PChat({ agent }: P2PChatProps) {
  const navigate = useNavigate();

  const [trades, setTrades] = useState<TradeItem[]>(() => {
    const stored = localStorage.getItem('sphere_p2p_trades');
    return stored ? JSON.parse(stored) : [];
  });

  const handleChatWithSeller = (seller: SellerInfo, productTitle?: string, productImage?: string, productPrice?: number, purchased?: boolean) => {
    const params = new URLSearchParams({
      sellerId: seller.id,
      ...(productTitle && { product: productTitle }),
      ...(productImage && { image: productImage }),
      ...(productPrice && { price: productPrice.toString() }),
      ...(purchased && { purchased: 'true' }),
    });
    navigate(`/agents/chat?${params.toString()}`);
  };

  const getMockResponse = async (
    userInput: string,
    addMessage: (content: string, cardData?: P2PCardData, showActionButton?: boolean) => void
  ) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    if (userInput.includes('sofa') || userInput.includes('couch') || userInput.includes('furniture')) {
      const item = p2pListings[0];
      addMessage(
        `Found a great deal!\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nInterested?`,
        { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
        true
      );
    } else if (userInput.includes('phone') || userInput.includes('iphone') || userInput.includes('mobile')) {
      const item = p2pListings[1];
      addMessage(
        `Check this out!\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nWant to buy?`,
        { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
        true
      );
    } else if (userInput.includes('bike') || userInput.includes('bicycle')) {
      const item = p2pListings[2];
      addMessage(
        `Perfect for you!\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nReady to ride?`,
        { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
        true
      );
    } else if (userInput.includes('pc') || userInput.includes('computer') || userInput.includes('gaming')) {
      const item = p2pListings[3];
      addMessage(
        `Beast machine!\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nLevel up?`,
        { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
        true
      );
    } else if (userInput.includes('available') || userInput.includes('show') || userInput.includes('what') || userInput.includes('list')) {
      addMessage(
        "Here's what people are selling:\n\n" +
        p2pListings.map(item => `- **${item.name}** - $${item.price} (${item.seller.name})`).join('\n') +
        "\n\nAsk me about any item!"
      );
    } else {
      addMessage(
        "I can help you find great deals!\n\nTry asking for:\n- Furniture (sofas, chairs)\n- Electronics (phones, computers)\n- Sports equipment (bikes)\n\nOr say \"What's available?\" to browse!"
      );
    }
  };

  return (
    <AgentChat<P2PCardData, TradeItem>
      agent={agent}
      sidebarConfig={{
        title: 'My Trades',
        emptyText: 'No trades yet',
        emptyIcon: <ShoppingBag className="w-8 h-8 mx-auto opacity-50" />,
        items: trades,
        setItems: setTrades,
        storageKey: 'sphere_p2p_trades',
        renderItem: (trade) => (
          <>
            {trade.image ? (
              <img src={trade.image} alt="" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className={`w-12 h-12 rounded-lg bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                <ImageIcon className="w-5 h-5 text-white/70" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{trade.title}</p>
              {trade.amount && <p className="text-orange-400 text-xs">${trade.amount}</p>}
              <p className="text-neutral-500 text-xs">{new Date(trade.timestamp).toLocaleDateString()}</p>
            </div>
          </>
        ),
      }}
      getMockResponse={getMockResponse}
      renderMessageCard={(cardData) => (
        <div className="mt-4 rounded-xl overflow-hidden border border-neutral-600/50">
          <img src={cardData.image} alt="" className="w-full h-28 object-cover" />
        </div>
      )}
      renderMessageActions={(message: AgentMessage<P2PCardData>) => (
        message.cardData?.seller ? (
          <motion.button
            onClick={() => handleChatWithSeller(message.cardData!.seller, message.cardData!.title, message.cardData!.image, message.cardData!.price)}
            className="mt-3 w-full py-2 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-medium flex items-center justify-center gap-2 border border-blue-500/30"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <MessageSquare className="w-4 h-4" />
            Contact {message.cardData.seller.name}
          </motion.button>
        ) : null
      )}
      actionConfig={{
        label: (cardData) => `Buy Now - $${cardData.price}`,
        onAction: () => {},
      }}
      transactionConfig={{
        confirmTitle: 'Confirm Purchase',
        processingText: 'Contacting seller',
        successText: 'Seller notified',
        renderConfirmContent: (cardData, onConfirm) => (
          <>
            <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
              <img src={cardData.image} alt="" className="w-full h-32 object-cover" />
              <div className="p-4 bg-neutral-800">
                <p className="text-white font-medium">{cardData.title}</p>
                <p className="text-orange-400 text-lg font-bold mt-1">${cardData.price}</p>
              </div>
            </div>

            <motion.button
              onClick={onConfirm}
              className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Wallet className="w-5 h-5" />
              Confirm & Pay
            </motion.button>
          </>
        ),
        onConfirm: async (cardData) => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return {
            id: uuidv4(),
            title: cardData.title,
            image: cardData.image,
            timestamp: Date.now(),
            status: 'pending' as const,
            amount: cardData.price,
            description: cardData.description,
            seller: cardData.seller,
          };
        },
      }}
      detailsConfig={{
        title: 'Trade Details',
        renderContent: (trade) => (
          <div className="rounded-xl overflow-hidden border border-neutral-700">
            {trade.image ? (
              <img src={trade.image} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className={`w-full h-40 bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                <ImageIcon className="w-12 h-12 text-white/50" />
              </div>
            )}
            <div className="p-4 bg-neutral-800">
              <p className="text-white font-medium text-lg">{trade.title}</p>
              {trade.description && (
                <p className="text-neutral-400 text-sm mt-2">{trade.description}</p>
              )}
              {trade.seller && (
                <div className="flex items-center gap-2 mt-3 p-2 bg-neutral-700/50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium">
                    {trade.seller.avatar}
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{trade.seller.name}</p>
                    <p className="text-neutral-400 text-xs">Seller</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-4">
                <p className="text-orange-400 text-xl font-bold">${trade.amount}</p>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  trade.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                  trade.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
                </span>
              </div>
              <p className="text-neutral-500 text-sm mt-3">
                {new Date(trade.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        ),
        renderActions: (trade) => (
          trade.seller ? (
            <motion.button
              onClick={() => handleChatWithSeller(trade.seller!, trade.title, trade.image, trade.amount, true)}
              className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <MessageSquare className="w-5 h-5" />
              Chat with {trade.seller.name}
            </motion.button>
          ) : null
        ),
      }}
      bgGradient={{ from: 'bg-orange-500/5', to: 'bg-red-500/5' }}
    />
  );
}
