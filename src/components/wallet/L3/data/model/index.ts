// ==========================================
// L3 Data Model
// Re-exports SDK types and classes for backwards compatibility
// ==========================================

// ==========================================
// 1. Enums, Constants & Utility Functions (from SDK)
// ==========================================

export {
    TokenStatus,
    TransactionType,
    isTokenAvailable,
    isTokenPending,
    isTokenInactive,
    getTokenAmountAsBigInt,
} from '../../../sdk';

// ==========================================
// 2. Token Classes (from SDK)
// ==========================================

export {
    WalletToken,
    AggregatedAsset,
    TokenCollection,
    TransactionEvent,
} from '../../../sdk';

// Backwards-compatibility alias for dev branch code
export { WalletToken as Token } from '../../../sdk';

// ==========================================
// 3. Type Interfaces (from SDK)
// ==========================================

export type {
    BaseToken,
    TransferableToken,
    AggregatedAssetData,
    PaymentRequestData,
} from '../../../sdk';

// ==========================================
// 4. User Identity
// ==========================================

// Re-export from SDK - use NostrUserIdentity which includes nametag
export type { UserIdentity } from '../../../sdk';
export type { NostrUserIdentity } from '../../../sdk/nostr';

// For backwards compatibility, alias NostrUserIdentity as the default UserIdentity with nametag
// App code that needs nametag should use NostrUserIdentity explicitly
import type { NostrUserIdentity } from '../../../sdk/nostr';

/**
 * @deprecated Use NostrUserIdentity from sdk/nostr for identity with nametag,
 * or UserIdentity from sdk/core for base identity without nametag.
 */
export type UserIdentityWithNametag = NostrUserIdentity;

// ==========================================
// 5. Legacy/Demo Models (App-specific)
// ==========================================

/**
 * CryptoCurrency - Legacy/Demo model for cryptocurrency display
 * @deprecated Use AggregatedAsset for real token data
 */
export class CryptoCurrency {
    id: string;
    symbol: string;
    name: string;
    balance: number;
    priceUsd: number;
    priceEur: number;
    change24h: number;
    iconResId: number;
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
// 6. Payment Request (from SDK nostr module)
// ==========================================

// Re-export from SDK nostr module
export type { ProcessedPaymentRequest } from '../../../sdk/nostr';
export { PaymentRequestStatus } from '../../../sdk/nostr';

/**
 * @deprecated Use ProcessedPaymentRequest from sdk/nostr instead
 */
export type IncomingPaymentRequest =
    import('../../../sdk/nostr').ProcessedPaymentRequest;

// ==========================================
// 7. Backwards Compatibility Aliases
// ==========================================

import { TokenCollection } from '../../../sdk';

/**
 * @deprecated Use TokenCollection instead. "Wallet" is misleading as this is just a token container.
 * Kept for backwards compatibility during migration.
 */
export const Wallet = TokenCollection;
