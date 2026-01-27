/**
 * IPFS/Helia Configuration
 * Custom bootstrap peers with SSL/non-SSL support
 *
 * Browser clients connect via WebSocket (ws:// or wss://)
 * Your IPFS nodes need WebSocket enabled on port 4002
 *
 * Server setup required on each IPFS host:
 *   docker exec ipfs-kubo ipfs config --json Swarm.Transports.Network.Websocket true
 *   docker exec ipfs-kubo ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001","/ip4/0.0.0.0/tcp/4002/ws"]'
 *   docker restart ipfs-kubo
 */

interface IpfsPeer {
  host: string; // DNS hostname (e.g., unicity-ipfs1.dyndns.org)
  peerId: string; // Get from: docker exec ipfs-kubo ipfs id -f='<id>'
  wsPort: number; // WebSocket port (4002)
  wssPort?: number; // Secure WebSocket port (4003, via nginx)
}

/**
 * Your IPFS nodes
 * UPDATE peer IDs after running `docker exec ipfs-kubo ipfs id -f='<id>'` on each host
 */
export const CUSTOM_PEERS: IpfsPeer[] = [
  { host: "unicity-ipfs1.dyndns.org", peerId: "12D3KooWDKJqEMAhH4nsSSiKtK1VLcas5coUqSPZAfbWbZpxtL4u", wsPort: 4002, wssPort: 4003 },
  // TEMPORARILY DISABLED: ipfs2-5 for debugging IPNS propagation issues
  // { host: "unicity-ipfs2.dyndns.org", peerId: "12D3KooWLNi5NDPPHbrfJakAQqwBqymYTTwMQXQKEWuCrJNDdmfh", wsPort: 4002, wssPort: 4003 },
  // { host: "unicity-ipfs3.dyndns.org", peerId: "12D3KooWQ4aujVE4ShLjdusNZBdffq3TbzrwT2DuWZY9H1Gxhwn6", wsPort: 4002, wssPort: 4003 },
  // { host: "unicity-ipfs4.dyndns.org", peerId: "12D3KooWJ1ByPfUzUrpYvgxKU8NZrR8i6PU1tUgMEbQX9Hh2DEn1", wsPort: 4002, wssPort: 4003 },
  // { host: "unicity-ipfs5.dyndns.org", peerId: "12D3KooWB1MdZZGHN5B8TvWXntbycfe7Cjcz7n6eZ9eykZadvmDv", wsPort: 4002, wssPort: 4003 },
];

/**
 * Default public IPFS bootstrap peers (fallback)
 */
export const DEFAULT_BOOTSTRAP_PEERS = [
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
  "/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8",
  "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
];

/**
 * Check if a peer ID is configured (not a placeholder)
 */
function isPeerConfigured(peerId: string): boolean {
  return Boolean(
    peerId &&
    !peerId.startsWith("<") &&
    peerId.length > 10 &&
    (peerId.startsWith("12D3KooW") || peerId.startsWith("Qm"))
  );
}

/**
 * Generate multiaddrs based on current page protocol
 * - HTTPS page -> use wss:// (secure WebSocket)
 * - HTTP/file page -> use ws:// (plain WebSocket)
 */
export function getBootstrapPeers(): string[] {
  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  const customPeers = CUSTOM_PEERS.filter((p) =>
    isPeerConfigured(p.peerId)
  ).map((peer) => {
    if (isSecure && peer.wssPort) {
      // Secure WebSocket for HTTPS pages
      return `/dns4/${peer.host}/tcp/${peer.wssPort}/wss/p2p/${peer.peerId}`;
    } else {
      // Plain WebSocket for HTTP/file pages
      return `/dns4/${peer.host}/tcp/${peer.wsPort}/ws/p2p/${peer.peerId}`;
    }
  });

  // Custom peers first (prioritized), then 1 emergency fallback
  // We limit fallback to reduce traffic - full list was causing excessive connections
  const fallbackPeer = DEFAULT_BOOTSTRAP_PEERS[0]; // Just one fallback
  return [...customPeers, fallbackPeer];
}

/**
 * Get only custom configured peers (for diagnostics)
 */
export function getConfiguredCustomPeers(): IpfsPeer[] {
  return CUSTOM_PEERS.filter((p) => isPeerConfigured(p.peerId));
}

