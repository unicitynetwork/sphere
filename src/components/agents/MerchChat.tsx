import { useState } from 'react';
import { X, Wallet, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { merchItems } from '../../data/agentsMockData';
import { AgentChat } from './shared';

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
  // Order modal state
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<MerchCardData | null>(null);
  const [orderStep, setOrderStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

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

  const handleOrderNow = (cardData: MerchCardData) => {
    setPendingOrder(cardData);
    setOrderStep('confirm');
    setShowOrderModal(true);
  };

  const handleConfirmOrder = async () => {
    if (!pendingOrder) return;

    setOrderStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));

    setOrderStep('success');
    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowOrderModal(false);
    setPendingOrder(null);
  };

  return (
    <AgentChat<MerchCardData>
      agent={agent}
      getMockResponse={getMockResponse}
      renderMessageCard={(cardData) => (
        <div className="mt-4 rounded-xl overflow-hidden border border-neutral-300 dark:border-neutral-600/50">
          <img src={cardData.image} alt="" className="w-full h-28 object-cover" />
        </div>
      )}
      actionConfig={{
        label: (cardData) => `Order Now - $${cardData.price}`,
        onAction: handleOrderNow,
      }}
      bgGradient={{ from: 'bg-purple-500/5', to: 'bg-pink-500/5' }}
      additionalContent={
        <AnimatePresence>
          {showOrderModal && pendingOrder && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={() => orderStep === 'confirm' && setShowOrderModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                {orderStep === 'confirm' && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Confirm Order</h3>
                      <button onClick={() => setShowOrderModal(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 mb-4">
                      <img src={pendingOrder.image} alt="" className="w-full h-32 object-cover" />
                      <div className="p-4 bg-neutral-100 dark:bg-neutral-800">
                        <p className="text-neutral-900 dark:text-white font-medium">{pendingOrder.title}</p>
                        {pendingOrder.description && (
                          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{pendingOrder.description}</p>
                        )}
                        <p className="text-purple-600 dark:text-purple-400 text-lg font-bold mt-2">${pendingOrder.price}</p>
                      </div>
                    </div>

                    <motion.button
                      onClick={handleConfirmOrder}
                      className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Wallet className="w-5 h-5" />
                      Confirm & Pay
                    </motion.button>
                  </>
                )}

                {orderStep === 'processing' && (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Wallet className="w-8 h-8 text-purple-600 dark:text-purple-500" />
                      </motion.div>
                    </div>
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Processing</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">Confirming your order...</p>
                  </div>
                )}

                {orderStep === 'success' && (
                  <div className="py-12 text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center"
                    >
                      <CheckCircle className="w-8 h-8 text-white" />
                    </motion.div>
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Order Placed!</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">Your merch is on the way!</p>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      }
    />
  );
}
