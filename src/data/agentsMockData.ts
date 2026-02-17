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

// ============================================
// Games Agent Mock Responses
// ============================================

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
