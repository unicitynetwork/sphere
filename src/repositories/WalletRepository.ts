import { Token, Wallet } from "../components/wallet/L3/data/model";
import { v4 as uuidv4 } from "uuid";

const STORAGE_KEY_WALLET = "unicity_wallet_data";

export class WalletRepository {
  private static instance: WalletRepository;

  private _wallet: Wallet | null = null;

  private constructor() {
    this.loadWallet();
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
      }
    } catch (error) {
      console.error("Failed to load wallet", error);
      this._wallet = null;
    }
  }

  createWallet(address: string, name: string = "My Wallet"): Wallet {
    const newWallet = new Wallet(uuidv4(), name, address, []);
    this.saveWallet(newWallet);
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

  addToken(token: Token): void {
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
    console.log(`💾 Repository: Saved! Total tokens: ${updatedTokens.length}`);
  }

  removeToken(tokenId: string): void {
    if (!this._wallet) return;

    const updatedTokens = this._wallet.tokens.filter((t) => t.id !== tokenId);
    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);
  }

  clearWallet(): void {
    localStorage.removeItem(STORAGE_KEY_WALLET);
    this._wallet = null;
  }
}
