/**
 * Developer Tools for AgentSphere
 *
 * This module provides utilities callable from the browser console for debugging
 * and development purposes. Only loaded in development mode.
 */

import { WalletRepository } from "../repositories/WalletRepository";
import { Token, TokenStatus } from "../components/wallet/L3/data/model";
import { ServiceProvider } from "../components/wallet/L3/services/ServiceProvider";
import type { TxfToken, TxfInclusionProof, TxfTransaction } from "../components/wallet/L3/services/types/TxfTypes";

// Type declarations for window extension
declare global {
  interface Window {
    devHelp: () => void;
    devRefreshProofs: () => Promise<RefreshProofsResult>;
    devSetAggregatorUrl: (url: string | null) => void;
    devGetAggregatorUrl: () => string;
    devSkipTrustBaseVerification: () => void;
    devEnableTrustBaseVerification: () => void;
    devIsTrustBaseVerificationSkipped: () => boolean;
  }
}

/**
 * Result of the proof refresh operation
 */
export interface RefreshProofsResult {
  totalTokens: number;
  succeeded: number;
  failed: number;
  errors: Array<{ tokenId: string; error: string }>;
  duration: number;
}

/**
 * Internal type for tracking proof fetch requests
 */
interface ProofRequest {
  type: "genesis" | "transaction";
  index?: number;
  stateHash: string;
}

/**
 * Fetch a proof from the aggregator with retry logic
 */
async function fetchProofWithRetry(
  stateHash: string,
  maxRetries: number = 2
): Promise<TxfInclusionProof | null> {
  let lastError: Error | null = null;
  const aggregatorUrl = ServiceProvider.getAggregatorUrl();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${aggregatorUrl}/proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "getInclusionProof",
          params: { stateHash },
          id: Date.now(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error.message || "RPC error");
      }
      if (!result.result) {
        return null;
      }

      return result.result as TxfInclusionProof;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms...
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }
  }

  console.warn(`Failed to fetch proof for ${stateHash.slice(0, 16)}... after ${maxRetries + 1} attempts:`, lastError);
  return null;
}

/**
 * Extract state hashes and strip proofs from a TxfToken
 * Returns the modified token and the list of proof requests to make
 */
function stripProofsAndCollectHashes(txf: TxfToken): { stripped: TxfToken; requests: ProofRequest[] } {
  const requests: ProofRequest[] = [];
  const stripped = JSON.parse(JSON.stringify(txf)) as TxfToken;

  // Handle genesis proof
  if (stripped.genesis.inclusionProof) {
    const genesisStateHash = stripped.genesis.inclusionProof.authenticator.stateHash;
    requests.push({ type: "genesis", stateHash: genesisStateHash });
    // We need to cast to unknown first since TxfGenesis expects inclusionProof to be non-null
    // But we'll restore it before returning
    (stripped.genesis as { inclusionProof: TxfInclusionProof | null }).inclusionProof = null;
  }

  // Handle transaction proofs
  if (stripped.transactions && stripped.transactions.length > 0) {
    for (let i = 0; i < stripped.transactions.length; i++) {
      const tx = stripped.transactions[i];
      if (tx.inclusionProof) {
        requests.push({ type: "transaction", index: i, stateHash: tx.newStateHash });
        stripped.transactions[i] = {
          ...tx,
          inclusionProof: null,
        };
      }
    }
  }

  return { stripped, requests };
}

/**
 * Re-fetch all unicity proofs for all tokens in the wallet
 *
 * This function:
 * 1. Scans all loaded L3 tokens
 * 2. Removes existing unicity proofs (preserving transaction commitments)
 * 3. Re-requests fresh proofs from the Unicity aggregator
 * 4. Updates the tokens in storage
 *
 * Usage from browser console: await window.devRefreshProofs()
 */
