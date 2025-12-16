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
  { host: "unicity-ipfs1.dyndns.org", peerId: "<PEER_ID_1>", wsPort: 4002, wssPort: 4003 },
  { host: "unicity-ipfs2.dyndns.org", peerId: "<PEER_ID_2>", wsPort: 4002, wssPort: 4003 },
  { host: "unicity-ipfs3.dyndns.org", peerId: "<PEER_ID_3>", wsPort: 4002, wssPort: 4003 },
  { host: "unicity-ipfs4.dyndns.org", peerId: "<PEER_ID_4>", wsPort: 4002, wssPort: 4003 },
  { host: "unicity-ipfs5.dyndns.org", peerId: "<PEER_ID_5>", wsPort: 4002, wssPort: 4003 },
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

  // Custom peers first (prioritized), then defaults as fallback
  return [...customPeers, ...DEFAULT_BOOTSTRAP_PEERS];
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
  maxConnections: 50,
  enableAutoSync: true,
  syncIntervalMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * IPNS resolution configuration
 */
export const IPNS_RESOLUTION_CONFIG = {
  /** Wait this long for initial responses before selecting best record */
  initialTimeoutMs: 10000,
  /** Maximum wait for all gateway responses */
  maxWaitMs: 30000,
  /** Per-gateway request timeout */
  perGatewayTimeoutMs: 25000,
  /** Gateway path resolution timeout (fast path) */
  gatewayPathTimeoutMs: 5000,
};

/**
 * Get the backend gateway URL for API calls
 * Uses HTTPS on secure pages, HTTP otherwise
 */
export function getBackendGatewayUrl(): string | null {
  const configured = CUSTOM_PEERS.find((p) => isPeerConfigured(p.peerId));
  if (!configured) return null;

  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  return isSecure
    ? `https://${configured.host}`
    : `http://${configured.host}:9080`;
}

/**
 * Get all configured backend gateway URLs for multi-node operations
 */
export function getAllBackendGatewayUrls(): string[] {
  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  return CUSTOM_PEERS.filter((p) => isPeerConfigured(p.peerId)).map((peer) =>
    isSecure ? `https://${peer.host}` : `http://${peer.host}:9080`
  );
}
