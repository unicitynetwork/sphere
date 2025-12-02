import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import * as bip39 from "bip39";
import CryptoJS from "crypto-js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import type { DirectAddress } from "@unicitylabs/state-transition-sdk/lib/address/DirectAddress";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference";

const STORAGE_KEY_ENC_SEED = "encrypted_seed";
const UNICITY_TOKEN_TYPE_HEX =
  "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

export interface UserIdentity {
  privateKey: string;
  nonce: string;
  publicKey: string;
  address: string;
  mnemonic?: string;
}

export class IdentityManager {
  private sessionKey: string;

  constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
  }

  async generateNewIdentity(): Promise<UserIdentity> {
    const mnemonic = bip39.generateMnemonic();
    return this.deriveIdentityFromMnemonic(mnemonic);
  }

  async deriveIdentityFromMnemonic(mnemonic: string): Promise<UserIdentity> {
    // Validate mnemonic phrase
    const isValid = bip39.validateMnemonic(mnemonic);
    if (!isValid) {
      throw new Error("Invalid recovery phrase. Please check your words and try again.");
    }

    const seed = await bip39.mnemonicToSeed(mnemonic);

    const seedBuffer = Buffer.from(seed);
    const secret = seedBuffer.subarray(0, 32);

    let nonce: Buffer;
    if (seedBuffer.length >= 64) {
      nonce = seedBuffer.subarray(32, 64);
    } else {
      nonce = Buffer.from(
        CryptoJS.SHA256(CryptoJS.lib.WordArray.create(seed)).toString(),
        "hex"
      );
    }

    const address = await this.deriveAddress(secret, nonce);

    const signingService = await SigningService.createFromSecret(secret);
    const publicKey = Buffer.from(signingService.publicKey).toString("hex");

    const identity: UserIdentity = {
      privateKey: secret.toString("hex"),
      nonce: nonce.toString("hex"),
      publicKey: publicKey,
      address: address,
      mnemonic: mnemonic,
    };

    this.saveSeed(mnemonic);
    return identity;
  }

  private async deriveAddress(secret: Buffer, nonce: Buffer): Promise<string> {
    try {
      const signingService = await SigningService.createFromSecret(secret);

      const tokenTypeBytes = Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex");
      const tokenType = new TokenType(tokenTypeBytes);

      const tokenId = new TokenId(Buffer.alloc(32));

      const predicate = await UnmaskedPredicate.create(
        tokenId,
        tokenType,
        signingService,
        HashAlgorithm.SHA256,
        nonce
      );

      return (await (await predicate.getReference()).toAddress()).toString();
    } catch (error) {
      console.error("Error deriving address", error);
      throw error;
    }
  }

  private saveSeed(mnemonic: string) {
    const encrypted = CryptoJS.AES.encrypt(
      mnemonic,
      this.sessionKey
    ).toString();
    localStorage.setItem(STORAGE_KEY_ENC_SEED, encrypted);
  }

  async getCurrentIdentity(): Promise<UserIdentity | null> {
    const encrypted = localStorage.getItem(STORAGE_KEY_ENC_SEED);
    if (!encrypted) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.sessionKey);
      const mnemonic = bytes.toString(CryptoJS.enc.Utf8);
      if (!mnemonic) return null;

      return this.deriveIdentityFromMnemonic(mnemonic);
    } catch (error) {
      console.error("Failed to decrypt identity", error);
      return null;
    }
  }

  async getWalletAddress(): Promise<DirectAddress | null> {
    const identity = await this.getCurrentIdentity();
    if (!identity) return null;

    try {
      const secret = Buffer.from(identity.privateKey, "hex");
      const signingService = await SigningService.createFromSecret(secret);
      const publicKey = signingService.publicKey;
      const tokenType = new TokenType(
        Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex")
      );

      const predicateRef = UnmaskedPredicateReference.create(
        tokenType,
        signingService.algorithm,
        publicKey,
        HashAlgorithm.SHA256
      );

      return (await predicateRef).toAddress();
    } catch (error) {
      console.error("Failed to derive wallet address", error);
      return null;
    }
  }
}
