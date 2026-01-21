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
  {
    id: '5',
    name: 'MacBook Pro 16"',
    price: 1800,
    seller: { id: '5', name: 'David Kim', avatar: 'DK' },
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=200&fit=crop',
    description: 'M2 Pro, 16GB RAM, 512GB SSD, AppleCare until 2025',
    location: 'San Francisco',
  },
  {
    id: '6',
    name: 'Vintage Watch',
    price: 650,
    seller: { id: '6', name: 'James Miller', avatar: 'JM' },
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=200&fit=crop',
    description: 'Classic automatic movement, leather strap, serviced recently',
    location: 'Boston',
  },
  {
    id: '7',
    name: 'Electric Scooter',
    price: 400,
    seller: { id: '7', name: 'Lisa Park', avatar: 'LP' },
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=200&fit=crop',
    description: '25km range, foldable, includes charger and helmet',
    location: 'Seattle',
  },
  {
    id: '8',
    name: 'Sony PS5',
    price: 450,
    seller: { id: '8', name: 'Ryan Brown', avatar: 'RB' },
    image: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=400&h=200&fit=crop',
    description: 'Disc edition, 2 controllers, 5 games included',
    location: 'Denver',
  },
  {
    id: '9',
    name: 'Standing Desk',
    price: 280,
    seller: { id: '9', name: 'Nicole Garcia', avatar: 'NG' },
    image: 'https://images.unsplash.com/photo-1593062096033-9a26b09da705?w=400&h=200&fit=crop',
    description: 'Electric height adjustable, 140x70cm, memory presets',
    location: 'Austin',
  },
  {
    id: '10',
    name: 'Camera Kit',
    price: 950,
    seller: { id: '10', name: 'Tom Wilson', avatar: 'TW' },
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=200&fit=crop',
    description: 'Canon EOS R50 + 18-150mm lens + bag + extra battery',
    location: 'Portland',
  },
  {
    id: '11',
    name: 'Dining Table Set',
    price: 550,
    seller: { id: '11', name: 'Maria Lopez', avatar: 'ML' },
    image: 'https://images.unsplash.com/photo-1617806118233-18e1de247200?w=400&h=200&fit=crop',
    description: 'Solid oak table with 6 chairs, modern design',
    location: 'Phoenix',
  },
  {
    id: '12',
    name: 'Drone DJI Mini 3',
    price: 620,
    seller: { id: '12', name: 'Kevin Lee', avatar: 'KL' },
    image: 'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&h=200&fit=crop',
    description: '4K camera, 38min flight time, includes Fly More combo',
    location: 'San Diego',
  },
  {
    id: '13',
    name: 'Acoustic Guitar',
    price: 320,
    seller: { id: '13', name: 'Chris Taylor', avatar: 'CT' },
    image: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=200&fit=crop',
    description: 'Taylor Big Baby, solid spruce top, gig bag included',
    location: 'Nashville',
  },
  {
    id: '14',
    name: 'Smart TV 65"',
    price: 580,
    seller: { id: '14', name: 'Anna White', avatar: 'AW' },
    image: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=400&h=200&fit=crop',
    description: 'Samsung QLED 4K, wall mount included, 2 years old',
    location: 'Dallas',
  },
  {
    id: '15',
    name: 'Treadmill',
    price: 480,
    seller: { id: '15', name: 'Mark Johnson', avatar: 'MJ' },
    image: 'https://images.unsplash.com/photo-1576678927484-cc907957088c?w=400&h=200&fit=crop',
    description: 'NordicTrack, foldable, incline feature, heart rate monitor',
    location: 'Houston',
  },
  {
    id: '16',
    name: 'Vintage Armchair',
    price: 290,
    seller: { id: '16', name: 'Sophie Brown', avatar: 'SB' },
    image: 'https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=400&h=200&fit=crop',
    description: 'Mid-century modern design, reupholstered in velvet',
    location: 'New York',
  },
  {
    id: '17',
    name: 'iPad Pro 12.9"',
    price: 720,
    seller: { id: '17', name: 'Jason Clark', avatar: 'JC' },
    image: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400&h=200&fit=crop',
    description: 'M1 chip, 256GB, WiFi + Cellular, Magic Keyboard included',
    location: 'Los Angeles',
  },
  {
    id: '18',
    name: 'Road Bike',
    price: 680,
    seller: { id: '18', name: 'Peter Adams', avatar: 'PA' },
    image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400&h=200&fit=crop',
    description: 'Carbon frame, Shimano 105 groupset, size 56cm',
    location: 'Chicago',
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

// Popular locations for the marketplace
export const MARKETPLACE_LOCATIONS = [
  'Dubai, UAE', 'London, UK', 'New York, USA', 'Los Angeles, USA', 'Singapore',
  'Hong Kong', 'Tokyo, Japan', 'Sydney, Australia', 'Toronto, Canada', 'Miami, USA',
  'Las Vegas, USA', 'Munich, Germany', 'Paris, France', 'Zurich, Switzerland', 'Amsterdam, Netherlands',
];

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
    seller: { id: 'g1', name: '@golddealer_uae', avatar: 'GD' },
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
    seller: { id: 'g2', name: '@silverstack', avatar: 'SS' },
    location: 'London, UK',
  },
  {
    id: 'mg3',
    category: 'gold',
    title: '5oz Perth Mint Gold Bar',
    description: 'Perth Mint certified. Serial number documented. Secure vault storage available.',
    price: 10500,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=200&fit=crop',
    seller: { id: 'g3', name: '@aussiegold', avatar: 'AG' },
    location: 'Sydney, Australia',
    verified: true,
  },
  {
    id: 'mg4',
    category: 'gold',
    title: '20x American Gold Eagle 1oz',
    description: 'Full tube of 2024 American Gold Eagles. Will split. Spot + 4%.',
    price: 43000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=200&fit=crop',
    seller: { id: 'g4', name: '@nycbullion', avatar: 'NY' },
    location: 'New York, USA',
    verified: true,
    urgency: 'hot',
  },
  {
    id: 'mg5',
    category: 'gold',
    title: '100g Valcambi Gold CombiBar',
    description: 'Divisible 100x1g gold bar. Perfect for fractional sales. Swiss made.',
    price: 6800,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400&h=200&fit=crop',
    seller: { id: 'g5', name: '@swissvault', avatar: 'SV' },
    location: 'Zurich, Switzerland',
    verified: true,
  },
  {
    id: 'mg6',
    category: 'gold',
    title: '50x Silver Maple Leaf Monster Box',
    description: 'Royal Canadian Mint. Factory sealed monster box. 500oz total.',
    price: 14200,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1607292803062-5b3f2c0b5c6d?w=400&h=200&fit=crop',
    seller: { id: 'g6', name: '@canadasilver', avatar: 'CS' },
    location: 'Toronto, Canada',
    urgency: 'urgent',
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
    seller: { id: 't1', name: '@fightfan', avatar: 'FF' },
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
    seller: { id: 't2', name: '@concerthopper', avatar: 'CH' },
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
    seller: { id: 't3', name: '@footballagent', avatar: 'FA' },
    location: 'New York, USA',
    verified: true,
    urgency: 'hot',
  },
  {
    id: 'mt4',
    category: 'tickets',
    title: 'Formula 1 Monaco GP - Paddock Club',
    description: 'Ultimate F1 experience. Paddock access, pit lane walks, gourmet catering. 2 passes.',
    price: 8500,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1504707748692-419802cf939d?w=400&h=200&fit=crop',
    seller: { id: 't4', name: '@f1insider', avatar: 'F1' },
    location: 'Monaco',
    verified: true,
    urgency: 'hot',
  },
  {
    id: 'mt5',
    category: 'tickets',
    title: 'Taylor Swift Eras Tour - Floor Seats x4',
    description: 'Sydney show. Floor section B, row 15. Selling as group only.',
    price: 3200,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&h=200&fit=crop',
    seller: { id: 't5', name: '@swiftie_au', avatar: 'SA' },
    location: 'Sydney, Australia',
    urgency: 'urgent',
  },
  {
    id: 'mt6',
    category: 'tickets',
    title: 'Champions League Final 2026',
    description: 'Category 2 tickets. Location TBA. Transferable via UEFA app.',
    price: 2400,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&h=200&fit=crop',
    seller: { id: 't6', name: '@eurofootball', avatar: 'EF' },
    location: 'London, UK',
    verified: true,
  },
  {
    id: 'mt7',
    category: 'tickets',
    title: 'Rolling Stones - Hackney Diamonds Tour',
    description: 'VIP package Tokyo show. Front section + meet & greet lottery entry.',
    price: 1200,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&h=200&fit=crop',
    seller: { id: 't7', name: '@tokyorock', avatar: 'TR' },
    location: 'Tokyo, Japan',
  },
  {
    id: 'mt8',
    category: 'tickets',
    title: 'NBA Finals Game 7 - Courtside',
    description: 'If it goes to Game 7, I have 2 courtside seats. Deposit required.',
    price: 15000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400&h=200&fit=crop',
    seller: { id: 't8', name: '@courtking', avatar: 'CK' },
    location: 'Los Angeles, USA',
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
    seller: { id: 'a1', name: '@miningpro', avatar: 'MP' },
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
    seller: { id: 'a2', name: '@kaspaking', avatar: 'KK' },
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
    seller: { id: 'a3', name: '@gpufarm', avatar: 'GF' },
    location: 'Singapore',
  },
  {
    id: 'ma4',
    category: 'asics',
    title: 'Whatsminer M50S++ 140TH/s x10',
    description: 'Bulk deal - 10 units. All tested and hashing. Great for small farm setup.',
    price: 28000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop',
    seller: { id: 'a4', name: '@bulkminer', avatar: 'BM' },
    location: 'Dubai, UAE',
    verified: true,
    urgency: 'hot',
  },
  {
    id: 'ma5',
    category: 'asics',
    title: 'Bitmain Antminer L9 16GH/s',
    description: 'Scrypt miner for LTC/DOGE. Latest generation. 3 months old.',
    price: 11500,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop',
    seller: { id: 'a5', name: '@dogewhale', avatar: 'DW' },
    location: 'Hong Kong',
    verified: true,
  },
  {
    id: 'ma6',
    category: 'asics',
    title: 'IceRiver KS3M Kaspa Miner',
    description: '6TH/s Kaspa beast. Runs cool, quiet. Perfect for home mining.',
    price: 4800,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&h=200&fit=crop',
    seller: { id: 'a6', name: '@homeminer', avatar: 'HM' },
    location: 'Amsterdam, Netherlands',
  },
  {
    id: 'ma7',
    category: 'asics',
    title: 'Full Mining Container - 200 S19 Pro',
    description: '40ft container with 200 Antminer S19 Pro. 20MW total. Turnkey solution.',
    price: 450000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop',
    seller: { id: 'a7', name: '@industrialmining', avatar: 'IM' },
    location: 'Texas, USA',
    verified: true,
    urgency: 'urgent',
  },
  {
    id: 'ma8',
    category: 'asics',
    title: 'Goldshell AL-BOX Alephium Miner',
    description: 'Compact ALPH miner. 180W only. Silent operation. WiFi enabled.',
    price: 850,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&h=200&fit=crop',
    seller: { id: 'a8', name: '@alphminer', avatar: 'AM' },
    location: 'Paris, France',
  },
  {
    id: 'ma9',
    category: 'asics',
    title: 'Avalon Made A1466 150TH/s x5',
    description: 'Canaan miners. Bulk of 5 units. Competitive efficiency at 20 J/TH.',
    price: 16000,
    currency: 'USDC',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=200&fit=crop',
    seller: { id: 'a9', name: '@canadamining', avatar: 'CM' },
    location: 'Toronto, Canada',
    verified: true,
  },
];

// Simulated activity feed - intents from other users
export const marketplaceActivity: MarketplaceIntent[] = [
  {
    id: 'i1',
    type: 'buy',
    user: '@goldbug_dubai',
    message: 'Looking for 1oz gold bars, any mint',
    category: 'gold',
    timestamp: '2 min ago',
  },
  {
    id: 'i2',
    type: 'buy',
    user: '@cryptominer_tx',
    message: 'Need Antminer S21, paying in USDC',
    category: 'asics',
    timestamp: '5 min ago',
  },
  {
    id: 'i3',
    type: 'buy',
    user: '@footballfan_uk',
    message: 'Searching for World Cup tickets',
    category: 'tickets',
    timestamp: '8 min ago',
  },
  {
    id: 'i4',
    type: 'buy',
    user: '@tickethunter',
    message: 'Want Coldplay tickets for EU shows',
    category: 'tickets',
    timestamp: '12 min ago',
  },
  {
    id: 'i5',
    type: 'buy',
    user: '@miningfarm_sg',
    message: 'Looking for bulk S19 Pro deal',
    category: 'asics',
    timestamp: '18 min ago',
  },
  {
    id: 'i6',
    type: 'buy',
    user: '@silverstack',
    message: 'Need silver coins, any quantity',
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
