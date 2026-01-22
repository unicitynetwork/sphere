import { useState } from 'react';
import { X, Wallet, CheckCircle, ShoppingCart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentConfig } from '../../config/activities';
import { AgentChat, type SidebarItem } from './shared';
import { recordActivity } from '../../services/ActivityService';

// Card data for Pokémon cards
interface PokemonCardData {
  name: string;
  image?: string;
  price: number;
  set?: string;
  rarity?: string;
  handle?: string;
}

// Order item for sidebar
interface PokemonOrderItem extends SidebarItem {
  cardName: string;
  price: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  quantity: number;
}

interface PokemonChatProps {
  agent: AgentConfig;
}

export function PokemonChat({ agent }: PokemonChatProps) {
  // Purchase modal state
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<PokemonCardData | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

  // Mock orders for sidebar (in production, this would come from backend)
  const [orders] = useState<PokemonOrderItem[]>([]);

  const handleBuyNow = (cardData: PokemonCardData) => {
    setPendingPurchase(cardData);
    setPurchaseStep('confirm');
    setShowPurchaseModal(true);
  };

  const handleConfirmPurchase = async () => {
    if (!pendingPurchase) return;

    setPurchaseStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));

    setPurchaseStep('success');

    // Record Pokémon purchase activity
    recordActivity('pokemon_purchase', {
      isPublic: true,
      data: {
        cardName: pendingPurchase.name,
        price: pendingPurchase.price,
        set: pendingPurchase.set,
        rarity: pendingPurchase.rarity,
      },
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowPurchaseModal(false);
    setPendingPurchase(null);
  };

  const getStatusColor = (status: PokemonOrderItem['status']) => {
    switch (status) {
      case 'pending': return 'text-yellow-500';
      case 'confirmed': return 'text-blue-500';
      case 'shipped': return 'text-purple-500';
      case 'delivered': return 'text-green-500';
      default: return 'text-neutral-500';
    }
  };

  const getStatusLabel = (status: PokemonOrderItem['status']) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'confirmed': return 'Confirmed';
      case 'shipped': return 'Shipped';
      case 'delivered': return 'Delivered';
      default: return status;
    }
  };

  return (
    <AgentChat<PokemonCardData, PokemonOrderItem>
      agent={agent}
      renderMessageCard={(cardData) => (
        cardData.image ? (
          <div className="mt-4 rounded-xl overflow-hidden border border-neutral-300 dark:border-neutral-600/50">
            <img src={cardData.image} alt={cardData.name} className="w-full h-40 object-contain bg-neutral-100 dark:bg-neutral-800" />
            <div className="p-3 bg-neutral-100 dark:bg-neutral-900/80">
              <p className="text-neutral-900 dark:text-white font-medium">{cardData.name}</p>
              {cardData.set && (
                <p className="text-neutral-500 dark:text-neutral-400 text-sm">{cardData.set}</p>
              )}
              {cardData.rarity && (
                <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs rounded-full">
                  {cardData.rarity}
                </span>
              )}
              <p className="text-yellow-600 dark:text-yellow-400 font-bold mt-2">{cardData.price} UCT</p>
            </div>
          </div>
        ) : null
      )}
      actionConfig={{
        label: (cardData) => `Buy Now - ${cardData.price} UCT`,
        onAction: handleBuyNow,
      }}
      bgGradient={{ from: 'bg-yellow-500/5', to: 'bg-red-500/5' }}
      sidebarConfig={{
        title: 'My Orders',
        emptyText: 'No orders yet',
        emptyIcon: <ShoppingCart className="w-8 h-8 mx-auto opacity-50 mb-2" />,
        items: orders,
        renderItem: (item, onClick) => (
          <motion.div
            onClick={onClick}
            className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/30 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 cursor-pointer transition-colors"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center gap-3">
              {item.image && (
                <img src={item.image} alt={item.cardName} className="w-12 h-12 rounded-lg object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-neutral-900 dark:text-white font-medium truncate">{item.cardName}</p>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm">{item.price} UCT × {item.quantity}</p>
              </div>
              <span className={`text-xs font-medium ${getStatusColor(item.status)}`}>
                {getStatusLabel(item.status)}
              </span>
            </div>
          </motion.div>
        ),
        onItemClick: (item) => {
          console.log('Order clicked:', item);
        },
      }}
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
                      {pendingPurchase.image && (
                        <img src={pendingPurchase.image} alt="" className="w-full h-40 object-contain bg-neutral-100 dark:bg-neutral-800" />
                      )}
                      <div className="p-4 bg-neutral-100 dark:bg-neutral-800">
                        <p className="text-neutral-900 dark:text-white font-medium">{pendingPurchase.name}</p>
                        {pendingPurchase.set && (
                          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{pendingPurchase.set}</p>
                        )}
                        {pendingPurchase.rarity && (
                          <span className="inline-block mt-2 px-2 py-0.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs rounded-full">
                            {pendingPurchase.rarity}
                          </span>
                        )}
                        <p className="text-yellow-600 dark:text-yellow-400 text-lg font-bold mt-3">{pendingPurchase.price} UCT</p>
                      </div>
                    </div>

                    <motion.button
                      onClick={handleConfirmPurchase}
                      className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Wallet className="w-5 h-5" />
                      Pay with Unicity Tokens
                    </motion.button>
                  </>
                )}

                {purchaseStep === 'processing' && (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Wallet className="w-8 h-8 text-yellow-600 dark:text-yellow-500" />
                      </motion.div>
                    </div>
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Processing Payment</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">Confirming your Unicity token transfer...</p>
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
                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Purchase Complete!</h3>
                    <p className="text-neutral-500 dark:text-neutral-400">Your Pokémon card is on its way.</p>
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
