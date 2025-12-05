import { Token, Wallet } from "../components/wallet/L3/data/model";
import { v4 as uuidv4 } from "uuid";

const STORAGE_KEY_WALLET = "unicity_wallet_data";
const STORAGE_KEY_HISTORY = "unicity_transaction_history";

export interface TransactionHistoryEntry {
  id: string;
  type: 'SENT' | 'RECEIVED';
  amount: string;
  coinId: string;
  symbol: string;
  iconUrl?: string;
  timestamp: number;
  recipientNametag?: string;
  senderPubkey?: string;
}

export class WalletRepository {
  private static instance: WalletRepository;

  private _wallet: Wallet | null = null;
  private _transactionHistory: TransactionHistoryEntry[] = [];

  private constructor() {
    this.loadWallet();
    this.loadTransactionHistory();
  }

  static getInstance(): WalletRepository {
    if (!WalletRepository.instance) {
      WalletRepository.instance = new WalletRepository();
    }
    return WalletRepository.instance;
  }

  private loadWallet() {
    try {
      const json = localStorage.getItem(STORAGE_KEY_WALLET);
      if (json) {
        const parsed = JSON.parse(json);
        const tokens = parsed.tokens.map((t: Partial<Token>) => new Token(t));
        this._wallet = new Wallet(
          parsed.id,
          parsed.name,
          parsed.address,
          tokens
        );

        this.refreshWallet(); // Trigger wallet-updated for UI
        // Note: No wallet-loaded event here - ServicesProvider handles existing wallet via initializeNostr() on mount
      }
    } catch (error) {
      console.error("Failed to load wallet", error);
      this._wallet = null;
    }
  }

  private loadTransactionHistory() {
    try {
      const json = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (json) {
        this._transactionHistory = JSON.parse(json);
      }
    } catch (error) {
      console.error("Failed to load transaction history", error);
      this._transactionHistory = [];
    }
  }

  private saveTransactionHistory() {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(this._transactionHistory));
    } catch (error) {
      console.error("Failed to save transaction history", error);
    }
  }

  addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): void {
    const historyEntry: TransactionHistoryEntry = {
      id: uuidv4(),
      ...entry,
    };
    this._transactionHistory.push(historyEntry);
    this.saveTransactionHistory();
    this.refreshWallet(); // Trigger UI update
  }

  createWallet(address: string, name: string = "My Wallet"): Wallet {
    const newWallet = new Wallet(uuidv4(), name, address, []);
    this.saveWallet(newWallet);
    this.refreshWallet(); // Trigger wallet-updated for UI updates
    window.dispatchEvent(new Event("wallet-loaded")); // Signal wallet creation for Nostr initialization
    return newWallet;
  }

  private saveWallet(wallet: Wallet) {
    this._wallet = wallet;
    localStorage.setItem(STORAGE_KEY_WALLET, JSON.stringify(wallet));
  }

  getWallet(): Wallet | null {
    return this._wallet;
  }

  getTokens(): Token[] {
    return this._wallet?.tokens || [];
  }

  private isSameToken(t1: Token, t2: Token): boolean {
    if (t1.id === t2.id) return true;

    try {
      const p1 = JSON.parse(t1.jsonData || "{}");
      const p2 = JSON.parse(t2.jsonData || "{}");

      const id1 = p1.genesis?.data?.tokenId;
      const id2 = p2.genesis?.data?.tokenId;

      if (id1 && id2 && id1 === id2) return true;
    } catch {
      return false;
    }

    return false;
  }

  addToken(token: Token, skipHistory: boolean = false): void {
    console.log("💾 Repository: Adding token...", token.id);
    if (!this._wallet) {
      console.error("💾 Repository: Wallet not initialized!");
      return;
    }

    const currentTokens = this._wallet.tokens;

    const isDuplicate = currentTokens.some((existing) =>
      this.isSameToken(existing, token)
    );

    if (isDuplicate) {
      console.warn(
        `⛔ Duplicate token detected (CoinID: ${token.coinId}). Skipping add.`
      );
      return;
    }

    if (currentTokens.some((t) => t.id === token.id)) {
      console.warn(`Token ${token.id} already exists`);
      return;
    }

    const updatedTokens = [token, ...currentTokens];

    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);

    // Add to transaction history (RECEIVED) - skip for change tokens from split
    if (!skipHistory && token.coinId && token.amount) {
      this.addTransactionToHistory({
        type: 'RECEIVED',
        amount: token.amount,
        coinId: token.coinId,
        symbol: token.symbol || 'UNK',
        iconUrl: token.iconUrl,
        timestamp: token.timestamp,
        senderPubkey: token.senderPubkey,
      });
    }

    console.log(`💾 Repository: Saved! Total tokens: ${updatedTokens.length}`);
    this.refreshWallet();
  }

  removeToken(tokenId: string, recipientNametag?: string, skipHistory: boolean = false): void {
    if (!this._wallet) return;

    // Find the token before removing to add to history
    const tokenToRemove = this._wallet.tokens.find((t) => t.id === tokenId);

    const updatedTokens = this._wallet.tokens.filter((t) => t.id !== tokenId);
    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);

    // Add to transaction history (SENT) - skip for split operations
    if (!skipHistory && tokenToRemove && tokenToRemove.coinId && tokenToRemove.amount) {
      this.addTransactionToHistory({
        type: 'SENT',
        amount: tokenToRemove.amount,
        coinId: tokenToRemove.coinId,
        symbol: tokenToRemove.symbol || 'UNK',
        iconUrl: tokenToRemove.iconUrl,
        timestamp: Date.now(),
        recipientNametag: recipientNametag,
      });
    }

    this.refreshWallet();
  }

  clearWallet(): void {
    localStorage.removeItem(STORAGE_KEY_WALLET);
    this._wallet = null;
    this.refreshWallet();
  }

  refreshWallet(): void {
    window.dispatchEvent(new Event("wallet-updated"));
  }

  getTransactionHistory(): TransactionHistoryEntry[] {
    return [...this._transactionHistory].sort((a, b) => b.timestamp - a.timestamp);
  }

  addSentTransaction(amount: string, coinId: string, symbol: string, iconUrl: string | undefined, recipientNametag: string): void {
    this.addTransactionToHistory({
      type: 'SENT',
      amount: amount,
      coinId: coinId,
      symbol: symbol,
      iconUrl: iconUrl,
      timestamp: Date.now(),
      recipientNametag: recipientNametag,
    });
  }
}
