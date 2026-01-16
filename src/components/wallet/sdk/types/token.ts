/**
 * Token Types (Platform-Independent)
 *
 * Core token types that can be used across all platforms:
 * - Browser (web app, extension)
 * - Node.js (CLI tools, server)
 * - React Native (mobile apps)
 *
 * These types define the business logic layer for tokens,
 * without any UI-specific or platform-specific dependencies.
 */

// ==========================================
// Token Status
// ==========================================

/**
 * Token lifecycle status
 */
export const TokenStatus = {
  /** Token transaction is pending confirmation */
  PENDING: 'PENDING',
  /** Token transaction has been submitted to aggregator */
  SUBMITTED: 'SUBMITTED',
  /** Token has been transferred to another address */
  TRANSFERRED: 'TRANSFERRED',
  /** Token transaction is confirmed on the network */
  CONFIRMED: 'CONFIRMED',
  /** Token has been burned (split operation) */
  BURNED: 'BURNED',
  /** Token transaction failed */
  FAILED: 'FAILED',
} as const;

export type TokenStatus = typeof TokenStatus[keyof typeof TokenStatus];

// ==========================================
// Transaction Type
// ==========================================

/**
 * Transaction direction type
 */
export const TransactionType = {
  RECEIVED: 'RECEIVED',
  SENT: 'SENT',
} as const;

export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

// ==========================================
// Base Token Interface
// ==========================================

/**
 * Base token interface - minimal fields required for SDK operations
 *
 * This interface is implemented by app-specific Token classes.
 * It provides enough information for:
 * - Token split calculations
 * - Token validation
 * - Token serialization
 * - Transfer operations
 */
export interface BaseToken {
  /** Unique token identifier (64-char hex from genesis) */
  id: string;

  /** Token display name */
  name: string;

  /** Token type identifier */
  type: string;

  /** Creation/receive timestamp (epoch ms) */
  timestamp: number;

  /** Serialized TXF JSON data */
  jsonData?: string;

  /** Token size in bytes */
  sizeBytes: number;

  /** Current lifecycle status */
  status: TokenStatus;

  /** Token amount as string (BigInt safe) */
  amount?: string;

  /** Coin ID (64-char hex) */
  coinId?: string;

  /** Token symbol (e.g., "UCT", "NFT") */
  symbol?: string;

  /** Public key of sender (for received tokens) */
  senderPubkey?: string;
}

/**
 * Extended token interface with optional fields for transfers
 */
export interface TransferableToken extends BaseToken {
  /** Unicity network address */
  unicityAddress?: string;

  /** Transaction ID if associated with a tx */
  transactionId?: string;

  /** Whether this is an offline transfer */
  isOfflineTransfer?: boolean;

  /** Pending offline transfer data */
  pendingOfflineData?: string;

  /** Timestamp when token was transferred */
  transferredAt?: number;

  /** Source token ID if this token was created from split */
  splitSourceTokenId?: string;

  /** Amount sent in split operation */
  splitSentAmount?: string;
}

// ==========================================
// Token Utility Functions
// ==========================================

/**
 * Check if token status indicates it's available for operations
 */
export function isTokenAvailable(status: TokenStatus): boolean {
  return status === TokenStatus.CONFIRMED;
}

/**
 * Check if token status indicates it's in a pending state
 */
export function isTokenPending(status: TokenStatus): boolean {
  return status === TokenStatus.PENDING || status === TokenStatus.SUBMITTED;
}

/**
 * Check if token status indicates it's no longer active
 */
export function isTokenInactive(status: TokenStatus): boolean {
  return (
    status === TokenStatus.TRANSFERRED ||
    status === TokenStatus.BURNED ||
    status === TokenStatus.FAILED
  );
}

/**
 * Get amount as BigInt from token
 * Returns null if amount is not set or invalid
 */
export function getTokenAmountAsBigInt(token: BaseToken): bigint | null {
  if (!token.amount) return null;
  try {
    return BigInt(token.amount);
  } catch {
    return null;
  }
}

// ==========================================
// Aggregated Asset Interface
// ==========================================

/**
 * Aggregated asset for portfolio views
 * Groups multiple tokens of the same coin type
 */
export interface AggregatedAssetData {
  /** Coin ID (64-char hex) */
  coinId: string;

  /** Token symbol */
  symbol: string;

