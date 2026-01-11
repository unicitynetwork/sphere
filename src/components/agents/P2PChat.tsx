import { useState } from 'react';
import { X, MessageSquare, Wallet, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig } from '../../config/activities';
import { p2pListings, type SellerInfo } from '../../data/agentsMockData';
import { AgentChat, type AgentMessage } from './shared';

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

  // Purchase modal state
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<P2PCardData | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

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

  const handleBuyNow = (cardData: P2PCardData) => {
    setPendingPurchase(cardData);
    setPurchaseStep('confirm');
    setShowPurchaseModal(true);
  };

  const handleConfirmPurchase = async () => {
    if (!pendingPurchase) return;

    setPurchaseStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));

    setPurchaseStep('success');
    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowPurchaseModal(false);
    setPendingPurchase(null);
  };

  return (
    <AgentChat<P2PCardData>
      agent={agent}
      getMockResponse={getMockResponse}
      renderMessageCard={(cardData) => (
        <div className="mt-4 rounded-xl overflow-hidden border border-neutral-300 dark:border-neutral-600/50">
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
        onAction: handleBuyNow,
      }}
      bgGradient={{ from: 'bg-orange-500/5', to: 'bg-red-500/5' }}
      additionalContent={
        <AnimatePresence>
          {showPurchaseModal && pendingPurchase && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={() => purchaseStep === 'confirm' && setShowPurchaseModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                {purchaseStep === 'confirm' && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Confirm Purchase</h3>
                      <button onClick={() => setShowPurchaseModal(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 mb-4">
                      <img src={pendingPurchase.image} alt="" className="w-full h-32 object-cover" />
                      <div className="p-4 bg-neutral-100 dark:bg-neutral-800">
                        <p className="text-neutral-900 dark:text-white font-medium">{pendingPurchase.title}</p>
                        {pendingPurchase.description && (
                          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{pendingPurchase.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-3 p-2 bg-neutral-200 dark:bg-neutral-700/50 rounded-lg">
                          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium">
                            {pendingPurchase.seller.avatar}
                          </div>
                          <div>
                            <p className="text-neutral-900 dark:text-white text-sm font-medium">{pendingPurchase.seller.name}</p>
                            <p className="text-neutral-500 dark:text-neutral-400 text-xs">Seller</p>
                          </div>
                        </div>
                        <p className="text-orange-600 dark:text-orange-400 text-lg font-bold mt-3">${pendingPurchase.price}</p>
                      </div>
                    </div>

                    <motion.button
                      onClick={handleConfirmPurchase}
                      className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Wallet className="w-5 h-5" />
                      Confirm & Pay
                    </motion.button>
                  </>
                )}

                {purchaseStep === 'processing' && (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Wallet className="w-8 h-8 text-orange-600 dark:text-orange-500" />
                      </motion.div>
                    </div>
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Processing</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">Contacting seller...</p>
                  </div>
                )}

                {purchaseStep === 'success' && (
                  <div className="py-12 text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center"
                    >
                      <CheckCircle className="w-8 h-8 text-white" />
                    </motion.div>
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Seller Notified!</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">They will contact you soon.</p>
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
