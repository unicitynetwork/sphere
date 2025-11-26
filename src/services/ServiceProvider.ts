import trustBaseJson from '../assets/trustbase-testnet.json'
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import { AggregatorClient } from '@unicitylabs/state-transition-sdk/lib/api/AggregatorClient';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';

const UNICITY_AGGREGATOR_URL = "https://goggregator-test.unicity.network";
const API_KEY = "sk_06365a9c44654841a366068bcfc68986";

export class ServiceProvider {
  private static _aggregatorClient: AggregatorClient;
  private static _stateTransitionClient: StateTransitionClient;
  private static _rootTrustBase: RootTrustBase;

  static get aggregatorClient(): AggregatorClient {
    if(!this._aggregatorClient){
      this._aggregatorClient = new AggregatorClient(UNICITY_AGGREGATOR_URL, API_KEY);
    }
    return this._aggregatorClient;
  }

  static get stateTransitionClient(): StateTransitionClient {
    if(!this._stateTransitionClient){
      this._stateTransitionClient = new StateTransitionClient(this.aggregatorClient);
    }
    return this.stateTransitionClient;
  }

  static getRootTrustBase(): RootTrustBase {
    if(!this._rootTrustBase){
      this._rootTrustBase = RootTrustBase.fromJSON(JSON.stringify(trustBaseJson));
    }
    return this._rootTrustBase
  }
}