/**
 * IPFS configuration options
 */
export const IPFS_CONFIG = {
  connectionTimeout: 10000, // 10s timeout per peer
  maxConnections: 10,  // Reduced from 50 - we only connect to Unicity peers + 1 fallback
  enableAutoSync: true,
  syncIntervalMs: 5 * 60 * 1000, // 5 minutes
  /** Enable DHT operations (provide/put). Set false for HTTP-only mode to reduce CPU usage. */
  enableDht: import.meta.env.VITE_ENABLE_IPFS_DHT !== 'false',
};

/**
 * IPNS resolution configuration
 * Controls progressive multi-peer IPNS record collection
 *
 * Two resolution methods are used in parallel (racing):
 * 1. Gateway path (/ipns/{name}?format=dag-json) - Fast (~30ms), returns content directly
 * 2. Routing API (/api/v0/routing/get) - Slower (~5s), returns IPNS record with sequence number
 *
 * The gateway path is preferred for speed, while the routing API provides
 * authoritative sequence numbers for version tracking.
 */
export const IPNS_RESOLUTION_CONFIG = {
  /** Wait this long for initial responses before selecting best record */
  initialTimeoutMs: 3000, // Reduced from 10s - dead nodes fail fast (~100ms)
  /** Maximum wait for all gateway responses (late arrivals handled separately) */
  maxWaitMs: 15000, // Reduced from 30s - faster overall resolution
  /** Minimum polling interval for background IPNS re-fetch (active tab) */
  pollingIntervalMinMs: 60000,  // 60s (was 45s) - reduce CPU overhead
  /** Maximum polling interval (jitter applied between min and max, active tab) */
  pollingIntervalMaxMs: 90000,  // 90s (was 75s) - reduce CPU overhead
  /** Minimum polling interval when tab is inactive/hidden (4 minutes) */
  inactivePollingIntervalMinMs: 240000,
  /** Maximum polling interval when tab is inactive/hidden (4.5 minutes with jitter) */
  inactivePollingIntervalMaxMs: 270000,
  /** Per-gateway request timeout (for routing API) */
  perGatewayTimeoutMs: 2000, // Reduced from 5s - single node active, fail fast
  /** Gateway path resolution timeout (fast path) */
  gatewayPathTimeoutMs: 3000, // Reduced from 5s - faster path timeout
};

/**
 * TODO: IPNS Archiving Service Enhancement
 * Location: /home/vrogojin/ipfs-storage (kubo docker image)
 *
 * Implement an IPNS archiving service that:
 * 1. Archives N previous IPNS record versions (configurable, default 10)
 * 2. API endpoint: GET /api/v0/ipns/archive/{name}
 *    Returns: { records: [{ cid, sequence, timestamp, signature }] }
 * 3. Enables recovery of tokens lost due to race conditions where empty
 *    inventory overwrites populated one
 * 4. Store in MongoDB alongside current IPNS implementation
 *
 * Recovery scenario:
 * - Device A: tokens, publishes seq=11
 * - Device B: empty wallet, IPNS resolution times out
 * - Device B: publishes seq=1, overwrites Device A data
 * - Archive service: allows recovery of seq=11 record
 */

/**
 * Get the backend gateway URL for API calls
 * Uses HTTPS on secure pages, HTTP otherwise
 */
export function getBackendGatewayUrl(): string | null {
  const configured = CUSTOM_PEERS.find((p) => isPeerConfigured(p.peerId));
  if (!configured) return null;

  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  // Use HTTPS gateway (port 443) for secure pages
  return isSecure
    ? `https://${configured.host}`
    : `http://${configured.host}:9080`;
}

/**
 * Get all configured backend gateway URLs for multi-node upload
 * Returns URLs for all IPFS nodes that have valid peer IDs configured
 */
export function getAllBackendGatewayUrls(): string[] {
  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  return CUSTOM_PEERS.filter((p) => isPeerConfigured(p.peerId)).map((peer) =>
    isSecure ? `https://${peer.host}` : `http://${peer.host}:9080`
  );
}

/**
 * Get the primary backend peer ID for direct connection maintenance
 */
export function getBackendPeerId(): string | null {
  const configured = CUSTOM_PEERS.find((p) => isPeerConfigured(p.peerId));
  return configured?.peerId || null;
}
