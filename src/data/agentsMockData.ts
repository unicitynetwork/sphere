// Centralized mock data for all agents

// ============================================
// Types
// ============================================

export interface GameInfo {
  id: string;
  name: string;
  description: string;
  image: string;
  url: string;
}

export interface Match {
  id: string;
  team1: string;
  team2: string;
  team1Flag: string;
  team2Flag: string;
  date: string;
  time: string;
  odds1: number;
  oddsDraw: number;
  odds2: number;
  image: string;
}

export interface SellerInfo {
  id: string;
  name: string;
  avatar: string;
}

export interface P2PListing {
  id: string;
  name: string;
  price: number;
  seller: SellerInfo;
  image: string;
  description: string;
  location: string;
}

export interface MerchItem {
  id: string;
  name: string;
  price: number;
  image: string;
  description: string;
  sizes: string[];
}

// ============================================
// Gaming Agent Mock Data
// ============================================

export const mockGames: GameInfo[] = [
  {
    id: '1',
    name: 'Quake',
    description: 'Classic arena shooter - fast-paced multiplayer action!',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=200&fit=crop',
    url: 'https://quake.com',
  },
  {
    id: '2',
    name: 'Crypto Poker',
    description: 'Play poker with crypto stakes against real players',
    image: 'https://images.unsplash.com/photo-1511193311914-0346f16efe90?w=400&h=200&fit=crop',
    url: '#',
  },
];

// ============================================
// Sport Betting Agent Mock Data
// ============================================

export const mockMatches: Match[] = [
  {
    id: '1',
    team1: 'Finland',
    team2: 'Estonia',
    team1Flag: '🇫🇮',
    team2Flag: '🇪🇪',
    date: '28.12.25',
    time: '19:00',
    odds1: 1.85,
    oddsDraw: 3.40,
    odds2: 4.20,
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&h=200&fit=crop',
  },
  {
    id: '2',
    team1: 'Germany',
    team2: 'France',
    team1Flag: '🇩🇪',
    team2Flag: '🇫🇷',
    date: '29.12.25',
    time: '21:00',
    odds1: 2.10,
    oddsDraw: 3.20,
    odds2: 2.90,
    image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=400&h=200&fit=crop',
  },
];

// ============================================
// P2P Marketplace Agent Mock Data
// ============================================

export const p2pListings: P2PListing[] = [
  {
    id: '1',
    name: 'Leather Sofa',
    price: 450,
    seller: { id: '1', name: 'Sarah Williams', avatar: 'SW' },
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=200&fit=crop',
    description: 'Genuine leather 3-seater sofa in excellent condition',
    location: 'New York',
  },
  {
    id: '2',
    name: 'iPhone 14 Pro',
    price: 800,
    seller: { id: '2', name: 'Mike Johnson', avatar: 'MJ' },
    image: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=400&h=200&fit=crop',
    description: '128GB, Space Black, like new with original box',
    location: 'Los Angeles',
  },
  {
    id: '3',
    name: 'Mountain Bike',
    price: 350,
    seller: { id: '3', name: 'Alex Chen', avatar: 'AC' },
    image: 'https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=400&h=200&fit=crop',
    description: '21-speed, aluminum frame, barely used',
    location: 'Chicago',
  },
  {
    id: '4',
    name: 'Gaming PC',
    price: 1200,
    seller: { id: '4', name: 'Emma Davis', avatar: 'ED' },
    image: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=400&h=200&fit=crop',
    description: 'RTX 3070, Ryzen 7, 32GB RAM, RGB setup',
    location: 'Miami',
  },
];

// ============================================
// Merch Store Agent Mock Data
// ============================================

export const merchItems: MerchItem[] = [
  {
    id: '1',
    name: 'Unicity Hoodie',
    price: 59.99,
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=200&fit=crop',
    description: 'Premium black hoodie with embroidered Unicity logo',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: '2',
    name: 'Crypto T-Shirt',
    price: 29.99,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=200&fit=crop',
    description: 'Classic fit cotton t-shirt with blockchain design',
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    id: '3',
    name: 'Dev Cap',
    price: 24.99,
    image: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400&h=200&fit=crop',
    description: 'Snapback cap with "Code & Crypto" embroidery',
    sizes: ['One Size'],
  },
  {
    id: '4',
    name: 'Sphere Mug',
    price: 14.99,
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400&h=200&fit=crop',
    description: 'Ceramic mug with color-changing Sphere logo',
    sizes: ['Standard'],
  },
];