  /** Token display name */
  name: string | null;

  /** Total amount as string (BigInt safe) */
  totalAmount: string;

  /** Decimal places for display */
  decimals: number;

  /** Number of tokens aggregated */
  tokenCount: number;

  /** Icon URL for display */
  iconUrl: string | null;

  /** Current price in USD */
  priceUsd: number;

  /** Current price in EUR */
  priceEur: number;

  /** 24h price change percentage */
  change24h: number;
}

// ==========================================
// User Identity (re-export from core)
// ==========================================

// Re-export UserIdentity for convenience
export type { UserIdentity } from '../core/identity';

// ==========================================
// Payment Request Types (re-exported from nostr module)
// ==========================================

// PaymentRequestStatus and ProcessedPaymentRequest are defined in sdk/nostr/types.ts
// Re-export here for convenience and backwards compatibility
export {
  PaymentRequestStatus,
  type ProcessedPaymentRequest,
} from '../nostr/types';

/**
 * @deprecated Use ProcessedPaymentRequest from sdk/nostr instead
 */
export type PaymentRequestData = import('../nostr/types').ProcessedPaymentRequest;

// ==========================================
// WalletToken Class Implementation
// ==========================================

/**
 * WalletToken - Platform-independent token data container
 * Implements TransferableToken interface
 *
 * This class stores token metadata for wallet operations:
 * - Display in UI (name, symbol, amount, icon)
 * - Persistence in storage (localStorage, IPFS)
 * - Transfer tracking (status, sender, timestamps)
 *
 * The actual cryptographic token data is stored in jsonData
 * as serialized TXF (Token Exchange Format).
 *
 * NOTE: This is different from Token in @unicitylabs/state-transition-sdk
 * which handles cryptographic operations (mint, transfer, split).
 *
 * Platform support:
 * - Browser (web app, extension)
 * - Node.js (CLI tools, server)
 * - React Native (mobile apps)
 */
export class WalletToken implements TransferableToken {
  id: string;
  name: string;
  type: string;
  timestamp: number;
  unicityAddress?: string;
  jsonData?: string;
  sizeBytes: number;
  status: TokenStatus;
  transactionId?: string;
  isOfflineTransfer: boolean;
  pendingOfflineData?: string;
  amount?: string;
  coinId?: string;
  symbol?: string;
  iconUrl?: string;
  transferredAt?: number;
  splitSourceTokenId?: string;
  splitSentAmount?: string;
  senderPubkey?: string;

