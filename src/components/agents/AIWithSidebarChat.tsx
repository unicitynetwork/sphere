import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Plus, Image as ImageIcon, X, Wallet, CheckCircle, Eye, ShoppingBag, Package, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig } from '../../config/activities';
import { v4 as uuidv4 } from 'uuid';
import { parseMarkdown } from '../../utils/markdown';

interface SellerInfo {
  id: string;
  name: string;
  avatar: string;
}

interface OrderItem {
  id: string;
  title: string;
  image?: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'cancelled';
  amount?: number;
  description?: string;
  seller?: SellerInfo;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  itemData?: {
    title: string;
    image: string;
    price: number;
    description?: string;
    seller?: SellerInfo;
  };
  showBuyButton?: boolean;
}

interface AIWithSidebarChatProps {
  agent: AgentConfig;
}

// P2P Marketplace listings - realistic images with seller info matching mockUsers
const p2pListings = [
  {
    id: '1',
    name: 'Leather Sofa',
    price: 450,
    seller: { id: '1', name: 'Sarah Williams', avatar: 'SW' },
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=200&fit=crop',
    description: 'Genuine leather 3-seater sofa in excellent condition',
    location: 'New York'
  },
  {
    id: '2',
    name: 'iPhone 14 Pro',
    price: 800,
    seller: { id: '2', name: 'Mike Johnson', avatar: 'MJ' },
    image: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400&h=200&fit=crop',
    description: '128GB, Space Black, like new with original box',
    location: 'Los Angeles'
  },
  {
    id: '3',
    name: 'Mountain Bike',
    price: 350,
    seller: { id: '3', name: 'Alex Chen', avatar: 'AC' },
    image: 'https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=400&h=200&fit=crop',
    description: '21-speed, aluminum frame, barely used',
    location: 'Chicago'
  },
  {
    id: '4',
    name: 'Gaming PC',
    price: 1200,
    seller: { id: '4', name: 'Emma Davis', avatar: 'ED' },
    image: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=400&h=200&fit=crop',
    description: 'RTX 3070, Ryzen 7, 32GB RAM, RGB setup',
    location: 'Miami'
  },
];

// Merch store items - realistic images
const merchItems = [
  {
    id: '1',
    name: 'Unicity Hoodie',
    price: 59.99,
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=200&fit=crop',
    description: 'Premium black hoodie with embroidered Unicity logo',
    sizes: ['S', 'M', 'L', 'XL', 'XXL']
  },
  {
    id: '2',
    name: 'Crypto T-Shirt',
    price: 29.99,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=200&fit=crop',
    description: 'Classic fit cotton t-shirt with blockchain design',
    sizes: ['S', 'M', 'L', 'XL']
  },
  {
    id: '3',
    name: 'Dev Cap',
    price: 24.99,
    image: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400&h=200&fit=crop',
    description: 'Snapback cap with "Code & Crypto" embroidery',
    sizes: ['One Size']
  },
  {
    id: '4',
    name: 'Sphere Mug',
    price: 14.99,
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400&h=200&fit=crop',
    description: 'Ceramic mug with color-changing Sphere logo',
    sizes: ['Standard']
  },
];