export async function devRefreshProofs(): Promise<RefreshProofsResult> {
  const startTime = Date.now();
  const errors: Array<{ tokenId: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  console.group("🔄 Dev: Refreshing Unicity Proofs");

  const repo = WalletRepository.getInstance();
  const tokens = repo.getTokens();

  console.log(`📦 Found ${tokens.length} tokens to process`);

  if (tokens.length === 0) {
    console.log("No tokens found in wallet");
    console.groupEnd();
    return {
      totalTokens: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      duration: Date.now() - startTime,
    };
  }

  // Process tokens sequentially for clear progress tracking
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    const tokenIdShort = token.id.slice(0, 12);

    console.group(`📦 Token ${tokenIndex + 1}/${tokens.length}: ${tokenIdShort}...`);

    if (!token.jsonData) {
      console.warn("⚠️ Token has no jsonData, skipping");
      errors.push({ tokenId: token.id, error: "No jsonData" });
      failed++;
      console.groupEnd();
      continue;
    }

    let txf: TxfToken;
    try {
      txf = JSON.parse(token.jsonData) as TxfToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("❌ Failed to parse jsonData:", msg);
      errors.push({ tokenId: token.id, error: `Parse error: ${msg}` });
      failed++;
      console.groupEnd();
      continue;
    }

    // Strip proofs and collect state hashes
    const { stripped, requests } = stripProofsAndCollectHashes(txf);

    if (requests.length === 0) {
      console.log("ℹ️ No proofs to refresh (token has no proofs)");
      succeeded++;
      console.groupEnd();
      continue;
    }

    console.log(`🔍 Fetching ${requests.length} proof(s)...`);

    // Fetch all proofs in parallel
    const proofResults = await Promise.allSettled(
      requests.map(async (req) => {
        const proof = await fetchProofWithRetry(req.stateHash);
        return { ...req, proof };
      })
    );

    // Re-attach proofs to the stripped token
    let allProofsSucceeded = true;
    const proofErrors: string[] = [];

    for (const result of proofResults) {
      if (result.status === "rejected") {
        allProofsSucceeded = false;
        proofErrors.push(`Fetch failed: ${result.reason}`);
        continue;
      }

      const { type, index, stateHash, proof } = result.value;

      if (!proof) {
        allProofsSucceeded = false;
        proofErrors.push(`${type}${index !== undefined ? ` #${index}` : ""}: proof not found for state ${stateHash.slice(0, 16)}...`);
        console.warn(`❌ ${type}${index !== undefined ? ` #${index}` : ""}: proof not found`);
        continue;
      }

      // Re-attach the proof
      if (type === "genesis") {
        (stripped.genesis as { inclusionProof: TxfInclusionProof | null }).inclusionProof = proof;
        console.log(`✅ Genesis proof fetched`);
      } else if (type === "transaction" && index !== undefined) {
        stripped.transactions[index] = {
          ...stripped.transactions[index],
          inclusionProof: proof,
        } as TxfTransaction;
        console.log(`✅ Transaction #${index} proof fetched`);
      }
    }

    // Create updated token
    const updatedToken = new Token({
      ...token,
      jsonData: JSON.stringify(stripped),
      status: allProofsSucceeded ? TokenStatus.CONFIRMED : token.status,
    });

    // Update in repository
    try {
      repo.updateToken(updatedToken);
      if (allProofsSucceeded) {
        succeeded++;
        console.log(`✅ Token updated successfully`);
      } else {
        // Partial success - some proofs failed
        failed++;
        errors.push({ tokenId: token.id, error: proofErrors.join("; ") });
        console.warn(`⚠️ Token updated with partial proofs`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Failed to update token:`, msg);
      errors.push({ tokenId: token.id, error: `Update error: ${msg}` });
      failed++;
    }

    console.groupEnd();
  }

  // Trigger UI refresh
  window.dispatchEvent(new Event("wallet-updated"));

  const duration = Date.now() - startTime;
  console.log(`✅ Complete: ${succeeded} succeeded, ${failed} failed (${duration}ms)`);
  console.groupEnd();

  return {
    totalTokens: tokens.length,
    succeeded,
    failed,
    errors,
    duration,
  };
}

/**
 * Set the aggregator URL at runtime (dev tools only)
 * Pass null to reset to the default from environment variable
 *
 * Usage from browser console:
 *   window.devSetAggregatorUrl("https://new-aggregator.example.com")
 *   window.devSetAggregatorUrl(null)  // Reset to default
 */
export function devSetAggregatorUrl(url: string | null): void {
  const oldUrl = ServiceProvider.getAggregatorUrl();
  ServiceProvider.setAggregatorUrl(url);
  const newUrl = ServiceProvider.getAggregatorUrl();

  console.log("🔄 Aggregator URL changed:");
  console.log(`   Old: ${oldUrl}`);
  console.log(`   New: ${newUrl}`);

  // Dispatch event to notify any listeners
  window.dispatchEvent(new Event("wallet-updated"));
}

/**
 * Get the current aggregator URL
 *
 * Usage from browser console:
 *   window.devGetAggregatorUrl()
 */
export function devGetAggregatorUrl(): string {
  return ServiceProvider.getAggregatorUrl();
}

/**
 * Skip trust base verification (dev mode only)
 * Use when connecting to aggregators with different trust bases
 *
 * Usage from browser console:
 *   window.devSkipTrustBaseVerification()
 */
export function devSkipTrustBaseVerification(): void {
  ServiceProvider.setSkipTrustBaseVerification(true);
}

/**
 * Re-enable trust base verification
 *
 * Usage from browser console:
 *   window.devEnableTrustBaseVerification()
 */
export function devEnableTrustBaseVerification(): void {
  ServiceProvider.setSkipTrustBaseVerification(false);
}

/**
 * Check if trust base verification is currently skipped
 *
 * Usage from browser console:
 *   window.devIsTrustBaseVerificationSkipped()
 */
export function devIsTrustBaseVerificationSkipped(): boolean {
  return ServiceProvider.isTrustBaseVerificationSkipped();
}

/**
 * Display help for all available dev commands
 *
 * Usage from browser console:
 *   window.devHelp()
 */
export function devHelp(): void {
  console.log("");
  console.log("🛠️  AgentSphere Developer Tools");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("  devHelp()");
  console.log("    Show this help message");
  console.log("");
  console.log("  devGetAggregatorUrl()");
  console.log("    Get the current Unicity aggregator URL");
  console.log("");
  console.log("  devSetAggregatorUrl(url)");
  console.log("    Change the aggregator URL at runtime");
  console.log("    Pass null to reset to default from environment variable");
  console.log("    Example: devSetAggregatorUrl('https://aggregator.example.com')");
  console.log("");
  console.log("  devSkipTrustBaseVerification()");
  console.log("    Disable trust base verification (for connecting to different aggregators)");
  console.log("");
  console.log("  devEnableTrustBaseVerification()");
  console.log("    Re-enable trust base verification");
  console.log("");
  console.log("  devIsTrustBaseVerificationSkipped()");
  console.log("    Check if trust base verification is currently disabled");
  console.log("");
  console.log("  devRefreshProofs()");
  console.log("    Re-fetch all Unicity proofs for tokens in the wallet");
  console.log("    Strips existing proofs and requests fresh ones from aggregator");
  console.log("    Returns: { totalTokens, succeeded, failed, errors, duration }");
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
}

/**
 * Register developer tools on the window object
 * Call this during app initialization in development mode
 */
export function registerDevTools(): void {
  window.devHelp = devHelp;
  window.devRefreshProofs = devRefreshProofs;
  window.devSetAggregatorUrl = devSetAggregatorUrl;
  window.devGetAggregatorUrl = devGetAggregatorUrl;
  window.devSkipTrustBaseVerification = devSkipTrustBaseVerification;
  window.devEnableTrustBaseVerification = devEnableTrustBaseVerification;
  window.devIsTrustBaseVerificationSkipped = devIsTrustBaseVerificationSkipped;
  console.log("🛠️ Dev tools registered. Type devHelp() for available commands.");
}