// ============================================
// Trivia Agent Mock Responses
// ============================================

export function getTriviaMockResponse(userInput: string): string {
  const input = userInput.toLowerCase();

  if (input.includes('start') || input.includes('play') || input.includes('question')) {
    return `Great! Here's a trivia question for you:

**Category: Science**
**Difficulty: Medium**

What is the chemical symbol for gold?

A) Ag
B) Au
C) Fe
D) Cu

Reply with your answer!`;
  }

  if (input.includes('a') || input.includes('b') || input.includes('c') || input.includes('d')) {
    const isCorrect = input.includes('b');
    return isCorrect
      ? `Correct! The answer is **Au** (from Latin "aurum"). Your score: 1 point. Want another question?`
      : `Not quite! The correct answer is **B) Au** (from Latin "aurum"). Want to try another question?`;
  }

  if (input.includes('categor')) {
    return `Available categories:
- Science & Nature
- History
- Geography
- Entertainment
- Sports

Say "start" or ask for a question from a specific category!`;
  }

  return `Welcome to Trivia! I can quiz you on various topics. Say "start" to begin, or ask for "categories" to see available topics!`;
}

export function getAmaMockResponse(): string {
  return `I'd be happy to help you research that topic! In real mode, I can fetch information from the web. Currently in mock mode - switch to real mode to enable web fetching.`;
}

export function getDefaultMockResponse(): string {
  return `This is a mock response. Remove VITE_USE_MOCK_AGENTS to get actual AI responses.`;
}

// Games Agent Mock Responses
// ============================================
// Buy/Sell Anything Marketplace Mock Data
// ============================================

export type MarketplaceCategory = 'gold' | 'tickets' | 'asics' | 'all';

export interface MarketplaceListing {
  id: string;
  category: MarketplaceCategory;
  title: string;
  description: string;
  price: number;
  currency: string;
  image: string;
  seller: SellerInfo;
  location?: string;
  urgency?: 'normal' | 'urgent' | 'hot';
  verified?: boolean;
}

export interface MarketplaceIntent {
  id: string;
  type: 'buy' | 'sell';
  user: string;
  message: string;
  category: MarketplaceCategory;
  timestamp: string;
}

export const marketplaceListings: MarketplaceListing[] = [
  // Gold
  {
    id: 'mg1',
    category: 'gold',
    title: '1oz PAMP Suisse Gold Bar',
    description: 'Brand new, sealed. Certificate included. Available for pickup in Dubai or London.',
    price: 2150,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=200&fit=crop',
    seller: { id: 'g1', name: 'GoldDealer_UAE', avatar: 'GD' },
    location: 'Dubai, UAE',
    verified: true,
    urgency: 'hot',
  },
  {
    id: 'mg2',
    category: 'gold',
    title: '10x 1oz Silver Coins - Austrian Philharmonic',
    description: '2024 Austrian Philharmonic silver coins. Tube of 10. Spot + 3%.',
    price: 285,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1607292803062-5b3f2c0b5c6d?w=400&h=200&fit=crop',
    seller: { id: 'g2', name: 'SilverStack', avatar: 'SS' },
    location: 'London, UK',
  },
  // Tickets
  {
    id: 'mt1',
    category: 'tickets',
    title: 'UFC 315 - Cage Side Seats x2',
    description: 'Premium cage side seats. Can\'t attend anymore. Face value was $3500 each. Open to offers.',
    price: 5500,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=400&h=200&fit=crop',
    seller: { id: 't1', name: 'FightFan', avatar: 'FF' },
    location: 'Las Vegas',
    urgency: 'urgent',
  },
  {
    id: 'mt2',
    category: 'tickets',
    title: 'Coldplay World Tour - VIP Package',
    description: 'Munich show, VIP package includes early entry, exclusive merch, and meet & greet chance.',
    price: 450,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&h=200&fit=crop',
    seller: { id: 't2', name: 'ConcertHopper', avatar: 'CH' },
    location: 'Munich, Germany',
  },
  {
    id: 'mt3',
    category: 'tickets',
    title: 'World Cup 2026 - England vs Argentina',
    description: 'Group stage match. Category 1 seats. Verified through FIFA portal.',
    price: 1800,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&h=200&fit=crop',
    seller: { id: 't3', name: 'FootballAgent', avatar: 'FA' },
    location: 'USA',
    verified: true,
    urgency: 'hot',
  },
  // ASICs / Mining Hardware
  {
    id: 'ma1',
    category: 'asics',
    title: 'Antminer S21 200TH/s',
    description: 'Brand new, unopened. Bitmain warranty valid. 17.5 J/TH efficiency. Perfect for Bitcoin mining.',
    price: 4200,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop',
    seller: { id: 'a1', name: 'MiningPro', avatar: 'MP' },
    location: 'Texas, USA',
    verified: true,
  },
  {
    id: 'ma2',
    category: 'asics',
    title: 'Antminer KS5 Pro - Kaspa Miner',
    description: '21 TH/s Kaspa miner. 6 months old with remaining warranty. Selling due to facility upgrade.',
    price: 8500,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&h=200&fit=crop',
    seller: { id: 'a2', name: 'KaspaKing', avatar: 'KK' },
    location: 'Iceland',
    urgency: 'urgent',
  },
  {
    id: 'ma3',
    category: 'asics',
    title: '5x GPU Mining Rig - RTX 4090',
    description: 'Complete rig with 5x RTX 4090. Frame, PSU, mobo included. Great for AI/ML or mining.',
    price: 12000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=400&h=200&fit=crop',
    seller: { id: 'a3', name: 'GPUFarm', avatar: 'GF' },
    location: 'Singapore',
  },
];

