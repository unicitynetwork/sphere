import trustBaseJson from "../../../../assets/trustbase-testnet.json";
import { StateTransitionClient } from "@unicitylabs/state-transition-sdk/lib/StateTransitionClient";
import { AggregatorClient } from "@unicitylabs/state-transition-sdk/lib/api/AggregatorClient";
import { RootTrustBase } from "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

const UNICITY_AGGREGATOR_URL = import.meta.env.VITE_AGGREGATOR_URL || "https://goggregator-test.unicity.network";
const API_KEY = "sk_06365a9c44654841a366068bcfc68986";
const TEST_SIG_KEY =
  "025f37d20e5b18909361e0ead7ed17c69b417bee70746c9e9c2bcb1394d921d4ae";

export class ServiceProvider {
  private static _aggregatorClient: AggregatorClient | null = null;
  private static _stateTransitionClient: StateTransitionClient | null = null;
  private static _rootTrustBase: RootTrustBase | null = null;
  private static _runtimeAggregatorUrl: string | null = null;
  private static _skipTrustBaseVerification: boolean = false;
  private static _initialized: boolean = false;

  /**
   * Initialize dev settings from localStorage (called on first access)
   */
  private static _initFromStorage(): void {
    if (this._initialized) return;
    this._initialized = true;

    try {
      // Load custom aggregator URL
      const storedUrl = localStorage.getItem(STORAGE_KEYS.DEV_AGGREGATOR_URL);
      if (storedUrl) {
        this._runtimeAggregatorUrl = storedUrl;
        console.log(`📦 Loaded dev aggregator URL from storage: ${storedUrl}`);
      }

      // Load trust base verification skip flag
      const storedSkip = localStorage.getItem(STORAGE_KEYS.DEV_SKIP_TRUST_BASE);
      if (storedSkip === "true") {
        this._skipTrustBaseVerification = true;
        console.warn("⚠️ Trust base verification is DISABLED (loaded from storage)");
      }
    } catch (error) {
      console.warn("Failed to load dev settings from localStorage:", error);
    }
  }

  /**
   * Get the current aggregator URL (runtime override or default from env)
   */
  static getAggregatorUrl(): string {
    this._initFromStorage();
    return this._runtimeAggregatorUrl || UNICITY_AGGREGATOR_URL;
  }

  /**
   * Set a runtime aggregator URL override (dev tools only)
   * Pass null to reset to default from environment variable
   */
  static setAggregatorUrl(url: string | null): void {
    this._initFromStorage();
    this._runtimeAggregatorUrl = url;

    // Persist to localStorage
    try {
      if (url) {
        localStorage.setItem(STORAGE_KEYS.DEV_AGGREGATOR_URL, url);
      } else {
        localStorage.removeItem(STORAGE_KEYS.DEV_AGGREGATOR_URL);
      }
    } catch (error) {
      console.warn("Failed to save dev aggregator URL to localStorage:", error);
    }

    this.reset();
  }

  /**
   * Reset all singleton instances (used when aggregator URL changes)
   * Note: RootTrustBase is kept as it's aggregator-independent
   */
  static reset(): void {
    this._aggregatorClient = null;
    this._stateTransitionClient = null;
  }

  /**
   * Check if trust base verification is being skipped (dev mode only)
   */
  static isTrustBaseVerificationSkipped(): boolean {
    this._initFromStorage();
    return this._skipTrustBaseVerification;
  }

  /**
   * Enable or disable trust base verification bypass (dev tools only)
   * When enabled, SDK verification calls will be skipped to allow
   * connecting to aggregators with different trust bases.
   */
  static setSkipTrustBaseVerification(skip: boolean): void {
    this._initFromStorage();
    this._skipTrustBaseVerification = skip;

    // Persist to localStorage
    try {
      if (skip) {
        localStorage.setItem(STORAGE_KEYS.DEV_SKIP_TRUST_BASE, "true");
      } else {
        localStorage.removeItem(STORAGE_KEYS.DEV_SKIP_TRUST_BASE);
      }
    } catch (error) {
      console.warn("Failed to save trust base skip flag to localStorage:", error);
    }

    if (skip) {
      console.warn("⚠️ Trust base verification is now DISABLED - dev mode only!");
    } else {
      console.log("✅ Trust base verification is now ENABLED");
    }
  }

  /**
   * Check if dev mode is active (any non-default settings)
   */
  static isDevModeActive(): boolean {
    this._initFromStorage();
    return this._runtimeAggregatorUrl !== null || this._skipTrustBaseVerification;
  }

  /**
   * Get current dev configuration for banner display
   */
  static getDevConfig(): { aggregatorUrl: string | null; skipTrustBase: boolean } {
    this._initFromStorage();
    return {
      aggregatorUrl: this._runtimeAggregatorUrl,
      skipTrustBase: this._skipTrustBaseVerification,
    };
  }

  static get aggregatorClient(): AggregatorClient {
    if (!this._aggregatorClient) {
      const url = this.getAggregatorUrl();
      console.log(`Initializing AggregatorClient with URL: ${url}`);
      this._aggregatorClient = new AggregatorClient(url, API_KEY);
    }
    return this._aggregatorClient;
  }

  static get stateTransitionClient(): StateTransitionClient {
    if (!this._stateTransitionClient) {
      this._stateTransitionClient = new StateTransitionClient(
        ServiceProvider.aggregatorClient
      );
    }
    return this._stateTransitionClient;
  }

  static getRootTrustBase(): RootTrustBase {
    if (this._rootTrustBase) {
      return this._rootTrustBase;
    }

    try {
      if (trustBaseJson) {
        this._rootTrustBase = RootTrustBase.fromJSON(trustBaseJson);
        console.log("✅ TrustBase loaded from local assets");
        return this._rootTrustBase;
      }
    } catch (error) {
      console.warn(
        "⚠️ Failed to load TrustBase from file, attempting fallback...",
        error
      );
    }

    try {
      console.log("Generating Fallback TrustBase...");

      const fallbackJson = {
        version: "1",
        networkId: 0,
        epoch: "1",
        epochStartRound: "1",
        rootNodes: [
          {
            nodeId: "TEST_NODE",
            sigKey: "0x" + TEST_SIG_KEY,
            stake: "1",
          },
        ],
        quorumThreshold: "1",
        stateHash: "",
        changeRecordHash: null,
        previousEntryHash: null,
        signatures: {},
      };

      this._rootTrustBase = RootTrustBase.fromJSON(fallbackJson);

      console.log("✅ TrustBase created using Fallback mechanism");
      return this._rootTrustBase;
    } catch (e) {
      console.error("CRITICAL: Failed to initialize TrustBase", e);
      throw new Error("Critical: Could not initialize TrustBase");
    }
  }
}