export function AIWithSidebarChat({ agent }: AIWithSidebarChatProps) {
  const isP2P = agent.id === 'p2p';
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>(() => {
    const stored = localStorage.getItem(`sphere_orders_${agent.id}`);
    return stored ? JSON.parse(stored) : [];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [pendingItem, setPendingItem] = useState<{ title: string; image: string; price: number; description?: string; seller?: SellerInfo } | null>(null);
  const [transactionStep, setTransactionStep] = useState<'confirm' | 'processing' | 'success'>('confirm');

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);
  const currentAgentId = useRef(agent.id);

  // Reset state when agent changes
  useEffect(() => {
    if (currentAgentId.current !== agent.id) {
      currentAgentId.current = agent.id;
      setMessages([]);
      setInput('');
      hasGreeted.current = false;

      // Load orders for new agent
      const stored = localStorage.getItem(`sphere_orders_${agent.id}`);
      setOrders(stored ? JSON.parse(stored) : []);
    }
  }, [agent.id]);

  // Save orders to localStorage
  useEffect(() => {
    localStorage.setItem(`sphere_orders_${agent.id}`, JSON.stringify(orders));
  }, [orders, agent.id]);

  // Greeting message
  useEffect(() => {
    if (!hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      const greeting = isP2P
        ? "Welcome to P2P Marketplace! 🛒\n\nBuy and sell anything directly with other users.\n\nTry:\n• \"Show me sofas\"\n• \"I need a phone\"\n• \"What's available?\"\n• \"Looking for a bike\""
        : "Welcome to the Merch Store! 👕\n\nCheck out our exclusive merchandise!\n\nTry:\n• \"Show me hoodies\"\n• \"I want a t-shirt\"\n• \"What's in the store?\"";
      addAssistantMessage(greeting);
    }
  }, [agent.id, messages.length, isP2P]);

  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const addAssistantMessage = (content: string, itemData?: { title: string; image: string; price: number; description?: string; seller?: SellerInfo }, showBuyButton?: boolean) => {
    setMessages(prev => [...prev, {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      itemData,
      showBuyButton,
    }]);
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userText = input.toLowerCase();
    setMessages(prev => [...prev, {
      id: uuidv4(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }]);
    setInput('');
    setIsTyping(true);

    await new Promise(resolve => setTimeout(resolve, 800));

    if (isP2P) {
      // P2P Marketplace responses
      if (userText.includes('sofa') || userText.includes('couch') || userText.includes('furniture')) {
        const item = p2pListings[0];
        addAssistantMessage(
          `Found a great deal! 🛋️\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nInterested?`,
          { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
          true
        );
      } else if (userText.includes('phone') || userText.includes('iphone') || userText.includes('mobile')) {
        const item = p2pListings[1];
        addAssistantMessage(
          `Check this out! 📱\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nWant to buy?`,
          { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
          true
        );
      } else if (userText.includes('bike') || userText.includes('bicycle')) {
        const item = p2pListings[2];
        addAssistantMessage(
          `Perfect for you! 🚴\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nReady to ride?`,
          { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
          true
        );
      } else if (userText.includes('pc') || userText.includes('computer') || userText.includes('gaming')) {
        const item = p2pListings[3];
        addAssistantMessage(
          `Beast machine! 🎮\n\n**${item.name}**\n${item.description}\n\n**Seller:** ${item.seller.name}\n**Location:** ${item.location}\n**Price:** $${item.price}\n\nLevel up?`,
          { title: item.name, image: item.image, price: item.price, description: item.description, seller: item.seller },
          true
        );
      } else if (userText.includes('available') || userText.includes('show') || userText.includes('what') || userText.includes('list')) {
        addAssistantMessage(
          "Here's what people are selling:\n\n" +
          p2pListings.map(item => `• **${item.name}** - $${item.price} (${item.seller.name})`).join('\n') +
          "\n\nAsk me about any item!"
        );
      } else {
        addAssistantMessage(
          "I can help you find great deals! 🔍\n\nTry asking for:\n• Furniture (sofas, chairs)\n• Electronics (phones, computers)\n• Sports equipment (bikes)\n\nOr say \"What's available?\" to browse!"
        );
      }
    } else {
      // Merch Store responses
      if (userText.includes('hoodie') || userText.includes('sweatshirt')) {
        const item = merchItems[0];
        addAssistantMessage(
          `Great choice! 🔥\n\n**${item.name}**\n${item.description}\n\n**Sizes:** ${item.sizes.join(', ')}\n**Price:** $${item.price}\n\nOur bestseller!`,
          { title: item.name, image: item.image, price: item.price, description: item.description },
          true
        );
      } else if (userText.includes('shirt') || userText.includes('tee')) {
        const item = merchItems[1];
        addAssistantMessage(
          `Classic style! 👕\n\n**${item.name}**\n${item.description}\n\n**Sizes:** ${item.sizes.join(', ')}\n**Price:** $${item.price}\n\nComfortable and stylish!`,
          { title: item.name, image: item.image, price: item.price, description: item.description },
          true
        );
      } else if (userText.includes('cap') || userText.includes('hat')) {
        const item = merchItems[2];
        addAssistantMessage(
          `Looking sharp! 🧢\n\n**${item.name}**\n${item.description}\n\n**Size:** ${item.sizes.join(', ')}\n**Price:** $${item.price}`,
          { title: item.name, image: item.image, price: item.price, description: item.description },
          true
        );
      } else if (userText.includes('mug') || userText.includes('cup')) {
        const item = merchItems[3];
        addAssistantMessage(
          `For your coding sessions! ☕\n\n**${item.name}**\n${item.description}\n\n**Price:** $${item.price}\n\nThe logo changes color with hot drinks!`,
          { title: item.name, image: item.image, price: item.price, description: item.description },
          true
        );
      } else if (userText.includes('store') || userText.includes('show') || userText.includes('what') || userText.includes('all') || userText.includes('available')) {
        addAssistantMessage(
          "Here's our collection:\n\n" +
          merchItems.map(item => `• **${item.name}** - $${item.price}`).join('\n') +
          "\n\nAsk me about any item for details!"
        );
      } else {
        addAssistantMessage(
          "I can help you find the perfect merch! 🛍️\n\nWe have:\n• Clothing (hoodies, t-shirts)\n• Accessories (caps, mugs)\n\nJust tell me what you're looking for!"
        );
      }
    }

    setIsTyping(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBuy = (itemData: { title: string; image: string; price: number; description?: string; seller?: SellerInfo }) => {
    setPendingItem(itemData);
    setTransactionStep('confirm');
    setShowTransactionModal(true);
  };

  const handleConfirmTransaction = async () => {
    setTransactionStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));
    setTransactionStep('success');

    if (pendingItem) {
      setOrders(prev => [{
        id: uuidv4(),
        title: pendingItem.title,
        image: pendingItem.image,
        timestamp: Date.now(),
        status: 'pending',
        amount: pendingItem.price,
        description: pendingItem.description,
        seller: pendingItem.seller,
      }, ...prev]);
    }
  };

  const handleCloseSuccessModal = () => {
    setShowTransactionModal(false);
    const successMsg = isP2P
      ? `✅ **Purchase initiated!**\n\nYour order for **${pendingItem?.title}** is being processed. The seller has been notified.\n\n_Click the + button to start a new search._`
      : `✅ **Order confirmed!**\n\nYour **${pendingItem?.title}** is on its way! 📦 You'll receive a tracking number soon.\n\n_Click the + button to place a new order._`;
    addAssistantMessage(successMsg);
    setPendingItem(null);
  };

  const handleChatWithSeller = (seller: SellerInfo, productTitle?: string, productImage?: string, productPrice?: number, purchased?: boolean) => {
    setShowTransactionModal(false);
    setShowOrderDetails(false);
    const params = new URLSearchParams({
      sellerId: seller.id,
      ...(productTitle && { product: productTitle }),
      ...(productImage && { image: productImage }),
      ...(productPrice && { price: productPrice.toString() }),
      ...(purchased && { purchased: 'true' }),
    });
    navigate(`/agents/chat?${params.toString()}`);
  };

  const handleNewChat = () => {
    setMessages([]);
    hasGreeted.current = false;
  };

  const handleOrderClick = (order: OrderItem) => {
    setSelectedOrder(order);
    setShowOrderDetails(true);
  };

  const sidebarTitle = isP2P ? 'My Trades' : 'My Orders';
  const sidebarEmptyText = isP2P ? 'No trades yet' : 'No orders yet';
  const buyButtonText = isP2P ? '🛒 Buy Now' : '🛒 Order Now';
  const confirmTitle = isP2P ? 'Confirm Purchase' : 'Confirm Order';

  return (
    <>
      <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex relative shadow-2xl h-full">
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-red-500/5 rounded-full blur-3xl" />

        {/* Sidebar */}
        <div className="w-72 border-r border-neutral-800/50 flex flex-col relative z-10">
          <div className="p-4 border-b border-neutral-800/50">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">{sidebarTitle}</h3>
              <motion.button
                onClick={handleNewChat}
                className={`p-2 rounded-lg bg-linear-to-br ${agent.color} text-white`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {orders.length === 0 ? (
              <div className="text-center text-neutral-500 py-8">
                {isP2P ? (
                  <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-50" />
                ) : (
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                )}
                <p className="text-sm">{sidebarEmptyText}</p>
              </div>
            ) : (
              orders.map((order) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => handleOrderClick(order)}
                  className="p-3 rounded-xl bg-neutral-800/50 border border-neutral-700/30 cursor-pointer hover:bg-neutral-700/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    {order.image ? (
                      <img src={order.image} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <div className={`w-12 h-12 rounded-lg bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                        <ImageIcon className="w-5 h-5 text-white/70" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{order.title}</p>
                      {order.amount && <p className="text-orange-400 text-xs">${order.amount}</p>}
                      <p className="text-neutral-500 text-xs">{new Date(order.timestamp).toLocaleDateString()}</p>
                    </div>
                    <Eye className="w-4 h-4 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 flex flex-col relative z-10">
          <div className="p-4 border-b border-neutral-800/50">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl bg-linear-to-br ${agent.color}`}>
                <agent.Icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg text-white font-medium">{agent.name}</h2>
                <p className="text-sm text-neutral-400">{agent.description}</p>
              </div>
            </div>
          </div>

          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 ${
                      message.role === 'user'
                        ? `bg-linear-to-br ${agent.color} text-white shadow-lg`
                        : 'bg-neutral-800/80 border border-neutral-700/50 text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {message.role === 'assistant' && (
                        <div className={`w-5 h-5 rounded-full bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                          <Sparkles className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                      <span className={`text-xs ${message.role === 'user' ? 'text-white/80' : 'text-neutral-400'}`}>
                        {message.role === 'user' ? 'You' : agent.name}
                      </span>
                    </div>

                    <div className="leading-relaxed">{parseMarkdown(message.content)}</div>

                    {message.itemData && (
                      <div className="mt-4 rounded-xl overflow-hidden border border-neutral-600/50">
                        <img src={message.itemData.image} alt="" className="w-full h-28 object-cover" />
                      </div>
                    )}

                    {/* Seller contact button for P2P */}
                    {isP2P && message.itemData?.seller && (
                      <motion.button
                        onClick={() => handleChatWithSeller(message.itemData!.seller!, message.itemData!.title, message.itemData!.image, message.itemData!.price)}
                        className="mt-3 w-full py-2 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-medium flex items-center justify-center gap-2 border border-blue-500/30"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <MessageSquare className="w-4 h-4" />
                        Contact {message.itemData.seller.name}
                      </motion.button>
                    )}

                    {message.showBuyButton && message.itemData && (
                      <motion.button
                        onClick={() => handleBuy(message.itemData!)}
                        className={`mt-2 w-full py-3 rounded-xl bg-linear-to-r ${agent.color} text-white font-medium`}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        {buyButtonText} - ${message.itemData.price}
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="bg-neutral-800/80 border border-neutral-700/50 rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-800/50">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={isP2P ? "What are you looking for?" : "What merch do you want?"}
                className="flex-1 bg-neutral-800/50 text-white placeholder-neutral-500 outline-none resize-none rounded-xl p-3 min-h-11 max-h-[120px] border border-neutral-700/50"
                rows={1}
                disabled={isTyping}
              />
              <motion.button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className={`px-5 py-2 rounded-xl bg-linear-to-r ${agent.color} text-white disabled:opacity-50`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Send className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showTransactionModal && pendingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => transactionStep === 'confirm' && setShowTransactionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              {transactionStep === 'confirm' && (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-white">{confirmTitle}</h3>
                    <button onClick={() => setShowTransactionModal(false)} className="text-neutral-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
                    <img src={pendingItem.image} alt="" className="w-full h-32 object-cover" />
                    <div className="p-4 bg-neutral-800">
                      <p className="text-white font-medium">{pendingItem.title}</p>
                      <p className="text-orange-400 text-lg font-bold mt-1">${pendingItem.price}</p>
                    </div>
                  </div>

                  <motion.button
                    onClick={handleConfirmTransaction}
                    className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Wallet className="w-5 h-5" />
                    Confirm & Pay
                  </motion.button>
                </>
              )}

              {transactionStep === 'processing' && (
                <div className="py-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Wallet className="w-8 h-8 text-orange-500" />
                    </motion.div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Processing...</h3>
                  <p className="text-neutral-400">{isP2P ? 'Contacting seller' : 'Confirming order'}</p>
                </div>
              )}

              {transactionStep === 'success' && (
                <div className="py-8 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center"
                  >
                    <CheckCircle className="w-8 h-8 text-white" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-white mb-2">Success!</h3>
                  <p className="text-neutral-400 mb-6">{isP2P ? 'Seller notified' : 'Order placed'}</p>

                  <div className="space-y-3">
                    {isP2P && pendingItem?.seller && (
                      <motion.button
                        onClick={() => handleChatWithSeller(pendingItem.seller!, pendingItem.title, pendingItem.image, pendingItem.price, true)}
                        className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center gap-2"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <MessageSquare className="w-5 h-5" />
                        Chat with {pendingItem.seller.name}
                      </motion.button>
                    )}
                    <motion.button
                      onClick={handleCloseSuccessModal}
                      className="w-full py-3 rounded-xl bg-neutral-800 text-white font-medium border border-neutral-700"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Continue Shopping
                    </motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Details Modal */}
      <AnimatePresence>
        {showOrderDetails && selectedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowOrderDetails(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">{isP2P ? 'Trade Details' : 'Order Details'}</h3>
                <button onClick={() => setShowOrderDetails(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-xl overflow-hidden border border-neutral-700 mb-4">
                {selectedOrder.image ? (
                  <img src={selectedOrder.image} alt="" className="w-full h-40 object-cover" />
                ) : (
                  <div className={`w-full h-40 bg-linear-to-br ${agent.color} flex items-center justify-center`}>
                    <ImageIcon className="w-12 h-12 text-white/50" />
                  </div>
                )}
                <div className="p-4 bg-neutral-800">
                  <p className="text-white font-medium text-lg">{selectedOrder.title}</p>
                  {selectedOrder.description && (
                    <p className="text-neutral-400 text-sm mt-2">{selectedOrder.description}</p>
                  )}
                  {isP2P && selectedOrder.seller && (
                    <div className="flex items-center gap-2 mt-3 p-2 bg-neutral-700/50 rounded-lg">
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-medium">
                        {selectedOrder.seller.avatar}
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{selectedOrder.seller.name}</p>
                        <p className="text-neutral-400 text-xs">Seller</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-orange-400 text-xl font-bold">${selectedOrder.amount}</p>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      selectedOrder.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      selectedOrder.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {selectedOrder.status.charAt(0).toUpperCase() + selectedOrder.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-neutral-500 text-sm mt-3">
                    {new Date(selectedOrder.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {isP2P && selectedOrder.seller && (
                  <motion.button
                    onClick={() => handleChatWithSeller(selectedOrder.seller!, selectedOrder.title, selectedOrder.image, selectedOrder.amount, true)}
                    className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium flex items-center justify-center gap-2"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <MessageSquare className="w-5 h-5" />
                    Chat with {selectedOrder.seller.name}
                  </motion.button>
                )}
                <motion.button
                  onClick={() => setShowOrderDetails(false)}
                  className="w-full py-3 rounded-xl bg-neutral-800 text-white font-medium border border-neutral-700"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Close
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
