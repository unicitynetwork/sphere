import { v4 as uuidv4 } from 'uuid';

// ==========================================
// 1. Enums & Constants
// ==========================================

export const TokenStatus = {
    PENDING: 'PENDING',
    SUBMITTED: 'SUBMITTED',
    TRANSFERRED: 'TRANSFERRED',
    CONFIRMED: 'CONFIRMED',
    BURNED: 'BURNED',
    FAILED: 'FAILED'
} as const;

export type TokenStatus = typeof TokenStatus[keyof typeof TokenStatus];

export const TransactionType = {
    RECEIVED: 'RECEIVED',
    SENT: 'SENT'
} as const;

export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

// ==========================================
// 2. Token Model
// ==========================================

export class Token {
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
    amount?: string;           // String to hold BigInteger safe
    coinId?: string;
    symbol?: string;
    iconUrl?: string;
    transferredAt?: number;
    splitSourceTokenId?: string;
    splitSentAmount?: string;
    senderPubkey?: string;     // Pubkey of sender (for received tokens)

    constructor(data: Partial<Token>) {
        this.id = data.id || uuidv4();
        this.name = data.name || "Unknown Token";
        this.type = data.type || "Unknown";
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

    getFormattedSize(): string {
        if (this.sizeBytes < 1024) return `${this.sizeBytes}B`;
        if (this.sizeBytes < 1024 * 1024) return `${Math.floor(this.sizeBytes / 1024)}KB`;
        return `${Math.floor(this.sizeBytes / (1024 * 1024))}MB`;
    }

    getAmountAsBigInteger(): bigint | null {
        try {
            return this.amount ? BigInt(this.amount) : null;
        } catch {
            return null;
        }
    }
}

// ==========================================
// 3. Transaction Event
// ==========================================

export class TransactionEvent {
    token: Token;
    type: TransactionType;
    timestamp: number;

    constructor(token: Token, type: TransactionType, timestamp: number) {
        this.token = token;
        this.type = type;
        this.timestamp = timestamp;
    }
}

// ==========================================
// 6. User Identity & Wallet
// ==========================================

/**
 * User identity for L3 Unicity wallet.
 *
 * NOTE: The wallet address is derived using UnmaskedPredicateReference (no nonce/salt).
 * This creates a stable, reusable DirectAddress from publicKey + tokenType.
 */
export interface UserIdentity {
    privateKey: string;
    publicKey: string;
    address: string;
    nametag?: string; // Optional field for local storage convenience
}

export class Wallet {
    id: string;
    name: string;
    address: string;
    tokens: Token[];

    constructor(id: string, name: string, address: string, tokens: Token[] = []) {
        this.id = id;
        this.name = name;
        this.address = address;
        this.tokens = tokens;
    }
}

export const PaymentRequestStatus = {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    PAID: 'PAID'
} as const

export type PaymentRequestStatus = typeof PaymentRequestStatus[keyof typeof PaymentRequestStatus];

export interface IncomingPaymentRequest {
    id: string;
    senderPubkey: string;
    amount: bigint;
    coinId: string;
    symbol: string;
    message?: string;
    recipientNametag: string;
    requestId: string;
    timestamp: number;
    status: PaymentRequestStatus;
}