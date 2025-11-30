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
// 3. AggregatedAsset Model
// ==========================================

export class AggregatedAsset {
    coinId: string;
    symbol: string;
    name: string | null;
    totalAmount: string; // String representation of BigInt
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

    getAmountAsBigInt(): bigint {
        try {
            return BigInt(this.totalAmount);
        } catch {
            return BigInt(0);
        }
    }

    getFormattedAmount(): string {
        const bigIntAmount = this.getAmountAsBigInt();
        if (bigIntAmount === BigInt(0)) return "0";

        const amountStr = bigIntAmount.toString();

        if (amountStr.length <= this.decimals) {
            const padded = amountStr.padStart(this.decimals + 1, '0');
            const integerPart = "0";
            const fractionalPart = padded.slice(-this.decimals);
            return this.stripTrailingZeros(`${integerPart}.${fractionalPart}`);
        }

        const integerPart = amountStr.slice(0, amountStr.length - this.decimals);
        const fractionalPart = amountStr.slice(amountStr.length - this.decimals);
        
        return this.stripTrailingZeros(`${integerPart}.${fractionalPart}`);
    }

    private stripTrailingZeros(str: string): string {
        if (!str.includes('.')) return str;
        const result = str.replace(/\.?0+$/, '');
        return result;
    }

    getAmountAsDecimal(): number {
        const bigIntAmount = this.getAmountAsBigInt();
        const divisor = Math.pow(10, this.decimals);
        return Number(bigIntAmount) / divisor;
    }

    getTotalFiatValue(currency: string): number {
        const price = currency === "EUR" ? this.priceEur : this.priceUsd;
        return this.getAmountAsDecimal() * price;
    }

    getFormattedFiatValue(currency: string): string {
        const symbol = currency === "EUR" ? "€" : "$";
        const value = this.getTotalFiatValue(currency);
        
        return `${symbol}${value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    getFormattedChange(): string {
        const sign = this.change24h >= 0 ? "+" : "";
        return `${sign}${this.change24h.toFixed(2)}%`;
    }
}

// ==========================================
// 4. CryptoCurrency Model (Legacy/Demo)
// ==========================================

export class CryptoCurrency {
    id: string;
    symbol: string;
    name: string;
    balance: number;
    priceUsd: number;
    priceEur: number;
    change24h: number;
    iconResId: number; // Keep for compatibility, though usually unused in web
    isDemo: boolean;
    iconUrl?: string | null;

    constructor(data: Partial<CryptoCurrency> & { id: string; symbol: string; name: string }) {
        this.id = data.id;
        this.symbol = data.symbol;
        this.name = data.name;
        this.balance = data.balance || 0;
        this.priceUsd = data.priceUsd || 0;
        this.priceEur = data.priceEur || 0;
        this.change24h = data.change24h || 0;
        this.iconResId = data.iconResId || 0;
        this.isDemo = data.isDemo ?? true;
        this.iconUrl = data.iconUrl;
    }

    getBalanceInFiat(currency: string): number {
        return currency === "EUR" 
            ? this.balance * this.priceEur 
            : this.balance * this.priceUsd;
    }

    getFormattedBalance(): string {
        if (this.balance % 1 === 0) {
            return Math.floor(this.balance).toString();
        }
        // Trim logic
        return this.balance.toFixed(8).replace(/\.?0+$/, '');
    }

    getFormattedPrice(currency: string): string {
        const price = currency === "EUR" ? this.priceEur : this.priceUsd;
        const symbol = currency === "EUR" ? "€" : "$";
        return `${symbol}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    getFormattedBalanceInFiat(currency: string): string {
        const value = this.getBalanceInFiat(currency);
        const symbol = currency === "EUR" ? "€" : "$";
        return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    getFormattedChange(): string {
        const sign = this.change24h >= 0 ? "+" : "";
        return `${sign}${this.change24h.toFixed(2)}%`;
    }
}

// ==========================================
// 5. Transaction Event
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

export interface UserIdentity {
    privateKey: string;
    nonce: string;
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