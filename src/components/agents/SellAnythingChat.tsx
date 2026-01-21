import { useState } from 'react';
import { X, MessageSquare, Wallet, CheckCircle, Sparkles, ShoppingCart, Tag, ArrowUpRight, ArrowDownLeft, Flame, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig } from '../../config/activities';
import {
  marketplaceListings,
  marketplaceActivity,
  getMarketplaceListingsByCategory,
  type MarketplaceListing,
  type MarketplaceCategory,
  type MarketplaceIntent,
} from '../../data/agentsMockData';
import { AgentChat, type AgentMessage } from './shared';
import { recordActivity } from '../../services/ActivityService';

// Card data for marketplace items
interface MarketplaceCardData {
  listing: MarketplaceListing;
}

interface SellAnythingChatProps {
  agent: AgentConfig;
}

// Category configuration
const categories: { id: MarketplaceCategory; label: string; icon: typeof Tag }[] = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'gold', label: 'Gold', icon: Tag },
  { id: 'tickets', label: 'Tickets', icon: Tag },
  { id: 'asics', label: 'ASICs', icon: Tag },
];

// Activity feed component
function ActivityFeed({
  activities,
  selectedCategory,
  onCategoryChange,
  onUserClick,
}: {
  activities: MarketplaceIntent[];
  selectedCategory: MarketplaceCategory;
  onCategoryChange: (cat: MarketplaceCategory) => void;
  onUserClick: (username: string) => void;
}) {
  const filteredActivities = selectedCategory === 'all'
    ? activities
    : activities.filter(a => a.category === selectedCategory);

  return (
    <div className="mb-4 rounded-xl border border-neutral-200 dark:border-neutral-700/50 bg-neutral-50 dark:bg-neutral-800/30 overflow-hidden">
      {/* Category tabs */}
      <div className="flex gap-1 p-2 border-b border-neutral-200 dark:border-neutral-700/50 overflow-x-auto scrollbar-hide">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onCategoryChange(cat.id)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedCategory === cat.id
                ? 'bg-teal-500 text-white'
                : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Activity stream */}
      <div className="max-h-32 overflow-y-auto">
        {filteredActivities.length === 0 ? (
          <div className="p-4 text-center text-neutral-500 dark:text-neutral-400 text-sm">
            No activity in this category yet
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700/30">
            {filteredActivities.slice(0, 5).map((intent) => (
              <div
                key={intent.id}
                className="flex items-start gap-3 p-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/30 transition-colors cursor-pointer"
              >
                <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  intent.type === 'buy'
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-orange-500/20 text-orange-500'
                }`}>
                  {intent.type === 'buy' ? (
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUserClick(intent.user);
                      }}
                      className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
                    >
                      @{intent.user}
                    </button>
                    <span className="text-xs text-neutral-400">{intent.timestamp}</span>
                  </div>
                  <p className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
                    {intent.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SellAnythingChat({ agent }: SellAnythingChatProps) {
  const navigate = useNavigate();

  // Category filter state
  const [selectedCategory, setSelectedCategory] = useState<MarketplaceCategory>('all');

  // Purchase/contact modal state
  const [showModal, setShowModal] = useState(false);
  const [pendingListing, setPendingListing] = useState<MarketplaceListing | null>(null);
  const [modalStep, setModalStep] = useState<'confirm' | 'processing' | 'success'>('confirm');
  const [offerAmount, setOfferAmount] = useState('');

  const handleChatWithSeller = (listing: MarketplaceListing) => {
    const params = new URLSearchParams({
      nametag: listing.seller.name,
      product: listing.title,
      image: listing.image,
      price: listing.price.toString(),
    });
    navigate(`/agents/chat?${params.toString()}`);
  };

  const getMockResponse = async (
    userInput: string,
    addMessage: (content: string, cardData?: MarketplaceCardData, showActionButton?: boolean) => void
  ) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    const input = userInput.toLowerCase();

    // Gold / Precious Metals
    if (input.includes('gold') || input.includes('silver') || input.includes('pamp') || input.includes('bar') || input.includes('precious')) {
      const listings = getMarketplaceListingsByCategory('gold');
      if (listings.length > 0) {
        const listing = listings[Math.floor(Math.random() * listings.length)];
        addMessage(
          `Found a precious metals listing!\n\n**${listing.title}**\n${listing.description}\n\n**Seller:** ${listing.seller.name} ${listing.verified ? '(Verified)' : ''}\n**Location:** ${listing.location}\n**Price:** ${listing.price} ${listing.currency}\n\nWant to make an offer or contact the seller?`,
          { listing },
          true
        );
      } else {
        addMessage("No gold listings available right now. I can monitor spot prices and alert you when something comes up.");
      }
      return;
    }

    // Tickets / Events
    if (input.includes('ticket') || input.includes('concert') || input.includes('ufc') || input.includes('world cup') || input.includes('coldplay') || input.includes('event')) {
      const listings = getMarketplaceListingsByCategory('tickets');
      if (listings.length > 0) {
        const listing = listings[Math.floor(Math.random() * listings.length)];
        addMessage(
          `Found event tickets!\n\n**${listing.title}**\n${listing.description}\n\n**Seller:** ${listing.seller.name} ${listing.verified ? '(Verified)' : ''}\n**Location:** ${listing.location}\n**Price:** ${listing.price} ${listing.currency}${listing.urgency === 'urgent' ? '\n\n**URGENT** - Seller needs to sell quickly!' : ''}\n\nWant to grab these?`,
          { listing },
          true
        );
      } else {
        addMessage("No ticket listings right now. Tell me what events you're interested in and I'll watch for them!");
      }
      return;
    }

    // ASICs / Mining Hardware
    if (input.includes('asic') || input.includes('antminer') || input.includes('miner') || input.includes('mining') || input.includes('gpu') || input.includes('rig') || input.includes('kaspa') || input.includes('s21') || input.includes('ks5')) {
      const listings = getMarketplaceListingsByCategory('asics');
      if (listings.length > 0) {
        const listing = listings[Math.floor(Math.random() * listings.length)];
        addMessage(
          `Found mining hardware!\n\n**${listing.title}**\n${listing.description}\n\n**Seller:** ${listing.seller.name} ${listing.verified ? '(Verified)' : ''}\n**Location:** ${listing.location}\n**Price:** ${listing.price} ${listing.currency}${listing.urgency === 'urgent' ? '\n\n**URGENT** - Quick sale needed!' : ''}\n\nReady to make a move?`,
          { listing },
          true
        );
      } else {
        addMessage("No mining hardware available at the moment. I'll keep an eye out for you!");
      }
      return;
    }

    // Selling intent
    if (input.includes('sell') || input.includes('selling') || input.includes('have') || input.includes('offering')) {
      addMessage(
        "Great! To list your item, I need some details:\n\n1. **What are you selling?** (e.g., Claude credits, gold bars, tickets, mining hardware)\n2. **Your asking price** (in USDC)\n3. **Location** (for physical items)\n4. **Description** of the item\n\nOnce you provide these, I'll create a listing and broadcast it to potential buyers on the network!"
      );
      return;
    }

    // Browse / Show all
    if (input.includes('show') || input.includes('browse') || input.includes('list') || input.includes('available') || input.includes('what')) {
      const allListings = marketplaceListings;
      addMessage(
        "Here's what's available right now:\n\n" +
        "**Gold & Precious Metals:**\n" +
        allListings.filter(l => l.category === 'gold').map(l => `- ${l.title} - ${l.price} ${l.currency}`).join('\n') +
        "\n\n**Event Tickets:**\n" +
        allListings.filter(l => l.category === 'tickets').map(l => `- ${l.title} - ${l.price} ${l.currency}`).join('\n') +
        "\n\n**Mining Hardware (ASICs):**\n" +
        allListings.filter(l => l.category === 'asics').map(l => `- ${l.title} - ${l.price} ${l.currency}`).join('\n') +
        "\n\nAsk me about any category for more details!"
      );
      return;
    }

    // Default response
    addMessage(
      "I can help you buy or sell almost anything P2P!\n\n**Try asking:**\n" +
      "- \"Show me gold listings\"\n" +
      "- \"Anyone selling Coldplay tickets?\"\n" +
      "- \"Need an Antminer S21\"\n" +
      "- \"I want to sell my mining rig\"\n\n" +
      "Or browse by category using the tabs above!"
    );
  };

  const handleMakeOffer = (cardData: MarketplaceCardData) => {
    setPendingListing(cardData.listing);
    setOfferAmount(cardData.listing.price.toString());
    setModalStep('confirm');
    setShowModal(true);
  };

  const handleConfirmOffer = async () => {
    if (!pendingListing) return;

    setModalStep('processing');
    await new Promise(resolve => setTimeout(resolve, 2000));

    setModalStep('success');

    // Record marketplace activity
    recordActivity('marketplace_offer', {
      isPublic: true,
      data: {
        listingId: pendingListing.id,
        listingTitle: pendingListing.title,
        offerAmount: parseFloat(offerAmount),
        currency: pendingListing.currency,
        sellerName: pendingListing.seller.name,
      },
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    setShowModal(false);
    setPendingListing(null);
  };

  // Handle clicking on a username in activity feed
  const handleActivityUserClick = (username: string) => {
    navigate(`/agents/chat?nametag=${encodeURIComponent(username)}`);
  };

  // Custom header content with activity feed
  const renderActivityHeader = () => (
    <ActivityFeed
      activities={marketplaceActivity}
      selectedCategory={selectedCategory}
      onCategoryChange={setSelectedCategory}
      onUserClick={handleActivityUserClick}
    />
  );

  return (
    <div className="flex flex-col h-full">
      {/* Activity feed at top */}
      {renderActivityHeader()}

      {/* Main chat area */}
      <div className="flex-1 min-h-0">
        <AgentChat<MarketplaceCardData>
          agent={agent}
          getMockResponse={getMockResponse}
          renderMessageCard={(cardData) => (
            <div className="mt-4 rounded-xl overflow-hidden border border-neutral-300 dark:border-neutral-600/50">
              <div className="relative">
                <img src={cardData.listing.image} alt="" className="w-full h-32 object-cover" />
                {cardData.listing.urgency && cardData.listing.urgency !== 'normal' && (
                  <div className={`absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                    cardData.listing.urgency === 'hot'
                      ? 'bg-red-500 text-white'
                      : 'bg-orange-500 text-white'
                  }`}>
                    <Flame className="w-3 h-3" />
                    {cardData.listing.urgency === 'hot' ? 'HOT' : 'URGENT'}
                  </div>
                )}
                {cardData.listing.verified && (
                  <div className="absolute top-2 left-2 px-2 py-1 rounded-lg text-xs font-medium bg-teal-500 text-white flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Verified
                  </div>
                )}
              </div>
              <div className="p-3 bg-neutral-100 dark:bg-neutral-900/80">
                <p className="text-neutral-900 dark:text-white font-medium text-sm">{cardData.listing.title}</p>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-medium">
                      {cardData.listing.seller.avatar}
                    </div>
                    <span className="text-neutral-500 dark:text-neutral-400 text-xs">{cardData.listing.seller.name}</span>
                  </div>
                  <span className="text-teal-600 dark:text-teal-400 font-bold">
                    {cardData.listing.price} {cardData.listing.currency}
                  </span>
                </div>
              </div>
            </div>
          )}
          renderMessageActions={(message: AgentMessage<MarketplaceCardData>) => (
            message.cardData?.listing ? (
              <motion.button
                onClick={() => handleChatWithSeller(message.cardData!.listing)}
                className="mt-3 w-full py-2 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-medium flex items-center justify-center gap-2 border border-blue-500/30"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <MessageSquare className="w-4 h-4" />
                DM {message.cardData.listing.seller.name}
              </motion.button>
            ) : null
          )}
          actionConfig={{
            label: (cardData) => `Make Offer - ${cardData.listing.price} ${cardData.listing.currency}`,
            onAction: handleMakeOffer,
          }}
          bgGradient={{ from: 'bg-teal-500/5', to: 'bg-cyan-500/5' }}
          additionalContent={
            <AnimatePresence>
              {showModal && pendingListing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                  onClick={() => modalStep === 'confirm' && setShowModal(false)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                    onClick={e => e.stopPropagation()}
                  >
                    {modalStep === 'confirm' && (
                      <>
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Make Offer</h3>
                          <button onClick={() => setShowModal(false)} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 mb-4">
                          <img src={pendingListing.image} alt="" className="w-full h-32 object-cover" />
                          <div className="p-4 bg-neutral-100 dark:bg-neutral-800">
                            <p className="text-neutral-900 dark:text-white font-medium">{pendingListing.title}</p>
                            <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{pendingListing.description}</p>
                            <div className="flex items-center gap-2 mt-3 p-2 bg-neutral-200 dark:bg-neutral-700/50 rounded-lg">
                              <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-medium">
                                {pendingListing.seller.avatar}
                              </div>
                              <div>
                                <p className="text-neutral-900 dark:text-white text-sm font-medium flex items-center gap-1">
                                  {pendingListing.seller.name}
                                  {pendingListing.verified && <Shield className="w-3 h-3 text-teal-500" />}
                                </p>
                                <p className="text-neutral-500 dark:text-neutral-400 text-xs">{pendingListing.location}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Offer amount */}
                        <div className="mb-4">
                          <label className="text-neutral-500 dark:text-neutral-400 text-sm mb-2 block">Your offer ({pendingListing.currency}):</label>
                          <input
                            type="number"
                            value={offerAmount}
                            onChange={(e) => setOfferAmount(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white text-lg font-bold focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                          <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-1">
                            Asking price: {pendingListing.price} {pendingListing.currency}
                          </p>
                        </div>

                        {/* Quick amount buttons */}
                        <div className="flex gap-2 mb-6">
                          {[0.9, 0.95, 1].map((multiplier) => (
                            <button
                              key={multiplier}
                              onClick={() => setOfferAmount(Math.round(pendingListing.price * multiplier).toString())}
                              className={`flex-1 py-2 rounded-lg border transition-all text-sm ${
                                parseFloat(offerAmount) === Math.round(pendingListing.price * multiplier)
                                  ? 'border-teal-500 bg-teal-500/20 text-teal-600 dark:text-teal-400'
                                  : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600'
                              }`}
                            >
                              {multiplier === 1 ? 'Full price' : `${multiplier * 100}%`}
                            </button>
                          ))}
                        </div>

                        <motion.button
                          onClick={handleConfirmOffer}
                          className={`w-full py-4 rounded-xl bg-linear-to-r ${agent.color} text-white font-bold flex items-center justify-center gap-2`}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <ShoppingCart className="w-5 h-5" />
                          Send Offer
                        </motion.button>
                      </>
                    )}

                    {modalStep === 'processing' && (
                      <div className="py-12 text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-teal-500/20 flex items-center justify-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          >
                            <Wallet className="w-8 h-8 text-teal-600 dark:text-teal-500" />
                          </motion.div>
                        </div>
                        <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Sending Offer</h3>
                        <p className="text-neutral-500 dark:text-neutral-400">Contacting {pendingListing.seller.name}...</p>
                      </div>
                    )}

                    {modalStep === 'success' && (
                      <div className="py-12 text-center">
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500 flex items-center justify-center"
                        >
                          <CheckCircle className="w-8 h-8 text-white" />
                        </motion.div>
                        <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Offer Sent!</h3>
                        <p className="text-neutral-500 dark:text-neutral-400">{pendingListing.seller.name} will be notified. Check your DMs!</p>
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          }
        />
      </div>
    </div>
  );
}
