import { useState, useRef } from 'react';
import { X, MessageSquare, Wallet, CheckCircle, Sparkles, ShoppingCart, Tag, ArrowUpRight, ArrowDownLeft, Flame, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig } from '../../config/activities';
import {
  marketplaceListings,
  marketplaceActivity,
  getMarketplaceListingsByCategory,
  MARKETPLACE_LOCATIONS,
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
                      {intent.user}
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

  // Handle clicking on user in activity feed - navigate to DM
  const handleActivityUserClick = (username: string) => {
    const nametag = username.startsWith('@') ? username : `@${username}`;
    navigate(`/agents/chat?nametag=${encodeURIComponent(nametag)}`);
  };

  // User location state
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const hasAskedLocation = useRef(false);
  const waitingForLocation = useRef(false); // True when we're expecting a location response
  const pendingQuery = useRef<string | null>(null); // Store user's query while asking for location

  // Category filter state
  const [selectedCategory, setSelectedCategory] = useState<MarketplaceCategory>('all');

  // Purchase/contact modal state
  const [showModal, setShowModal] = useState(false);
  const [pendingListing, setPendingListing] = useState<MarketplaceListing | null>(null);
  const [modalStep, setModalStep] = useState<'confirm' | 'processing' | 'success'>('confirm');
  const [offerAmount, setOfferAmount] = useState('');

  // Helper to find listings by category, prioritizing user's location
  const findListings = (category: MarketplaceCategory): MarketplaceListing[] => {
    const listings = getMarketplaceListingsByCategory(category);
    if (userLocation) {
      return [...listings].sort((a, b) => {
        const aLocal = a.location?.toLowerCase().includes(userLocation.toLowerCase()) ?? false;
        const bLocal = b.location?.toLowerCase().includes(userLocation.toLowerCase()) ?? false;
        if (aLocal && !bLocal) return -1;
        if (!aLocal && bLocal) return 1;
        return 0;
      });
    }
    return listings;
  };

  const handleChatWithSeller = (listing: MarketplaceListing) => {
    const params = new URLSearchParams({
      nametag: listing.seller.name,
      product: listing.title,
      image: listing.image,
      price: listing.price.toString(),
    });
    navigate(`/agents/chat?${params.toString()}`);
  };

  // Helper to format seller list from listings
  const formatSellerList = (listings: MarketplaceListing[], categoryName: string): string => {
    const count = listings.length;

    if (count === 0) {
      return `No ${categoryName} listings available right now.`;
    }

    if (count === 1) {
      const l = listings[0];
      const verifiedBadge = l.verified ? ' ✓' : '';
      const nearbyBadge = userLocation && l.location?.toLowerCase().includes(userLocation.split(',')[0].toLowerCase()) ? ' (nearby)' : '';
      return `Found **1 seller** with ${categoryName}:\n\n` +
        `• ${l.seller.name}${verifiedBadge}${nearbyBadge} — **${l.title}** — ${l.price} ${l.currency}\n\n` +
        `DM them to discuss!`;
    }

    // Multiple listings
    const sellerLines = listings.slice(0, 5).map(l => {
      const verifiedBadge = l.verified ? ' ✓' : '';
      const nearbyBadge = userLocation && l.location?.toLowerCase().includes(userLocation.split(',')[0].toLowerCase()) ? ' (nearby)' : '';
      return `• ${l.seller.name}${verifiedBadge}${nearbyBadge} — **${l.title}** — ${l.price} ${l.currency}`;
    }).join('\n');

    const moreText = count > 5 ? `\n\n...and ${count - 5} more` : '';

    return `Found **${count} sellers** with ${categoryName}:\n\n${sellerLines}${moreText}\n\nDM any seller to discuss!`;
  };

  // Helper to process a search query and show matching listings
  const processSearchQuery = (
    query: string,
    addMessage: (content: string, cardData?: MarketplaceCardData, showActionButton?: boolean) => void
  ): boolean => {
    const input = query.toLowerCase();

    // Gold / Precious Metals
    if (input.includes('gold') || input.includes('silver') || input.includes('pamp') || input.includes('bar') || input.includes('precious')) {
      const listings = findListings('gold');
      addMessage(formatSellerList(listings, 'gold/precious metals'));
      return true;
    }

    // Tickets / Events
    if (input.includes('ticket') || input.includes('concert') || input.includes('ufc') || input.includes('world cup') || input.includes('coldplay') || input.includes('event') || input.includes('f1') || input.includes('formula') || input.includes('taylor') || input.includes('nba') || input.includes('champions')) {
      const listings = findListings('tickets');
      addMessage(formatSellerList(listings, 'tickets'));
      return true;
    }

    // ASICs / Mining Hardware
    if (input.includes('asic') || input.includes('antminer') || input.includes('miner') || input.includes('mining') || input.includes('gpu') || input.includes('rig') || input.includes('kaspa') || input.includes('s21') || input.includes('ks5') || input.includes('whatsminer') || input.includes('goldshell') || input.includes('avalon')) {
      const listings = findListings('asics');
      addMessage(formatSellerList(listings, 'mining hardware'));
      return true;
    }

    // Phone / Electronics - not available
    if (input.includes('phone') || input.includes('iphone') || input.includes('samsung') || input.includes('android') || input.includes('mobile') || input.includes('laptop') || input.includes('macbook') || input.includes('electronics')) {
      addMessage(
        "No sellers with phones or electronics right now.\n\n" +
        "**Available categories:**\n" +
        "- Gold & precious metals\n" +
        "- Event tickets\n" +
        "- Mining hardware (ASICs)\n\n" +
        "Want me to notify you when electronics appear?"
      );
      return true;
    }

    // Check if user is trying to buy something specific that we don't have
    const buyPatterns = /(?:buy|want|need|looking for|find|get|purchase|searching for)\s+(?:a\s+|an\s+|some\s+)?(.+)/i;
    const buyMatch = input.match(buyPatterns);
    if (buyMatch) {
      const productName = buyMatch[1].replace(/[?.!,]+$/, '').trim();
      if (productName && productName.length > 1 && productName.length < 50) {
        addMessage(
          `No sellers with **"${productName}"** right now.\n\n` +
          "**Available categories:**\n" +
          "- Gold & precious metals\n" +
          "- Event tickets\n" +
          "- Mining hardware (ASICs)\n\n" +
          `Want me to watch for "${productName}" listings?`
        );
        return true;
      }
    }

    return false; // Query not handled
  };

  const getMockResponse = async (
    userInput: string,
    addMessage: (content: string, cardData?: MarketplaceCardData, showActionButton?: boolean) => void
  ) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    const input = userInput.toLowerCase();

    // Check if user is setting their location
    const locationPatterns = MARKETPLACE_LOCATIONS.map(loc => loc.toLowerCase());
    const locationMatch = locationPatterns.find(loc =>
      input.includes(loc) ||
      input.includes(loc.split(',')[0].toLowerCase()) // Match city name only
    );

    if (locationMatch || input.match(/(?:i(?:'m| am) (?:in|from|at|near)|my location is|location[:\s]+)/i)) {
      const matchedLocation = locationMatch
        ? MARKETPLACE_LOCATIONS.find(l => l.toLowerCase() === locationMatch || l.toLowerCase().startsWith(locationMatch.split(',')[0]))
        : null;

      if (matchedLocation) {
        setUserLocation(matchedLocation);
        hasAskedLocation.current = true;
        waitingForLocation.current = false;

        // Check if we have a pending query to process
        if (pendingQuery.current) {
          const savedQuery = pendingQuery.current;
          pendingQuery.current = null;

          addMessage(`Got it! You're near **${matchedLocation}**. Let me find what you're looking for...`);

          // Small delay then process the original query
          await new Promise(resolve => setTimeout(resolve, 500));

          // Process the saved query with location context
          const handled = processSearchQuery(savedQuery, addMessage);
          if (!handled) {
            // If query wasn't a specific search, show general info
            addMessage(
              `I'll prioritize deals from your area.\n\n**Available categories:**\n- Gold & precious metals\n- Event tickets\n- Mining hardware (ASICs)\n\nWhat would you like to browse?`
            );
          }
          return;
        }

        // No pending query - show generic location confirmation
        const nearbyListings = marketplaceListings.filter(l =>
          l.location?.toLowerCase().includes(matchedLocation.toLowerCase()) ||
          l.location?.toLowerCase().includes(matchedLocation.split(',')[0].toLowerCase())
        );

        if (nearbyListings.length > 0) {
          addMessage(
            `Got it! You're near **${matchedLocation}**.\n\nI found **${nearbyListings.length}** listing(s) nearby:\n\n` +
            nearbyListings.slice(0, 5).map(l => `- **${l.title}** - ${l.price} ${l.currency}`).join('\n') +
            "\n\nWhat are you looking to buy or sell today?"
          );
        } else {
          addMessage(
            `Got it! You're near **${matchedLocation}**.\n\nI'll prioritize deals from your area. What are you looking for?\n\n**Categories:**\n- Gold & precious metals\n- Event tickets\n- Mining hardware (ASICs)`
          );
        }
        return;
      }
    }

    // First interaction - ask for location if not set
    if (!hasAskedLocation.current && !userLocation) {
      hasAskedLocation.current = true;
      waitingForLocation.current = true;
      // Save the user's query to process after they provide location
      pendingQuery.current = userInput;
      addMessage(
        "Welcome to the P2P marketplace! Before I help you, let me know your location so I can show nearby deals first.\n\n" +
        "**Popular locations:**\n" +
        MARKETPLACE_LOCATIONS.slice(0, 6).map(loc => `- ${loc}`).join('\n') +
        "\n\nJust tell me where you're at, or say \"skip\" to browse everything!"
      );
      return;
    }

    // Handle response when we're waiting for location (user entered something not in our list)
    if (waitingForLocation.current && !userLocation) {
      waitingForLocation.current = false;

      // User provided a location we don't have specific listings for
      const userProvidedLocation = userInput.trim();
      setUserLocation(userProvidedLocation); // Accept their location anyway

      if (pendingQuery.current) {
        const savedQuery = pendingQuery.current;
        pendingQuery.current = null;

        addMessage(`Got it! I don't have specific listings for **${userProvidedLocation}** yet, but I'll show you global deals.\n\nLet me find what you're looking for...`);
        await new Promise(resolve => setTimeout(resolve, 500));

        const handled = processSearchQuery(savedQuery, addMessage);
        if (!handled) {
          addMessage(
            "**Available categories:**\n- Gold & precious metals\n- Event tickets (UFC, concerts, sports)\n- Mining hardware (ASICs, GPUs)\n\nWhat would you like to browse?"
          );
        }
        return;
      }

      addMessage(
        `Got it! I don't have specific listings for **${userProvidedLocation}** yet, but I can show you global deals.\n\n**Available categories:**\n- Gold & precious metals\n- Event tickets\n- Mining hardware (ASICs)\n\nWhat are you looking for?`
      );
      return;
    }

    // Handle skip location
    if (input.includes('skip') && !userLocation) {
      waitingForLocation.current = false;
      // Process pending query if exists
      if (pendingQuery.current) {
        const savedQuery = pendingQuery.current;
        pendingQuery.current = null;

        addMessage("No problem! I'll show you global deals. Let me find what you're looking for...");
        await new Promise(resolve => setTimeout(resolve, 500));

        const handled = processSearchQuery(savedQuery, addMessage);
        if (!handled) {
          addMessage(
            "**Available categories:**\n- Gold & precious metals\n- Event tickets (UFC, concerts, sports)\n- Mining hardware (ASICs, GPUs)\n\nOr say \"browse\" to see everything!"
          );
        }
        return;
      }

      addMessage(
        "No problem! I'll show you global deals.\n\nWhat are you interested in?\n\n" +
        "**Categories:**\n- Gold & precious metals\n- Event tickets (UFC, concerts, sports)\n- Mining hardware (ASICs, GPUs)\n\nOr say \"browse\" to see everything!"
      );
      return;
    }

    // Try to process as a search query first
    if (processSearchQuery(input, addMessage)) {
      return;
    }

    // Selling intent
    if (input.includes('sell') || input.includes('selling') || input.includes('have') || input.includes('offering')) {
      const locationPrompt = userLocation ? '' : '\n3. **Location** (for physical items)';
      addMessage(
        "Great! To list your item, I need some details:\n\n1. **What are you selling?** (e.g., gold bars, tickets, mining hardware)\n2. **Your asking price** (in USDC)" + locationPrompt + "\n4. **Description** of the item\n\nOnce you provide these, I'll create a listing and broadcast it to potential buyers on the network!"
      );
      return;
    }

    // Change location
    if (input.includes('change location') || input.includes('set location') || input.includes('update location')) {
      hasAskedLocation.current = false;
      setUserLocation(null);
      addMessage(
        "Sure! What's your new location?\n\n**Popular locations:**\n" +
        MARKETPLACE_LOCATIONS.slice(0, 6).map(loc => `- ${loc}`).join('\n')
      );
      return;
    }

    // Browse / Show all
    if (input.includes('show') || input.includes('browse') || input.includes('list') || input.includes('available') || input.includes('what')) {
      const goldListings = findListings('gold');
      const ticketListings = findListings('tickets');
      const asicListings = findListings('asics');

      const locationNote = userLocation ? ` (showing ${userLocation} deals first)` : '';

      addMessage(
        `Here's what's available${locationNote}:\n\n` +
        "**Gold & Precious Metals:**\n" +
        goldListings.slice(0, 3).map(l => {
          const nearby = userLocation && l.location?.toLowerCase().includes(userLocation.split(',')[0].toLowerCase()) ? ' (Nearby!)' : '';
          return `- ${l.title} - ${l.price} ${l.currency}${nearby}`;
        }).join('\n') +
        "\n\n**Event Tickets:**\n" +
        ticketListings.slice(0, 3).map(l => {
          const nearby = userLocation && l.location?.toLowerCase().includes(userLocation.split(',')[0].toLowerCase()) ? ' (Nearby!)' : '';
          return `- ${l.title} - ${l.price} ${l.currency}${nearby}`;
        }).join('\n') +
        "\n\n**Mining Hardware (ASICs):**\n" +
        asicListings.slice(0, 3).map(l => {
          const nearby = userLocation && l.location?.toLowerCase().includes(userLocation.split(',')[0].toLowerCase()) ? ' (Nearby!)' : '';
          return `- ${l.title} - ${l.price} ${l.currency}${nearby}`;
        }).join('\n') +
        "\n\nAsk me about any category for more details!"
      );
      return;
    }

    // Default response
    const locationInfo = userLocation ? `\n\nCurrently showing deals near **${userLocation}**. Say "change location" to update.` : '';
    addMessage(
      "I can help you buy or sell almost anything P2P!\n\n**Try asking:**\n" +
      "- \"Show me gold listings\"\n" +
      "- \"Anyone selling Coldplay tickets?\"\n" +
      "- \"Need an Antminer S21\"\n" +
      "- \"I want to sell my mining rig\"\n\n" +
      "Or browse by category using the tabs above!" + locationInfo
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
