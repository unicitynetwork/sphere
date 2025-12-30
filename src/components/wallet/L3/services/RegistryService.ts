import axios from 'axios';
import bundledRegistry from '../../../../assets/unicity-ids.testnet.json';
import { STORAGE_KEYS } from "../../../../config/storageKeys";


export interface IconEntry {
    url: string;
}

export interface TokenDefinition {
    network: string;
    assetKind: 'fungible' | 'non-fungible';
    name: string;
    symbol?: string;
    decimals?: number;
    description: string;
    icon?: string;          // Legacy
    icons?: IconEntry[];    // New format
    id: string;             // Hex CoinID
}


const REGISTRY_URL = "https://raw.githubusercontent.com/unicitynetwork/unicity-ids/refs/heads/main/unicity-ids.testnet.json";
const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 Hours

export class RegistryService {
    private static instance: RegistryService;

    private definitionsById: Map<string, TokenDefinition> = new Map();
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    private constructor() {
        this.loadFromBundled();
        this.initPromise = this.init();
    }

    static getInstance(): RegistryService {
        if (!RegistryService.instance) {
            RegistryService.instance = new RegistryService();
        }
        return RegistryService.instance;
    }

    private async init() {
        if (this.isInitialized) return;

        const cachedData = localStorage.getItem(STORAGE_KEYS.UNICITY_IDS_CACHE);
        const timestampStr = localStorage.getItem(STORAGE_KEYS.UNICITY_IDS_TIMESTAMP);
        const timestamp = timestampStr ? parseInt(timestampStr) : 0;
        const isStale = (Date.now() - timestamp) > CACHE_VALIDITY_MS;

        if (cachedData && !isStale) {
            console.log("Registry: Loading from local cache");
            try {
                const definitions = JSON.parse(cachedData) as TokenDefinition[];
                this.updateMap(definitions);
                this.isInitialized = true;
                return;
            } catch (e) {
                console.warn("Registry: Cache corrupted, falling back", e);
            }
        }

        if (!cachedData || isStale) {
            console.log("Registry: Cache stale or missing, fetching from GitHub...");
            await this.fetchAndCacheRegistry();
        }

        this.isInitialized = true;
    }

    /**
     * Ensure registry is initialized before use
     */
    async ensureInitialized(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    private loadFromBundled() {
        const definitions = bundledRegistry as unknown as TokenDefinition[];
        this.updateMap(definitions);
    }

    private updateMap(definitions: TokenDefinition[]) {
        this.definitionsById.clear();
        definitions.forEach(def => {
            this.definitionsById.set(def.id.toLowerCase(), def);
        });
    }

    private async fetchAndCacheRegistry() {
        try {
            const response = await axios.get<TokenDefinition[]>(REGISTRY_URL, { timeout: 10000 });
            
            if (Array.isArray(response.data)) {
                console.log(`Registry: Updated from GitHub (${response.data.length} items)`);
                
                // Update Memory
                this.updateMap(response.data);
                
                // Update Storage
                localStorage.setItem(STORAGE_KEYS.UNICITY_IDS_CACHE, JSON.stringify(response.data));
                localStorage.setItem(STORAGE_KEYS.UNICITY_IDS_TIMESTAMP, Date.now().toString());
            }
        } catch (e) {
            console.error("Registry: Failed to fetch from GitHub", e);
        }
    }

    getCoinDefinition(coinIdHex: string): TokenDefinition | undefined {
        if (!coinIdHex) return undefined;
        
        const id = coinIdHex.toLowerCase();
        const def = this.definitionsById.get(id);

        if (!def) {
            console.log(`Registry: Coin ${id} not found, trying force refresh...`);
            this.fetchAndCacheRegistry();
        }

        return def;
    }

    getIconUrl(def: TokenDefinition): string | null {
        if (def.icons && def.icons.length > 0) {
            const pngIcon = def.icons.find(i => i.url.toLowerCase().includes('.png'));
            if (pngIcon) return pngIcon.url;

            return def.icons[0].url;
        }

        return def.icon || null;
    }

    getAllDefinitions(): TokenDefinition[] {
        return Array.from(this.definitionsById.values());
    }
}