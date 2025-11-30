import trustBaseJson from "../../../../assets/trustbase-testnet.json";
import { StateTransitionClient } from "@unicitylabs/state-transition-sdk/lib/StateTransitionClient";
import { AggregatorClient } from "@unicitylabs/state-transition-sdk/lib/api/AggregatorClient";
import { RootTrustBase } from "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase";

const UNICITY_AGGREGATOR_URL = import.meta.env.VITE_AGGREGATOR_URL || "https://goggregator-test.unicity.network";
const API_KEY = "sk_06365a9c44654841a366068bcfc68986";
const TEST_SIG_KEY =
  "025f37d20e5b18909361e0ead7ed17c69b417bee70746c9e9c2bcb1394d921d4ae";

export class ServiceProvider {
  private static _aggregatorClient: AggregatorClient | null = null;
  private static _stateTransitionClient: StateTransitionClient | null = null;
  private static _rootTrustBase: RootTrustBase | null = null;

  static get aggregatorClient(): AggregatorClient {
    if (!this._aggregatorClient) {
      console.log("Initializing AggregatorClient...");
      this._aggregatorClient = new AggregatorClient(
        UNICITY_AGGREGATOR_URL,
        API_KEY
      );
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
