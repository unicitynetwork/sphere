import { useState } from 'react';
import { Image as ImageIcon, Package, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { merchItems } from '../../data/agentsMockData';
import { AgentChat, type SidebarItem } from './shared';

// Order item for sidebar
interface OrderItem extends SidebarItem {
  status: 'pending' | 'completed' | 'cancelled';
  description?: string;
}

// Card data for merch items
interface MerchCardData {
  title: string;
  image: string;
  price: number;
  description?: string;
}

interface MerchChatProps {
  agent: AgentConfig;
}

export function MerchChat({ agent }: MerchChatProps) {
  const [orders, setOrders] = useState<OrderItem[]>(() => {
    const stored = localStorage.getItem('sphere_merch_orders');
    return stored ? JSON.parse(stored) : [];
  });

  const getMockResponse = async (
    userInput: string,
    addMessage: (content: string, cardData?: MerchCardData, showActionButton?: boolean) => void
  ) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    if (userInput.includes('hoodie') || userInput.includes('sweatshirt')) {
      const item = merchItems[0];
      addMessage(
        `Great choice!\n\n**${item.name}**\n${item.description}\n\n**Sizes:** ${item.sizes.join(', ')}\n**Price:** $${item.price}\n\nOur bestseller!`,
        { title: item.name, image: item.image, price: item.price, description: item.description },
        true
      );
    } else if (userInput.includes('shirt') || userInput.includes('tee')) {
      const item = merchItems[1];
      addMessage(
        `Classic style!\n\n**${item.name}**\n${item.description}\n\n**Sizes:** ${item.sizes.join(', ')}\n**Price:** $${item.price}\n\nComfortable and stylish!`,
        { title: item.name, image: item.image, price: item.price, description: item.description },
        true
      );
    } else if (userInput.includes('cap') || userInput.includes('hat')) {
      const item = merchItems[2];
      addMessage(
        `Looking sharp!\n\n**${item.name}**\n${item.description}\n\n**Size:** ${item.sizes.join(', ')}\n**Price:** $${item.price}`,
        { title: item.name, image: item.image, price: item.price, description: item.description },
        true
      );
    } else if (userInput.includes('mug') || userInput.includes('cup')) {
      const item = merchItems[3];
      addMessage(
        `For your coding sessions!\n\n**${item.name}**\n${item.description}\n\n**Price:** $${item.price}\n\nThe logo changes color with hot drinks!`,
        { title: item.name, image: item.image, price: item.price, description: item.description },
        true
      );
    } else if (userInput.includes('store') || userInput.includes('show') || userInput.includes('what') || userInput.includes('all') || userInput.includes('available')) {
      addMessage(
        "Here's our collection:\n\n" +
        merchItems.map(item => `- **${item.name}** - $${item.price}`).join('\n') +
        "\n\nAsk me about any item for details!"
      );
    } else if (userInput.includes('test') || userInput.includes('image') || userInput.includes('base64')) {
      // Demo: base64 image - colorful 100x60 gradient (purple to orange)
      const base64Demo = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM4QjVDRjYiLz48c3RvcCBvZmZzZXQ9IjUwJSIgc3RvcC1jb2xvcj0iI0VDNDg5OSIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI0Y5NzMxNiIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIiBmaWxsPSJ1cmwoI2cpIiByeD0iMTIiLz48dGV4dCB4PSIxMDAiIHk9IjU1IiBmb250LWZhbWlseT0ic3lzdGVtLXVpIiBmb250LXNpemU9IjIwIiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlNwaGVyZTwvdGV4dD48L3N2Zz4=';
      addMessage(
        "**Test: Base64 Image in Markdown**\n\nHere's an image rendered from base64:\n\n![Sphere Logo](" + base64Demo + ")\n\nThis works with any `data:image/...;base64,...` URL!"
      );
    } else {
      addMessage(
        "I can help you find the perfect merch!\n\nWe have:\n- Clothing (hoodies, t-shirts)\n- Accessories (caps, mugs)\n\nJust tell me what you're looking for!"
      );
    }
  };

  return (
    <AgentChat<MerchCardData, OrderItem>
      agent={agent}
      sidebarConfig={{
        title: 'My Orders',
        emptyText: 'No orders yet',
        emptyIcon: <Package className="w-8 h-8 mx-auto opacity-50" />,
        items: orders,
        setItems: setOrders,
        storageKey: 'sphere_merch_orders',
        renderItem: (order) => (
          <>
            {order.image ? (
              <img src={order.image} alt="" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className={`w-12 h-12 rounded-lg bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                <ImageIcon className="w-5 h-5 text-white/70" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{order.title}</p>
              {order.amount && <p className="text-purple-400 text-xs">${order.amount}</p>}
              <p className="text-neutral-500 text-xs">{new Date(order.timestamp).toLocaleDateString()}</p>
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
      actionConfig={{
        label: (cardData) => `Order Now - $${cardData.price}`,
        onAction: () => {},
      }}
      transactionConfig={{
        confirmTitle: 'Confirm Order',
        processingText: 'Confirming order',
        successText: 'Order placed',
        renderConfirmContent: (cardData, onConfirm) => (
          <>
            <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
              <img src={cardData.image} alt="" className="w-full h-32 object-cover" />
              <div className="p-4 bg-neutral-800">
                <p className="text-white font-medium">{cardData.title}</p>
                <p className="text-purple-400 text-lg font-bold mt-1">${cardData.price}</p>
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
          };
        },
      }}
      detailsConfig={{
        title: 'Order Details',
        renderContent: (order) => (
          <div className="rounded-xl overflow-hidden border border-neutral-700">
            {order.image ? (
              <img src={order.image} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className={`w-full h-40 bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                <ImageIcon className="w-12 h-12 text-white/50" />
              </div>
            )}
            <div className="p-4 bg-neutral-800">
              <p className="text-white font-medium text-lg">{order.title}</p>
              {order.description && (
                <p className="text-neutral-400 text-sm mt-2">{order.description}</p>
              )}
              <div className="flex items-center justify-between mt-4">
                <p className="text-purple-400 text-xl font-bold">${order.amount}</p>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  order.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                  order.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </span>
              </div>
              <p className="text-neutral-500 text-sm mt-3">
                {new Date(order.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        ),
      }}
      bgGradient={{ from: 'bg-purple-500/5', to: 'bg-pink-500/5' }}
    />
  );
}
