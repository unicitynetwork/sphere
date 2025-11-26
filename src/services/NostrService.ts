import {NostrClient, NostrKeyManager, EventKinds, Filter} from '@unicitylabs/nostr-sdk'
import { IdentityManager } from './IdentityManager'
import { Buffer } from 'buffer'

const UNICITY_RELAYS = [
    "ws://unicity-nostr-relay-20250927-alb-1919039002.me-central-1.elb.amazonaws.com:8080"
];

export class NostrService {
  private static instance: NostrService;
  private client: NostrClient | null = null;
  private identityManager: IdentityManager;
  private isConnected: boolean = false;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  static getInstance(identityManager: IdentityManager): NostrService{
    if(!NostrService.instance){
      NostrService.instance = new NostrService(identityManager);
    }
    return NostrService.instance;
  }

  async start() {
    if (this.isConnected) return;

    const identity = await this.identityManager.getCurrentIdentity();
    if(!identity) throw new Error("No identity found for Nostr");

    const secretKey = Buffer.from(identity.privateKey, 'hex');
    const keyManager = NostrKeyManager.fromPrivateKey(secretKey);

    this.client = new NostrClient(keyManager);

    console.log("Connecting to Nostr relays...");
    try {
      await this.client.connect(UNICITY_RELAYS[0]);
      this.isConnected = true;
      console.log("✅ Connected to Nostr relays");

      this.subscribeToPrivateEvents(keyManager.getPublicKeyHex());
    } catch(error) {
      console.error("❌ Failed to connect to Nostr", error)
    }
  }

  private subscribeToPrivateEvents(publicKey: string) {
    if (!this.client) return; 

    const filter = new Filter();
    filter.kinds = [EventKinds.ENCRYPTED_DM, EventKinds.TOKEN_TRANSFER];
    filter['#p'] = [publicKey.toString()];

    this.client.subscribe(filter, {
      onEvent: (event) => {
        console.log(`Received event kind=${event.kind}`);
      },
      onEndOfStoredEvents: () => console.log("End of stored events")
    });
  }

  async queryPubkeyByNametag(nametag: string): Promise<string | null> {
    if (!this.client) await this.start();

    try {
      const cleanTag = nametag.replace('@unicity', '').replace('@', '');
      console.log(`Querying pubkey for: ${cleanTag}`);

      const pubkey = await this.client?.queryPubkeyByNametag(cleanTag);
      return pubkey || null;
    } catch(error) {
      console.error("Failed to query nametag", error);
      return null;
    }
  }

  async sendTokenTransfer(recipientPubkey: string, payloadJson: string): Promise<boolean> {
    if (!this.client) await this.start();

    try {
      console.log(`Sending token transfer to ${recipientPubkey}...`)
      await this.client?.sendTokenTransfer(recipientPubkey, payloadJson);
      return true;
    } catch(error) {
      console.error("Failed to send token transfer", error);
      return false;
    }
  }

  async publishNametagBinding(nametag: string, unicityAddress: string): Promise<boolean> {
    if(!this.client) await this.start();

    try {
      await this.client?.publishNametagBinding(nametag, unicityAddress);
      return true;
    } catch(error) {
      console.error("Failed to publish nametag", error)
      return false;
    }
  }
}