  constructor(data: Partial<WalletToken> & { id?: string }) {
    // Use provided id or generate using crypto.randomUUID() if available, otherwise timestamp-based
    this.id = data.id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `token-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
    this.name = data.name || 'Unknown Token';
    this.type = data.type || 'Unknown';
    this.timestamp = data.timestamp || Date.now();
    this.unicityAddress = data.unicityAddress;
    this.jsonData = data.jsonData;
    this.sizeBytes = data.sizeBytes || 0;
    this.status = data.status || TokenStatus.CONFIRMED;
    this.transactionId = data.transactionId;
    this.isOfflineTransfer = data.isOfflineTransfer || false;
    this.pendingOfflineData = data.pendingOfflineData;
    this.amount = data.amount;
    this.coinId = data.coinId;
    this.symbol = data.symbol;
    this.iconUrl = data.iconUrl;
    this.transferredAt = data.transferredAt;
    this.splitSourceTokenId = data.splitSourceTokenId;
    this.splitSentAmount = data.splitSentAmount;
    this.senderPubkey = data.senderPubkey;
  }

  /**
   * Get formatted size string (B, KB, MB)
   */
  getFormattedSize(): string {
    if (this.sizeBytes < 1024) return `${this.sizeBytes}B`;
    if (this.sizeBytes < 1024 * 1024) return `${Math.floor(this.sizeBytes / 1024)}KB`;
    return `${Math.floor(this.sizeBytes / (1024 * 1024))}MB`;
  }

  /**
   * Get amount as BigInt
   * Returns null if amount is not set or invalid
   */
  getAmountAsBigInt(): bigint | null {
    try {
      return this.amount ? BigInt(this.amount) : null;
    } catch {
      return null;
    }
  }
}

// ==========================================
// AggregatedAsset Class Implementation
// ==========================================

/**
 * AggregatedAsset class - Platform-independent implementation
 * Implements AggregatedAssetData interface
 *
 * Groups multiple tokens of the same coin type for portfolio views.
 */
export class AggregatedAsset implements AggregatedAssetData {
  coinId: string;
  symbol: string;
  name: string | null;
  totalAmount: string;
  decimals: number;
  tokenCount: number;
  iconUrl: string | null;
  priceUsd: number;
  priceEur: number;
  change24h: number;

  constructor(data: {
    coinId: string;
    symbol: string;
    name?: string | null;
    totalAmount: string;
    decimals: number;
    tokenCount: number;
    iconUrl?: string | null;
    priceUsd?: number;
    priceEur?: number;
    change24h?: number;
  }) {
    this.coinId = data.coinId;
    this.symbol = data.symbol;
    this.name = data.name || null;
    this.totalAmount = data.totalAmount;
    this.decimals = data.decimals;
    this.tokenCount = data.tokenCount;
    this.iconUrl = data.iconUrl || null;
    this.priceUsd = data.priceUsd || 0.0;
    this.priceEur = data.priceEur || 0.0;
    this.change24h = data.change24h || 0.0;
  }

  /**
   * Get total amount as BigInt
   */
  getAmountAsBigInt(): bigint {
    try {
      return BigInt(this.totalAmount);
    } catch {
      return BigInt(0);
    }
  }

  /**
   * Get formatted amount with decimal places
   */
  getFormattedAmount(): string {
    const bigIntAmount = this.getAmountAsBigInt();
    if (bigIntAmount === BigInt(0)) return '0';

    const amountStr = bigIntAmount.toString();

    if (amountStr.length <= this.decimals) {
      const padded = amountStr.padStart(this.decimals + 1, '0');
      const integerPart = '0';
      const fractionalPart = padded.slice(-this.decimals);
      return this.stripTrailingZeros(`${integerPart}.${fractionalPart}`);
    }

    const integerPart = amountStr.slice(0, amountStr.length - this.decimals);
    const fractionalPart = amountStr.slice(amountStr.length - this.decimals);

    return this.stripTrailingZeros(`${integerPart}.${fractionalPart}`);
  }

  private stripTrailingZeros(str: string): string {
    if (!str.includes('.')) return str;
    return str.replace(/\.?0+$/, '');
  }

  /**
   * Get amount as decimal number
   */
  getAmountAsDecimal(): number {
    const bigIntAmount = this.getAmountAsBigInt();
    const divisor = Math.pow(10, this.decimals);
    return Number(bigIntAmount) / divisor;
  }

  /**
   * Get total fiat value in specified currency
   */
  getTotalFiatValue(currency: 'USD' | 'EUR'): number {
    const price = currency === 'EUR' ? this.priceEur : this.priceUsd;
    return this.getAmountAsDecimal() * price;
  }

  /**
   * Get formatted fiat value with currency symbol
   */
  getFormattedFiatValue(currency: 'USD' | 'EUR'): string {
    const symbol = currency === 'EUR' ? '€' : '$';
    const value = this.getTotalFiatValue(currency);

    return `${symbol}${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  /**
   * Get formatted 24h change with sign
   */
  getFormattedChange(): string {
    const sign = this.change24h >= 0 ? '+' : '';
    return `${sign}${this.change24h.toFixed(2)}%`;
  }
}

// ==========================================
// TokenCollection Class Implementation
// ==========================================

/**
 * TokenCollection - Container for tokens associated with an address
 *
 * This is a data container for displaying tokens in the UI.
 * NOT a cryptographic wallet (see UnityWallet for that).
 */
export class TokenCollection<T extends BaseToken = WalletToken> {
  id: string;
  name: string;
  address: string;
  tokens: T[];

  constructor(id: string, name: string, address: string, tokens: T[] = []) {
    this.id = id;
    this.name = name;
    this.address = address;
    this.tokens = tokens;
  }
}

// ==========================================
// TransactionEvent Class Implementation
// ==========================================

/**
 * TransactionEvent - Represents a token transaction event
 */
export class TransactionEvent<T extends BaseToken = WalletToken> {
  token: T;
  type: TransactionType;
  timestamp: number;

  constructor(token: T, type: TransactionType, timestamp: number) {
    this.token = token;
    this.type = type;
    this.timestamp = timestamp;
  }
}