// Simulated activity feed - intents from other users
export const marketplaceActivity: MarketplaceIntent[] = [
  {
    id: 'i1',
    type: 'sell',
    user: 'GoldBug_Dubai',
    message: 'Have 5oz PAMP gold available at spot + 1.5%',
    category: 'gold',
    timestamp: '2 min ago',
  },
  {
    id: 'i2',
    type: 'buy',
    user: 'CryptoMiner_TX',
    message: 'Urgent: Need Antminer S21, paying premium for quick deal',
    category: 'asics',
    timestamp: '5 min ago',
  },
  {
    id: 'i3',
    type: 'buy',
    user: 'FootballFan_UK',
    message: 'Want World Cup tickets - England, France or Argentina matches',
    category: 'tickets',
    timestamp: '8 min ago',
  },
  {
    id: 'i4',
    type: 'buy',
    user: 'TicketHunter',
    message: 'Auto-buy any Coldplay tickets under €300 for EU shows',
    category: 'tickets',
    timestamp: '12 min ago',
  },
  {
    id: 'i5',
    type: 'sell',
    user: 'MiningExodus',
    message: 'Liquidating farm: 20x S19 Pro, bulk discount available',
    category: 'asics',
    timestamp: '18 min ago',
  },
  {
    id: 'i6',
    type: 'buy',
    user: 'PreciousMetals',
    message: 'Monitor gold spot, alert when 1oz bars under 2% premium',
    category: 'gold',
    timestamp: '22 min ago',
  },
];

export function getMarketplaceListingsByCategory(category: MarketplaceCategory): MarketplaceListing[] {
  if (category === 'all') return marketplaceListings;
  return marketplaceListings.filter(l => l.category === category);
}

export function getGamesMockResponse(userInput: string): string {
  const input = userInput.toLowerCase();

  if (input.includes('quake')) {
    return `**Quake** - The legendary arena shooter!

Fast-paced multiplayer combat with rocket launchers, railguns, and lightning guns. Test your reflexes against players worldwide!

Click the link below to start playing:`;
  }

  if (input.includes('poker')) {
    return `**Crypto Poker** - High stakes, real crypto!

Play Texas Hold'em with cryptocurrency. Win big or just have fun - it's up to you!

Click below to join a table:`;
  }

  if (input.includes('game') || input.includes('play') || input.includes('show')) {
    return `Here are the games available right now:

Pick one to get started!`;
  }

  return `I can help you find games! Try asking:

• "Show me games"
• "Tell me about Quake"
• "I want to play poker"

What sounds fun?`;
}
