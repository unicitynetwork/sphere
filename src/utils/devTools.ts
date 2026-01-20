/**
 * Developer Tools for AgentSphere
 *
 * This module provides utilities callable from the browser console for debugging
 * and development purposes. Only loaded in development mode.
 */

import { Token, TokenStatus } from "../components/wallet/L3/data/model";
import { ServiceProvider } from "../components/wallet/L3/services/ServiceProvider";
import {
  getTokensForAddress,
  getNametagForAddress,
  setNametagForAddress,
  getArchivedTokensForAddress,
  getInvalidatedNametagsForAddress,
  addToken as inventoryAddToken,
  dispatchWalletUpdated,
} from "../components/wallet/L3/services/InventorySyncService";
import { OutboxRepository } from "../repositories/OutboxRepository";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment";
import { MintTransactionData } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { RequestId } from "@unicitylabs/state-transition-sdk/lib/api/RequestId";
import { InclusionProof } from "@unicitylabs/state-transition-sdk/lib/transaction/InclusionProof";
import type { TxfToken, TxfInclusionProof, TxfTransaction, TxfGenesis } from "../components/wallet/L3/services/types/TxfTypes";
import type { OutboxEntry } from "../components/wallet/L3/services/types/OutboxTypes";

// Imports for devTopup (fungible token minting)
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState";
import { TokenCoinData } from "@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData";
import { CoinId } from "@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import { IdentityManager } from "../components/wallet/L3/services/IdentityManager";
import { IpfsStorageService } from "../components/wallet/L3/services/IpfsStorageService";
import { getIpfsHttpResolver } from "../components/wallet/L3/services/IpfsHttpResolver";
import { isActiveTokenKey, tokenIdFromKey, type TxfStorageData, type InvalidTokenEntry } from "../components/wallet/L3/services/types/TxfTypes";
import { unicityIdValidator, type UnicityIdValidationResult } from "./unicityIdValidator";

// Type declarations for window extension
declare global {
  interface Window {
    devHelp: () => void;
    devDumpLocalStorage: (filter?: string) => void;
    devRefreshProofs: () => Promise<RefreshProofsResult>;
    devSetAggregatorUrl: (url: string | null) => void;
    devGetAggregatorUrl: () => string;
    devSkipTrustBaseVerification: () => void;
    devEnableTrustBaseVerification: () => void;
    devIsTrustBaseVerificationSkipped: () => boolean;
    devTopup: (coins?: string[]) => Promise<TopupResult>;
    devReset: () => void;
    devRecoverCorruptedTokens: () => Promise<RecoverCorruptedTokensResult>;
    devDumpArchivedTokens: () => void;
    devIpfsSync: () => Promise<{ success: boolean; cid?: string; error?: string }>;
    devValidateUnicityId: () => Promise<UnicityIdValidationResult>;
    devRepairUnicityId: () => Promise<boolean>;
    devCheckNametag: (nametag: string) => Promise<string | null>;
    devRestoreNametag: (nametagName: string) => Promise<boolean>;
    devDumpNametagToken: () => Promise<unknown>;
    devInspectIpfs: () => Promise<unknown>;
  }
}

/**
 * Result of the devRecoverCorruptedTokens operation
 */
export interface RecoverCorruptedTokensResult {
  success: boolean;
  recovered: number;
  failed: number;
  details: Array<{ tokenId: string; status: string; error?: string }>;
}

/**
 * Result of the topup operation
 */
export interface TopupResult {
  success: boolean;
  mintedTokens: Array<{ coin: string; amount: string; tokenId: string }>;
  errors: Array<{ coin: string; error: string }>;
  duration: number;
}

/**
 * Coin configuration for dev topup
 */
const DEV_COIN_CONFIG = {
  bitcoin: {
    coinId: "86bc190fcf7b2d07c6078de93db803578760148b16d4431aa2f42a3241ff0daa",
    amount: BigInt("100000000"), // 1 BTC (8 decimals)
    symbol: "BTC",
  },
  solana: {
    coinId: "dee5f8ce778562eec90e9c38a91296a023210ccc76ff4c29d527ac3eb64ade93",
    amount: BigInt("1000000000000"), // 1000 SOL (9 decimals)
    symbol: "SOL",
  },
  ethereum: {
    coinId: "3c2450f2fd867e7bb60c6a69d7ad0e53ce967078c201a3ecaa6074ed4c0deafb",
    amount: BigInt("42000000000000000000"), // 42 ETH (18 decimals)
    symbol: "ETH",
  },
} as const;

const UNICITY_TOKEN_TYPE_HEX = "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

/**
 * Result of the proof refresh operation
 */
export interface RefreshProofsResult {
  totalTokens: number;
  refreshed: number;    // Actually got new proofs from aggregator
  kept: number;         // Couldn't refresh but original proofs were valid
  failed: number;       // Couldn't refresh AND no valid original
  errors: Array<{ tokenId: string; error: string }>;
  duration: number;
}

/**
 * Internal type for tracking proof fetch requests
 *
 * For genesis proofs: tokenId is used to derive the requestId
 * For transaction proofs: requestId cannot be derived from stateHash (they're different!)
 *                         Must use OutboxEntry recovery
 */
interface ProofRequest {
  type: "genesis" | "transaction";
  index?: number;
  tokenId?: string; // For genesis: used to derive requestId
  // Note: For transactions, we cannot derive requestId from any available data
  // We must use OutboxEntry recovery which has the full commitment
}

/**
 * Submit a commitment to the aggregator
 * Returns: "SUCCESS" | "REQUEST_ID_EXISTS" | error message
 */
async function submitCommitmentToAggregator(
  commitment: TransferCommitment
): Promise<{ success: boolean; status: string }> {
  try {
    const client = ServiceProvider.stateTransitionClient;
    const response = await client.submitTransferCommitment(commitment);

    if (response.status === "SUCCESS" || response.status === "REQUEST_ID_EXISTS") {
      return { success: true, status: response.status };
    }
    return { success: false, status: response.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, status: msg };
  }
}

/**
 * Submit a mint commitment to the aggregator
 * Returns: "SUCCESS" | "REQUEST_ID_EXISTS" | error message
 */
async function submitMintCommitmentToAggregator(
  commitment: MintCommitment<IMintTransactionReason>
): Promise<{ success: boolean; status: string }> {
  try {
    const client = ServiceProvider.stateTransitionClient;
    const response = await client.submitMintCommitment(commitment);

    if (response.status === "SUCCESS" || response.status === "REQUEST_ID_EXISTS") {
      return { success: true, status: response.status };
    }
    return { success: false, status: response.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, status: msg };
  }
}

/**
 * Reconstruct a MintCommitment from TxfGenesisData
 * This allows refreshing mint proofs after aggregator tree reset.
 *
 * Uses MintTransactionData.fromJSON() to parse the genesis data and
 * then creates a MintCommitment from it.
 */
async function reconstructMintCommitment(
  genesis: TxfGenesis
): Promise<{ commitment: MintCommitment<IMintTransactionReason> | null; error?: string }> {
  try {
    const data = genesis.data;

    // Debug: log what we're working with
    console.log(`   Debug genesis keys: ${genesis ? Object.keys(genesis).join(", ") : "(null)"}`);
    console.log(`   Debug data keys: ${data ? Object.keys(data).join(", ") : "(null)"}`);
    if (data) {
      console.log(`   Debug data.tokenId: ${data.tokenId?.slice(0, 16)}...`);
      console.log(`   Debug data.coinData: ${data.coinData ? `array[${data.coinData.length}]` : "(null)"}`);
      console.log(`   Debug data.salt: ${data.salt ? data.salt.slice(0, 16) + "..." : "(null)"}`);
    }

    // Convert TxfGenesisData to IMintTransactionDataJson format
    // TxfGenesisData.coinData is [string, string][] which matches TokenCoinDataJson
    // So we just pass it through directly
    const mintDataJson = {
      tokenId: data.tokenId,
      tokenType: data.tokenType,
      tokenData: data.tokenData || null,
      coinData: data.coinData && data.coinData.length > 0 ? data.coinData : null,
      recipient: data.recipient,
      salt: data.salt,
      recipientDataHash: data.recipientDataHash,
      reason: data.reason ? JSON.parse(data.reason) : null,
    };

    console.log(`   Debug mintDataJson created successfully`);

    // Use SDK's fromJSON to properly reconstruct the MintTransactionData
    const mintTransactionData = await MintTransactionData.fromJSON(mintDataJson);

    // Create commitment from transaction data
    const commitment = await MintCommitment.create(mintTransactionData);
    return { commitment };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`   Debug reconstruction error: ${msg}`);
    return { commitment: null, error: msg };
  }
}

// Note: To derive requestId from genesis data, we use reconstructMintCommitment()
// which properly creates the MintCommitment with correct requestId.
// The requestId depends on both the tokenId and the MintTransactionData.sourceState.

/**
 * Check if a proof JSON is an INCLUSION proof (has authenticator) vs EXCLUSION proof (no authenticator).
 * Uses SDK's InclusionProof class for proper type-safe checking.
 *
 * Per SDK: InclusionProof.authenticator is `Authenticator | null`
 * - If authenticator is present: inclusion proof (commitment exists in tree)
 * - If authenticator is null: exclusion proof (commitment NOT in tree, e.g., after tree reset)
 */
function isInclusionProofNotExclusion(proofJson: TxfInclusionProof | null): boolean {
  if (!proofJson) return false;

  try {
    // Use SDK's InclusionProof to properly parse and check
    const sdkProof = InclusionProof.fromJSON(proofJson);
    // SDK defines: authenticator: Authenticator | null
    // null = exclusion proof, non-null = inclusion proof
    return sdkProof.authenticator !== null;
  } catch {
    // If parsing fails, check raw JSON as fallback
    return proofJson.authenticator !== null && proofJson.authenticator !== undefined;
  }
}

/**
 * Wait for mint inclusion proof using the SDK
 */
async function waitForMintProofWithSDK(
  commitment: MintCommitment<IMintTransactionReason>,
  timeoutMs: number = 30000
): Promise<TxfInclusionProof | null> {
  try {
    const trustBase = ServiceProvider.getRootTrustBase();
    const client = ServiceProvider.stateTransitionClient;

    // If trust base verification is skipped, use direct polling
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      // Use toJSON() to get hex format, not toString() which gives human-readable format
      return await pollForProofNoVerify(commitment.requestId.toJSON(), timeoutMs);
    }

    const signal = AbortSignal.timeout(timeoutMs);
    const inclusionProof = await waitInclusionProof(trustBase, client, commitment, signal);
    return inclusionProof.toJSON() as TxfInclusionProof;
  } catch (error) {
    console.warn("Failed to wait for mint proof via SDK:", error);
    return null;
  }
}

/**
 * Wait for inclusion proof using the SDK (handles longer waits for block inclusion)
 */
async function waitForProofWithSDK(
  commitment: TransferCommitment,
  timeoutMs: number = 30000
): Promise<TxfInclusionProof | null> {
  try {
    const trustBase = ServiceProvider.getRootTrustBase();
    const client = ServiceProvider.stateTransitionClient;

    // If trust base verification is skipped, use direct polling
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      // Use toJSON() to get hex format, not toString() which gives human-readable format
      return await pollForProofNoVerify(commitment.requestId.toJSON(), timeoutMs);
    }

    const signal = AbortSignal.timeout(timeoutMs);
    const inclusionProof = await waitInclusionProof(trustBase, client, commitment, signal);
    return inclusionProof.toJSON() as TxfInclusionProof;
  } catch (error) {
    console.warn("Failed to wait for proof via SDK:", error);
    return null;
  }
}

/**
 * Poll for proof without verification (dev mode)
 * Uses the SDK's StateTransitionClient.getInclusionProof() method
 *
 * IMPORTANT: This function waits for an actual INCLUSION proof (with authenticator),
 * not just any proof. An exclusion proof (no authenticator) means the commitment
 * hasn't been included in the tree yet, so we keep polling.
 */
async function pollForProofNoVerify(
  requestIdStr: string,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<TxfInclusionProof | null> {
  const client = ServiceProvider.stateTransitionClient;
  const requestId = RequestId.fromJSON(requestIdStr);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await client.getInclusionProof(requestId);

      if (response.inclusionProof) {
        const proofJson = response.inclusionProof.toJSON() as TxfInclusionProof;

        // Check if this is an actual INCLUSION proof (has authenticator)
        // An exclusion proof (no authenticator) means the commitment hasn't been
        // included in the aggregator tree yet - keep polling
        if (isInclusionProofNotExclusion(proofJson)) {
          console.warn("⚠️ Returning inclusion proof WITHOUT verification (dev mode)");
          return proofJson;
        } else {
          // Got exclusion proof - commitment not yet in tree, keep polling
          console.log("   Polling: got exclusion proof (no authenticator), waiting for inclusion...");
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          continue;
        }
      }

      // No proof at all, keep polling
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } catch (error: unknown) {
      // 404 means proof not ready yet, keep polling
      const err = error as { status?: number };
      if (err?.status === 404) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      }
      // Other errors - retry
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return null;
}

/**
 * Wait for inclusion proof with dev mode bypass.
 *
 * When trust base verification is skipped (dev mode), this function polls
 * for the proof without SDK verification. Otherwise, it uses the normal
 * SDK waitInclusionProof with trust base verification.
 *
 * This is the PUBLIC API for use by transfer flows (useWallet.ts, etc.)
 *
 * @param commitment - TransferCommitment or MintCommitment
 * @param timeoutMs - Timeout in milliseconds (default 60s)
 * @returns SDK InclusionProof object
 * @throws Error if proof cannot be obtained
 */
export async function waitInclusionProofWithDevBypass(
  commitment: TransferCommitment | MintCommitment<IMintTransactionReason>,
  timeoutMs: number = 60000
): Promise<InclusionProof> {
  const trustBase = ServiceProvider.getRootTrustBase();
  const client = ServiceProvider.stateTransitionClient;

  // If trust base verification is skipped, use direct polling
  if (ServiceProvider.isTrustBaseVerificationSkipped()) {
    console.log("⚠️ Dev mode: bypassing trust base verification for proof");
    const proofJson = await pollForProofNoVerify(commitment.requestId.toJSON(), timeoutMs);
    if (!proofJson) {
      throw new Error("Failed to get inclusion proof (dev mode)");
    }
    return InclusionProof.fromJSON(proofJson);
  }

  // Normal mode: use SDK's waitInclusionProof with trust base verification
  const signal = AbortSignal.timeout(timeoutMs);
  return await waitInclusionProof(trustBase, client, commitment, signal);
}

/**
 * Fetch a proof from the aggregator using requestId with retry logic
 * Uses the SDK's StateTransitionClient.getInclusionProof() method
 */
async function fetchProofByRequestId(
  requestIdStr: string,
  maxRetries: number = 3
): Promise<TxfInclusionProof | null> {
  const client = ServiceProvider.stateTransitionClient;
  const requestId = RequestId.fromJSON(requestIdStr);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.getInclusionProof(requestId);

      if (response.inclusionProof) {
        const proofJson = response.inclusionProof.toJSON();
        return proofJson as TxfInclusionProof;
      }

      // No proof available
      return null;
    } catch (error: unknown) {
      // 404 means proof doesn't exist
      const err = error as { status?: number };
      if (err?.status === 404) {
        return null;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1s, 2s...
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }
    }
  }

  console.warn(`Failed to fetch proof for requestId ${requestIdStr.slice(0, 16)}... after ${maxRetries + 1} attempts:`, lastError);
  return null;
}

/**
 * Try to recover a token using OutboxEntry if available
 * This handles the case where commitment was never submitted or proof never received.
 *
 * @param tokenId - The token ID to recover
 * @param forceResubmit - If true, accept any entry with commitmentJson (for tree reset scenario)
 *                        If false, only accept uncommitted entries (READY_TO_SUBMIT, SUBMITTED)
 */
async function tryRecoverFromOutbox(
  tokenId: string,
  forceResubmit: boolean = false
): Promise<{ recovered: boolean; proof?: TxfInclusionProof; message: string }> {
  try {
    const outboxRepo = OutboxRepository.getInstance();
    const entries = outboxRepo.getAllEntries();

    // Find matching outbox entry by tokenId
    const entry = entries.find((e: OutboxEntry) => {
      if (e.sourceTokenId !== tokenId) return false;
      if (forceResubmit) {
        // Tree reset: accept any entry with commitment data, including PROOF_RECEIVED
        return !!e.commitmentJson;
      }
      // Normal: only uncommitted entries
      return e.status === "READY_TO_SUBMIT" || e.status === "SUBMITTED";
    });

    if (!entry) {
      return { recovered: false, message: "No matching outbox entry found" };
    }

    if (!entry.commitmentJson) {
      return { recovered: false, message: "Outbox entry missing commitment data" };
    }

    console.log(`📤 Found outbox entry for token ${tokenId.slice(0, 12)}... (status: ${entry.status})`);

    // Reconstruct commitment
    const commitmentData = JSON.parse(entry.commitmentJson);
    const commitment = await TransferCommitment.fromJSON(commitmentData);

    // Submit commitment (idempotent - REQUEST_ID_EXISTS is OK)
    const submitResult = await submitCommitmentToAggregator(commitment);
    console.log(`   Submission result: ${submitResult.status}`);

    if (!submitResult.success) {
      return { recovered: false, message: `Submission failed: ${submitResult.status}` };
    }

    // Wait for inclusion proof
    console.log(`   Waiting for inclusion proof...`);
    const proof = await waitForProofWithSDK(commitment, 60000); // 60 second timeout

    if (!proof) {
      return { recovered: false, message: "Timeout waiting for inclusion proof" };
    }

    // Update outbox entry status
    outboxRepo.updateStatus(entry.id, "PROOF_RECEIVED");

    return { recovered: true, proof, message: "Recovered via outbox" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { recovered: false, message: `Recovery error: ${msg}` };
  }
}

/**
 * Collect proof requests from a TxfToken WITHOUT modifying it.
 * Returns the list of proof requests needed for refresh.
 */
function collectProofRequests(txf: TxfToken): {
  requests: ProofRequest[];
  hasTransactions: boolean;
} {
  const requests: ProofRequest[] = [];
  let hasTransactions = false;

  // Handle genesis proof
  // For genesis, we can derive the requestId from the tokenId
  if (txf.genesis) {
    // Extract tokenId from genesis data for requestId derivation
    const tokenId = txf.genesis.data?.tokenId;
    requests.push({
      type: "genesis",
      tokenId: tokenId, // Will be used to derive requestId
    });
  }

  // Handle transaction proofs
  // For transactions, we CANNOT derive requestId from stateHash or any other field
  // We must use OutboxEntry recovery which has the full commitment data
  if (txf.transactions && txf.transactions.length > 0) {
    hasTransactions = true;
    for (let i = 0; i < txf.transactions.length; i++) {
      requests.push({
        type: "transaction",
        index: i,
        // No tokenId or requestId - must use OutboxEntry recovery
      });
    }
  }

  return { requests, hasTransactions };
}

/**
 * Re-fetch all unicity proofs for all tokens in the wallet
 *
 * This function:
 * 1. Scans all loaded L3 tokens
 * 2. Tries to fetch fresh proofs from the aggregator
 * 3. Only updates tokens if ALL proofs were successfully fetched
 * 4. Preserves original valid proofs if refresh fails
 *
 * Results:
 * - refreshed: Actually got new proofs from aggregator
 * - kept: Couldn't refresh but original proofs were valid (no changes made)
 * - failed: Couldn't refresh AND no valid original proofs
 *
 * Usage from browser console: await window.devRefreshProofs()
 */
export async function devRefreshProofs(): Promise<RefreshProofsResult> {
  const startTime = Date.now();
  const errors: Array<{ tokenId: string; error: string }> = [];
  let refreshed = 0;
  let kept = 0;
  let failed = 0;

  console.group("🔄 Dev: Refreshing Unicity Proofs");
  console.log(`📡 Aggregator: ${ServiceProvider.getAggregatorUrl()}`);
  console.log(`🔐 Trust base verification: ${ServiceProvider.isTrustBaseVerificationSkipped() ? "SKIPPED" : "enabled"}`);

  // Clear the spent state cache since we're regenerating proofs
  // This ensures tokens will be re-verified against the aggregator
  try {
    const { getTokenValidationService } = await import("../components/wallet/L3/services/TokenValidationService");
    const validationService = getTokenValidationService();
    validationService.clearSpentStateCache();
    console.log(`📦 Cleared spent state cache for proof refresh`);
  } catch (err) {
    console.warn("⚠️ Could not clear spent state cache:", err);
  }

  // Get current wallet address
  const identityManager = IdentityManager.getInstance();
  const identity = await identityManager.getCurrentIdentity();
  if (!identity) {
    console.error("❌ No wallet identity available");
    console.groupEnd();
    return {
      totalTokens: 0,
      refreshed: 0,
      kept: 0,
      failed: 0,
      errors: [{ tokenId: "all", error: "No identity" }],
      duration: Date.now() - startTime,
    };
  }

  const tokens = getTokensForAddress(identity.address);
  const nametag = getNametagForAddress(identity.address);

  // Include nametag token if present
  const hasNametag = !!(nametag?.token);

  const totalToProcess = tokens.length + (hasNametag ? 1 : 0);
  console.log(`📦 Found ${tokens.length} tokens${hasNametag ? ` + 1 nametag ("${nametag?.name}")` : ""} to process`);

  if (totalToProcess === 0) {
    console.log("No tokens found in wallet");
    console.groupEnd();
    return {
      totalTokens: 0,
      refreshed: 0,
      kept: 0,
      failed: 0,
      errors: [],
      duration: Date.now() - startTime,
    };
  }

  // Process nametag first if present
  if (hasNametag && nametag?.token) {
    console.group(`🏷️ Nametag "${nametag.name}"`);

    // The token is already an object from storage (NametagData.token is typed as object)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nametagTxf = nametag.token as any;
    const keys = Object.keys(nametagTxf);

    if (keys.length === 0) {
      console.error("   ❌ Nametag token is empty - may need to re-mint");
      errors.push({ tokenId: `nametag:${nametag.name}`, error: "Token data is empty" });
      failed++;
      console.groupEnd();
    } else if (!nametagTxf.genesis) {
      console.error("   ❌ Nametag token has no 'genesis' property");
      errors.push({ tokenId: `nametag:${nametag.name}`, error: "Invalid token structure - no genesis" });
      failed++;
      console.groupEnd();
    } else {
      // Check if original proof is valid (for fallback decision)
      const originalProofValid = isInclusionProofNotExclusion(nametagTxf.genesis?.inclusionProof as TxfInclusionProof | null);

      // Try to fetch new proof
      let newProof: TxfInclusionProof | null = null;
      const genesisData = nametagTxf.genesis.data;

      if (genesisData && genesisData.salt) {
        try {
          const txfGenesis = {
            data: genesisData,
            inclusionProof: nametagTxf.genesis.inclusionProof,
          } as TxfGenesis;

          console.log(`   genesis: Reconstructing mint commitment...`);
          const result = await reconstructMintCommitment(txfGenesis);
          if (result.commitment) {
            const correctRequestId = result.commitment.requestId.toJSON();
            console.log(`   genesis: Fetching proof by requestId...`);
            newProof = await fetchProofByRequestId(correctRequestId);

            if (isInclusionProofNotExclusion(newProof)) {
              console.log(`   ✅ genesis: Inclusion proof fetched successfully`);
            } else {
              // Try resubmission
              if (newProof) {
                console.log(`   ⚠️ genesis: Got EXCLUSION proof - tree was reset, resubmitting...`);
              } else {
                console.log(`   genesis: No proof found, resubmitting...`);
              }
              const submitResult = await submitMintCommitmentToAggregator(result.commitment);
              console.log(`   genesis: Submission result: ${submitResult.status}`);
              if (submitResult.success) {
                newProof = await waitForMintProofWithSDK(result.commitment, 60000);
                if (isInclusionProofNotExclusion(newProof)) {
                  console.log(`   ✅ genesis: New inclusion proof obtained after resubmission`);
                } else {
                  newProof = null;
                  console.warn(`   ⚠️ genesis: Failed to get valid proof after resubmission`);
                }
              } else {
                newProof = null;
              }
            }
          } else {
            console.warn(`   ❌ genesis: Cannot reconstruct mint: ${result.error}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`   ❌ genesis: Reconstruction error: ${msg}`);
        }
      } else {
        console.warn(`   ❌ genesis: Missing genesis.data or salt for reconstruction`);
      }

      // Decide: refreshed, kept, or failed
      if (newProof) {
        // Got new proof - update and save
        nametagTxf.genesis.inclusionProof = newProof;
        setNametagForAddress(identity.address, { ...nametag, token: nametagTxf });
        refreshed++;
        console.log(`✅ Nametag proof refreshed`);
      } else if (originalProofValid) {
        // Couldn't refresh but original is valid - keep it (don't save anything)
        kept++;
        console.log(`ℹ️ Keeping original valid proof (couldn't refresh from aggregator)`);
      } else {
        // Couldn't refresh AND original invalid
        failed++;
        errors.push({ tokenId: `nametag:${nametag.name}`, error: "Couldn't refresh and original proof invalid" });
        console.warn(`❌ Failed - no valid proofs available`);
      }
      console.groupEnd();
    }
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

    // Collect proof requests WITHOUT stripping
    const { requests, hasTransactions } = collectProofRequests(txf);

    if (requests.length === 0) {
      console.log("ℹ️ No proofs to refresh (token has no genesis/transactions)");
      kept++;
      console.groupEnd();
      continue;
    }

    console.log(`🔍 Processing ${requests.length} proof request(s) individually...`);
    if (hasTransactions) {
      console.log(`⚠️ Token has transactions - will attempt outbox recovery`);
    }

    // Process each proof INDIVIDUALLY - update token proof-by-proof
    // This supports different aggregators for different transactions
    let anyProofRefreshed = false;
    let anyProofFailed = false;
    let tokenModified = false;

    for (const req of requests) {
      const { type, index } = req;
      const label = `${type}${index !== undefined ? ` #${index}` : ""}`;

      // Get the current/original proof for this request
      let originalProof: TxfInclusionProof | null = null;
      if (type === "genesis") {
        originalProof = txf.genesis?.inclusionProof as TxfInclusionProof | null;
      } else if (type === "transaction" && index !== undefined) {
        originalProof = txf.transactions?.[index]?.inclusionProof as TxfInclusionProof | null;
      }
      const originalProofValid = isInclusionProofNotExclusion(originalProof);

      let newProof: TxfInclusionProof | null = null;

      // Strategy for genesis proofs
      if (type === "genesis") {
        const result = await reconstructMintCommitment(txf.genesis);
        if (result.commitment) {
          const derivedRequestId = result.commitment.requestId.toJSON();
          console.log(`   ${label}: Fetching proof...`);

          newProof = await fetchProofByRequestId(derivedRequestId);

          if (isInclusionProofNotExclusion(newProof)) {
            console.log(`   ✅ ${label}: Inclusion proof fetched`);
          } else {
            // Try resubmission
            if (newProof) {
              console.log(`   ⚠️ ${label}: Got EXCLUSION proof, resubmitting...`);
            } else {
              console.log(`   ${label}: No proof found, resubmitting...`);
            }
            const submitResult = await submitMintCommitmentToAggregator(result.commitment);
            console.log(`   ${label}: Submission result: ${submitResult.status}`);
            if (submitResult.success) {
              newProof = await waitForMintProofWithSDK(result.commitment, 60000);
              if (isInclusionProofNotExclusion(newProof)) {
                console.log(`   ✅ ${label}: New proof obtained after resubmission`);
              } else {
                newProof = null;
                console.warn(`   ⚠️ ${label}: Failed to get valid proof`);
              }
            } else {
              newProof = null;
            }
          }
        } else {
          console.warn(`   ❌ ${label}: Cannot reconstruct: ${result.error}`);
        }
      }

      // Strategy for transaction proofs - use OutboxEntry recovery
      if (type === "transaction") {
        console.log(`   ${label}: Attempting outbox recovery...`);
        const recovery = await tryRecoverFromOutbox(token.id, true);

        if (recovery.recovered && recovery.proof && isInclusionProofNotExclusion(recovery.proof)) {
          newProof = recovery.proof;
          console.log(`   ✅ ${label}: ${recovery.message}`);
        } else {
          console.warn(`   ⚠️ ${label}: ${recovery.message}`);
        }
      }

      // Decide what to do with this individual proof
      if (newProof) {
        // Got new proof - update this specific proof in the token
        if (type === "genesis") {
          (txf.genesis as { inclusionProof: TxfInclusionProof | null }).inclusionProof = newProof;
        } else if (type === "transaction" && index !== undefined) {
          txf.transactions[index] = {
            ...txf.transactions[index],
            inclusionProof: newProof,
          } as TxfTransaction;
        }
        anyProofRefreshed = true;
        tokenModified = true;
        console.log(`   🔄 ${label}: Updated with new proof`);
      } else if (originalProofValid) {
        // Couldn't get new proof but original is valid - keep it
        console.log(`   ℹ️ ${label}: Keeping original valid proof`);
      } else {
        // Couldn't get new proof AND original was invalid - this is a failure
        anyProofFailed = true;
        console.warn(`   ❌ ${label}: No valid proof available`);
        if (type === "transaction") {
          console.log(`   💡 If this is a received token, ask the sender to re-transfer`);
        }
      }
    }

    // Save token if any proof was modified
    if (tokenModified) {
      const updatedToken = new Token({
        ...token,
        jsonData: JSON.stringify(txf),
        status: anyProofFailed ? token.status : TokenStatus.CONFIRMED,
      });
      try {
        await inventoryAddToken(
          identity.address,
          identity.publicKey,
          identity.ipnsName ?? '',
          updatedToken,
          { local: true }
        );
        dispatchWalletUpdated();
        console.log(`💾 Token saved with updated proofs`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Failed to save token:`, msg);
        errors.push({ tokenId: token.id, error: `Save error: ${msg}` });
        failed++;
        console.groupEnd();
        continue;
      }
    }

    // Categorize the token result
    if (anyProofRefreshed && !anyProofFailed) {
      refreshed++;
      console.log(`✅ Token: all proofs valid (some refreshed)`);
    } else if (anyProofRefreshed && anyProofFailed) {
      // Partial success - some refreshed, some failed
      refreshed++;
      errors.push({ tokenId: token.id, error: "Some proofs couldn't be refreshed" });
      console.warn(`⚠️ Token: partial success (some proofs refreshed, some failed)`);
    } else if (!anyProofFailed) {
      // No refreshes but all originals were valid
      kept++;
      console.log(`ℹ️ Token: keeping all original valid proofs`);
    } else {
      // No refreshes and some proofs are invalid
      failed++;
      errors.push({ tokenId: token.id, error: "Some proofs invalid and couldn't be refreshed" });
      console.warn(`❌ Token: has invalid proofs that couldn't be refreshed`);
    }

    console.groupEnd();
  }

  // Trigger UI refresh
  window.dispatchEvent(new Event("wallet-updated"));

  const duration = Date.now() - startTime;
  console.log(`\n✅ Complete: ${refreshed} refreshed, ${kept} kept, ${failed} failed (${duration}ms)`);
  if (failed > 0) {
    console.log(`\n💡 Tips for failed tokens:`);
    console.log(`   - If commitment wasn't submitted: check if OutboxEntry exists`);
    console.log(`   - If using different aggregator: commitment may not exist there`);
    console.log(`   - For uncommitted transfers: use OutboxRecoveryService`);
  }
  console.groupEnd();

  return {
    totalTokens: totalToProcess,
    refreshed,
    kept,
    failed,
    errors,
    duration,
  };
}

/**
 * Mint a single fungible token with the specified coin configuration.
 * Internal helper for devTopup().
 */
async function mintFungibleToken(
  _coinName: string,
  coinConfig: { coinId: string; amount: bigint; symbol: string },
  identityManager: IdentityManager,
  secret: Buffer
): Promise<{ success: boolean; token?: Token; tokenId?: string; error?: string }> {
  try {
    // 1. Generate random tokenId and salt
    const tokenIdBytes = new Uint8Array(32);
    window.crypto.getRandomValues(tokenIdBytes);
    const tokenId = new TokenId(tokenIdBytes);

    const salt = new Uint8Array(32);
    window.crypto.getRandomValues(salt);

    // 2. Create token type
    const tokenType = new TokenType(Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex"));

    // 3. Get recipient address
    const ownerAddress = await identityManager.getWalletAddress();
    if (!ownerAddress) throw new Error("No wallet address");

    // 4. Create coin data
    const coinIdBuffer = Buffer.from(coinConfig.coinId, "hex");
    const coinId = new CoinId(coinIdBuffer);
    const coinData = TokenCoinData.create([[coinId, coinConfig.amount]]);

    // 5. Create mint transaction data
    const mintData = await MintTransactionData.create(
      tokenId,
      tokenType,
      null, // tokenData
      coinData,
      ownerAddress,
      Buffer.from(salt),
      null, // recipientDataHash
      null  // reason
    );

    // 6. Create commitment
    const commitment = await MintCommitment.create(mintData);

    // 7. Submit to aggregator
    const client = ServiceProvider.stateTransitionClient;
    const response = await client.submitMintCommitment(commitment);

    if (response.status !== "SUCCESS" && response.status !== "REQUEST_ID_EXISTS") {
      return { success: false, error: `Submission failed: ${response.status}` };
    }

    // 8. Wait for inclusion proof
    let proof: TxfInclusionProof | null;
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      proof = await pollForProofNoVerify(commitment.requestId.toJSON(), 60000);
    } else {
      const sdkProof = await waitInclusionProof(
        ServiceProvider.getRootTrustBase(),
        client,
        commitment
      );
      proof = sdkProof.toJSON() as TxfInclusionProof;
    }

    if (!proof || !isInclusionProofNotExclusion(proof)) {
      return { success: false, error: "Failed to get inclusion proof" };
    }

    // 9. Create token with predicate
    const signingService = await SigningService.createFromSecret(secret);
    const predicate = await UnmaskedPredicate.create(
      tokenId,
      tokenType,
      signingService,
      HashAlgorithm.SHA256,
      Buffer.from(salt)
    );

    // 10. Create SDK token
    const genesisTransaction = commitment.toTransaction(
      InclusionProof.fromJSON(proof)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sdkToken: SdkToken<any>;
    if (ServiceProvider.isTrustBaseVerificationSkipped()) {
      // Dev mode: create without verification
      const tokenJson = {
        version: "2.0",
        state: new TokenState(predicate, null).toJSON(),
        genesis: genesisTransaction.toJSON(),
        transactions: [],
        nametags: [],
      };
      sdkToken = await SdkToken.fromJSON(tokenJson);
    } else {
      sdkToken = await SdkToken.mint(
        ServiceProvider.getRootTrustBase(),
        new TokenState(predicate, null),
        genesisTransaction
      );
    }

    // 11. Create app Token and save to wallet
    const appToken = new Token({
      id: crypto.randomUUID(),
      name: coinConfig.symbol,
      type: "fungible",
      jsonData: JSON.stringify(sdkToken.toJSON()),
      status: TokenStatus.CONFIRMED,
      symbol: coinConfig.symbol,
      amount: coinConfig.amount.toString(),
      coinId: coinConfig.coinId,
      timestamp: Date.now(),
    });

    const ownerIdentity = await identityManager.getCurrentIdentity();
    if (!ownerIdentity) {
      return { success: false, error: "No identity available" };
    }

    await inventoryAddToken(
      ownerIdentity.address,
      ownerIdentity.publicKey,
      ownerIdentity.ipnsName ?? '',
      appToken,
      { local: true }
    );
    dispatchWalletUpdated();

    return {
      success: true,
      token: appToken,
      tokenId: Buffer.from(tokenIdBytes).toString("hex"),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Mint fungible tokens directly to the current wallet (dev/testing only).
 *
 * This function mints tokens locally using the SDK and aggregator, without
 * relying on the external faucet service. Tokens are saved to local storage
 * and synced to IPFS.
 *
 * Usage from browser console:
 *   await devTopup()                     // Mint BTC, SOL, ETH
 *   await devTopup(['bitcoin'])          // Mint only BTC
 *   await devTopup(['solana', 'ethereum']) // Mint SOL and ETH
 *
 * Note: Requires devSkipTrustBaseVerification() when using dev aggregators.
 */
export async function devTopup(
  coins: string[] = ["bitcoin", "solana", "ethereum"]
): Promise<TopupResult> {
  const startTime = Date.now();
  const mintedTokens: Array<{ coin: string; amount: string; tokenId: string }> = [];
  const errors: Array<{ coin: string; error: string }> = [];

  console.group("💰 Dev: Topup Tokens");
  console.log(`📡 Aggregator: ${ServiceProvider.getAggregatorUrl()}`);
  console.log(`🔐 Trust base verification: ${ServiceProvider.isTrustBaseVerificationSkipped() ? "SKIPPED" : "enabled"}`);
  console.log(`🪙 Coins to mint: ${coins.join(", ")}`);

  // Get identity
  const identityManager = IdentityManager.getInstance();
  const identity = await identityManager.getCurrentIdentity();
  if (!identity) {
    console.error("❌ No wallet identity found");
    console.groupEnd();
    return { success: false, mintedTokens: [], errors: [{ coin: "all", error: "No identity" }], duration: Date.now() - startTime };
  }

  const secret = Buffer.from(identity.privateKey, "hex");
  console.log(`👛 Wallet: ${identity.address.slice(0, 20)}...`);

  // Mint each requested coin
  for (const coinName of coins) {
    const config = DEV_COIN_CONFIG[coinName as keyof typeof DEV_COIN_CONFIG];
    if (!config) {
      console.warn(`⚠️ Unknown coin: ${coinName}`);
      errors.push({ coin: coinName, error: "Unknown coin" });
      continue;
    }

    console.log(`\n🪙 Minting ${config.symbol}...`);

    const result = await mintFungibleToken(coinName, config, identityManager, secret);

    if (result.success && result.tokenId) {
      console.log(`   ✅ Minted ${config.amount.toString()} ${config.symbol}`);
      console.log(`   📦 TokenID: ${result.tokenId.slice(0, 16)}...`);
      mintedTokens.push({
        coin: coinName,
        amount: config.amount.toString(),
        tokenId: result.tokenId,
      });
    } else {
      console.error(`   ❌ Failed: ${result.error}`);
      errors.push({ coin: coinName, error: result.error || "Unknown error" });
    }
  }

  // Sync to IPFS if any tokens were minted
  if (mintedTokens.length > 0) {
    console.log(`\n☁️ Syncing ${mintedTokens.length} new tokens to IPFS...`);
    try {
      const ipfsService = IpfsStorageService.getInstance(identityManager);

      // Wait for any existing sync to complete (with timeout)
      const MAX_WAIT_MS = 60000; // 60 seconds max wait
      const POLL_INTERVAL_MS = 500;
      const startWait = Date.now();

      while (ipfsService.isCurrentlySyncing() && Date.now() - startWait < MAX_WAIT_MS) {
        console.log(`   ⏳ Waiting for existing sync to complete...`);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (ipfsService.isCurrentlySyncing()) {
        console.warn(`   ⚠️ Existing sync did not complete within ${MAX_WAIT_MS / 1000}s, attempting sync anyway`);
      }

      // Now sync with the new tokens
      const result = await ipfsService.syncNow({ forceIpnsPublish: true });

      if (result.success) {
        console.log(`   ✅ IPFS sync complete (CID: ${result.cid?.slice(0, 16)}...)`);
        // Log IPNS publish status explicitly for diagnostics
        if (result.ipnsPublished) {
          console.log(`   ✅ IPNS record published (v${result.version})`);
        } else if (result.ipnsPublishPending) {
          console.warn(`   ⚠️ IPNS publish pending (will retry) - tokens may not persist in incognito!`);
        } else {
          console.log(`   ℹ️ IPNS unchanged (CID same as before)`);
        }
      } else if (result.error === "Sync already in progress") {
        // Retry once after waiting
        console.log(`   ⏳ Sync still in progress, waiting and retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const retryResult = await ipfsService.syncNow({ forceIpnsPublish: true });
        if (retryResult.success) {
          console.log(`   ✅ IPFS sync complete on retry (CID: ${retryResult.cid?.slice(0, 16)}...)`);
        } else {
          console.error(`   ⚠️ IPFS sync failed after retry: ${retryResult.error}`);
          errors.push({ coin: "ipfs", error: retryResult.error || "Sync failed" });
        }
      } else {
        console.error(`   ⚠️ IPFS sync failed: ${result.error}`);
        errors.push({ coin: "ipfs", error: result.error || "Sync failed" });
      }
    } catch (ipfsError) {
      const msg = ipfsError instanceof Error ? ipfsError.message : String(ipfsError);
      console.error(`   ⚠️ IPFS sync failed: ${msg}`);
      errors.push({ coin: "ipfs", error: msg });
    }
  }

  // Trigger UI refresh
  window.dispatchEvent(new Event("wallet-updated"));

  const duration = Date.now() - startTime;
  const success = mintedTokens.length > 0;

  console.log(`\n${success ? "✅" : "❌"} Complete: ${mintedTokens.length} minted, ${errors.length} failed (${duration}ms)`);
  console.groupEnd();

  return { success, mintedTokens, errors, duration };
}

/**
 * Recover corrupted tokens from archive that have undefined newStateHash
 *
 * This fixes tokens that were received via PROXY or DIRECT address transfers
 * but were saved incorrectly (without proper finalizeTransaction call).
 *
 * The recovery process uses the SDK's finalizeTransaction method (same as NostrService):
 * 1. Load archived tokens
 * 2. For each token with undefined newStateHash in last transaction:
 *    - Get the transfer salt from transaction data
 *    - Create recipient predicate using identity + salt
 *    - Determine if PROXY or DIRECT address
 *    - Get nametag token for PROXY addresses
 *    - Call finalizeTransaction() to properly update the token
 *    - Remove the tombstone and save the token
 * 3. Sync to IPFS
 */
export async function devRecoverCorruptedTokens(): Promise<RecoverCorruptedTokensResult> {
  console.group("🔧 Recovering corrupted tokens using SDK finalizeTransaction...");
  const details: Array<{ tokenId: string; status: string; error?: string }> = [];
  let recovered = 0;
  let failed = 0;

  try {
    // Get identity for predicate reconstruction
    const identityManager = IdentityManager.getInstance();
    const identity = await identityManager.getCurrentIdentity();

    if (!identity) {
      console.error("❌ No wallet identity found");
      console.groupEnd();
      return {
        success: false,
        recovered: 0,
        failed: 0,
        details: [{ tokenId: "all", status: "No wallet identity" }],
      };
    }

    const archivedTokens = getArchivedTokensForAddress(identity.address);

    console.log(`📦 Found ${archivedTokens.size} archived token(s)`);

    // Get my nametag token (needed for PROXY address verification)
    const nametagData = getNametagForAddress(identity.address);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let myNametagToken: SdkToken<any> | null = null;

    if (nametagData?.token) {
      try {
        myNametagToken = await SdkToken.fromJSON(nametagData.token);
        console.log(`✅ Loaded nametag token: @${nametagData.name}`);
      } catch (err) {
        console.warn(`⚠️ Could not load nametag token:`, err);
      }
    }

    const client = ServiceProvider.stateTransitionClient;
    const rootTrustBase = ServiceProvider.getRootTrustBase();
    const secret = Buffer.from(identity.privateKey, "hex");
    const signingService = await SigningService.createFromSecret(secret);

    for (const [tokenId, txf] of archivedTokens) {
      try {
        const lastTx = txf.transactions?.[txf.transactions.length - 1];

        // Check if this token needs recovery
        if (!lastTx) {
          console.log(`   ℹ️ Token ${tokenId.slice(0, 16)}... has no transactions, skipping`);
          details.push({ tokenId, status: "No transactions - skipped" });
          continue;
        }

        if (lastTx.newStateHash) {
          console.log(`   ℹ️ Token ${tokenId.slice(0, 16)}... already has newStateHash, skipping`);
          details.push({ tokenId, status: "Already has newStateHash - skipped" });
          continue;
        }

        console.log(`   🔧 Recovering token ${tokenId.slice(0, 16)}...`);

        // Get the transfer salt from the transaction data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txData = lastTx.data as any;
        const transferSalt = txData?.salt;
        const recipient = txData?.recipient;

        console.log(`      - Transfer salt: ${transferSalt ? transferSalt.slice(0, 16) + '...' : '❌ MISSING'}`);
        console.log(`      - Recipient: ${recipient || '❌ MISSING'}`);

        if (!transferSalt) {
          console.warn(`      ⚠️ No transfer salt in transaction data, cannot recover`);
          details.push({ tokenId, status: "No transfer salt", error: "Missing salt in transaction data" });
          failed++;
          continue;
        }

        // Determine if this is a PROXY or DIRECT address
        const isProxyAddress = recipient?.startsWith("PROXY://");
        console.log(`      - Address type: ${isProxyAddress ? 'PROXY' : 'DIRECT'}`);

        // For PROXY addresses, we need the nametag token
        if (isProxyAddress && !myNametagToken) {
          console.warn(`      ⚠️ PROXY address but no nametag token available, cannot recover`);
          details.push({ tokenId, status: "No nametag token for PROXY", error: "Missing nametag token" });
          failed++;
          continue;
        }

        // Load the source token from archived TXF (without the bad state)
        // We need to create a "source" token that represents the state BEFORE the transfer
        // This means we use the previousStateHash transaction data
        console.log(`      - Loading source token from TXF...`);

        // The archived TXF has the transfer transaction but with wrong state
        // We need to reconstruct what the source token looked like
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let sourceToken: SdkToken<any>;
        try {
          // Create a version of the TXF that represents the SOURCE token (before transfer)
          // This means excluding the last transaction that has the transfer
          const sourceTxf = {
            ...txf,
            // The state should be the SENDER's state (from lastTx.data.sourceState)
            state: txData.sourceState || txf.state,
            // Include the transfer transaction - SDK needs it for finalization
            transactions: txf.transactions,
          };
          sourceToken = await SdkToken.fromJSON(sourceTxf);
          console.log(`      ✅ Source token loaded`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`      ⚠️ Failed to load source token: ${msg}`);
          details.push({ tokenId, status: "Failed to load source token", error: msg });
          failed++;
          continue;
        }

        // Get genesis data for token type and ID
        const genesisData = txf.genesis?.data;
        if (!genesisData) {
          console.warn(`      ⚠️ No genesis data, cannot recover`);
          details.push({ tokenId, status: "No genesis data", error: "Missing genesis data" });
          failed++;
          continue;
        }

        const tokenType = TokenType.fromJSON(genesisData.tokenType);
        const tokenIdObj = TokenId.fromJSON(genesisData.tokenId);

        // Create the recipient predicate (same way NostrService does it)
        console.log(`      - Creating recipient predicate...`);
        const recipientPredicate = await UnmaskedPredicate.create(
          tokenIdObj,
          tokenType,
          signingService,
          HashAlgorithm.SHA256,
          Buffer.from(transferSalt, "hex")
        );

        const recipientState = new TokenState(recipientPredicate, null);
        console.log(`      ✅ Recipient predicate created`);

        // Get the transfer transaction from SDK
        // The lastTx is the JSON, we need to reconstruct the SDK TransferTransaction
        const { TransferTransaction } = await import("@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction");
        const transferTx = await TransferTransaction.fromJSON(lastTx);
        console.log(`      ✅ Transfer transaction loaded`);

        // Call finalizeTransaction - this is the key SDK method that handles everything
        console.log(`      - Calling finalizeTransaction (${isProxyAddress ? 'with nametag' : 'no nametag'})...`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let finalizedToken: SdkToken<any>;
        try {
          // Dev mode: skip trust base verification in finalizeTransaction
          if (ServiceProvider.isTrustBaseVerificationSkipped()) {
            console.log(`      ⚠️ Dev mode: attempting finalization without full verification`);
            // In dev mode, we can't use finalizeTransaction because it requires valid trust base
            // Instead, manually create the finalized token
            const finalizedTxf = {
              ...txf,
              state: recipientState.toJSON(),
              transactions: txf.transactions.map((tx, idx) => {
                if (idx === txf.transactions.length - 1) {
                  return {
                    ...tx,
                    // SDK sets newStateHash when applying the transaction
                    // For dev mode recovery, we calculate it ourselves
                    newStateHash: undefined, // Will be set below
                  };
                }
                return tx;
              }),
            };

            // Calculate the new state hash
            const newStateHash = await recipientState.calculateHash();
            const newStateHashStr = newStateHash.toJSON();
            console.log(`      - Calculated state hash: ${newStateHashStr.slice(0, 16)}...`);

            // Update the last transaction with the new state hash
            const lastTxIndex = finalizedTxf.transactions.length - 1;
            finalizedTxf.transactions[lastTxIndex] = {
              ...finalizedTxf.transactions[lastTxIndex],
              newStateHash: newStateHashStr,
            };

            finalizedToken = await SdkToken.fromJSON(finalizedTxf);
          } else {
            // Normal mode: use SDK's finalizeTransaction
            const nametagTokens = isProxyAddress && myNametagToken ? [myNametagToken] : [];
            finalizedToken = await client.finalizeTransaction(
              rootTrustBase,
              sourceToken,
              recipientState,
              transferTx,
              nametagTokens
            );
          }
          console.log(`      ✅ Token finalized successfully`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`      ❌ finalizeTransaction failed: ${msg}`);
          details.push({ tokenId, status: "finalizeTransaction failed", error: msg });
          failed++;
          continue;
        }

        // Note: Tombstones are managed by InventorySyncService automatically
        // When we add the recovered token, the next sync will clean up any tombstones

        // Get coin info from the token
        let amount = "0";
        let coinIdHex = tokenId;
        const symbol = "UNK";

        try {
          if (finalizedToken.coins?.coins) {
            const coinsMap = finalizedToken.coins.coins;
            if (coinsMap instanceof Map) {
              const firstEntry = coinsMap.entries().next().value;
              if (firstEntry) {
                const [key, val] = firstEntry;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const keyObj = key as any;
                if (keyObj && keyObj.data) {
                  coinIdHex = Buffer.from(keyObj.data).toString("hex");
                } else if (Buffer.isBuffer(key)) {
                  coinIdHex = key.toString("hex");
                }
                amount = val?.toString() || "0";
              }
            }
          }
        } catch {
          // Keep default values
        }

        // Serialize the finalized token
        const finalizedTxfJson = finalizedToken.toJSON();

        // Create a new Token object with the fixed data
        const { v4: uuidv4 } = await import("uuid");
        const fixedToken = new Token({
          id: uuidv4(),
          name: `Recovered ${symbol}`,
          type: finalizedToken.type?.toString() || tokenId,
          symbol: symbol,
          jsonData: JSON.stringify(finalizedTxfJson),
          status: TokenStatus.CONFIRMED,
          amount: amount,
          coinId: coinIdHex,
          timestamp: Date.now(),
        });

        // Add the recovered token to the wallet
        await inventoryAddToken(
          identity.address,
          identity.publicKey,
          identity.ipnsName ?? '',
          fixedToken,
          { local: true }
        );
        dispatchWalletUpdated();

        console.log(`      ✅ Token recovered successfully`);
        details.push({ tokenId, status: "Recovered" });
        recovered++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`      ❌ Failed to recover token ${tokenId.slice(0, 16)}...: ${msg}`);
        details.push({ tokenId, status: "Failed", error: msg });
        failed++;
      }
    }

    // Sync to IPFS if any tokens were recovered
    if (recovered > 0) {
      console.log(`\n📤 Syncing recovered tokens to IPFS...`);
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        if (ipfsService) {
          await ipfsService.syncNow({ forceIpnsPublish: true });
          console.log(`   ✅ IPFS sync complete`);
        }
      } catch (err) {
        console.error(`   ⚠️ IPFS sync failed:`, err);
      }

      // Trigger UI refresh
      window.dispatchEvent(new Event("wallet-updated"));
    }

    console.log(`\n✅ Recovery complete: ${recovered} recovered, ${failed} failed`);
    console.groupEnd();

    return {
      success: recovered > 0,
      recovered,
      failed,
      details,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Recovery failed: ${msg}`);
    console.groupEnd();
    return {
      success: false,
      recovered,
      failed,
      details: [{ tokenId: "global", status: "Failed", error: msg }],
    };
  }
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
  console.log(`   📦 Setting persisted to localStorage`);

  // Dispatch events to notify UI components
  window.dispatchEvent(new Event("wallet-updated"));
  window.dispatchEvent(new Event("dev-config-changed"));
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
  console.log(`   📦 Setting persisted to localStorage`);
  window.dispatchEvent(new Event("dev-config-changed"));
}

/**
 * Re-enable trust base verification
 *
 * Usage from browser console:
 *   window.devEnableTrustBaseVerification()
 */
export function devEnableTrustBaseVerification(): void {
  ServiceProvider.setSkipTrustBaseVerification(false);
  console.log(`   📦 Setting persisted to localStorage`);
  window.dispatchEvent(new Event("dev-config-changed"));
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
 * Reset all dev settings to production defaults
 * - Resets aggregator URL to default from environment variable
 * - Enables trust base verification
 * - Removes DEV banner from header
 *
 * Usage from browser console:
 *   window.devReset()
 */
export function devReset(): void {
  ServiceProvider.setAggregatorUrl(null);
  ServiceProvider.setSkipTrustBaseVerification(false);
  console.log("🔄 Dev settings reset to production defaults");
  window.dispatchEvent(new Event("dev-config-changed"));
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
  console.log("  devDumpLocalStorage(filter?)");
  console.log("    Dump all localStorage data with detailed wallet analysis");
  console.log("    Shows tokens, tombstones, archived tokens, and state hashes");
  console.log("    Example: devDumpLocalStorage()          // All keys");
  console.log("    Example: devDumpLocalStorage('wallet')  // Filter by 'wallet'");
  console.log("");
  console.log("  devGetAggregatorUrl()");
  console.log("    Get the current Unicity aggregator URL");
  console.log("");
  console.log("  devSetAggregatorUrl(url)");
  console.log("    Change the aggregator URL at runtime (persists across page reloads)");
  console.log("    Pass null to reset to default from environment variable");
  console.log("    Example: devSetAggregatorUrl('/dev-rpc')  // Uses Vite proxy");
  console.log("    Proxied routes: /rpc (testnet), /dev-rpc (dev aggregator)");
  console.log("");
  console.log("  devSkipTrustBaseVerification()");
  console.log("    Disable trust base verification (persists across page reloads)");
  console.log("    Use when connecting to aggregators with different trust bases");
  console.log("");
  console.log("  devEnableTrustBaseVerification()");
  console.log("    Re-enable trust base verification (persists across page reloads)");
  console.log("");
  console.log("  devIsTrustBaseVerificationSkipped()");
  console.log("    Check if trust base verification is currently disabled");
  console.log("");
  console.log("  devReset()");
  console.log("    Reset all dev settings to production defaults");
  console.log("    Resets aggregator URL and enables trust base verification");
  console.log("");
  console.log("  devRefreshProofs()");
  console.log("    Re-fetch all Unicity proofs for tokens in the wallet");
  console.log("    Strips existing proofs and requests fresh ones from aggregator");
  console.log("    Returns: { totalTokens, succeeded, failed, errors, duration }");
  console.log("");
  console.log("  devTopup(coins?)");
  console.log("    Mint fungible tokens to current wallet and sync to IPFS");
  console.log("    Default coins: ['bitcoin', 'solana', 'ethereum']");
  console.log("    Amounts: BTC=1, SOL=1000, ETH=42");
  console.log("    Example: devTopup() or devTopup(['bitcoin'])");
  console.log("    Note: Requires devSkipTrustBaseVerification() for dev aggregators");
  console.log("");
  console.log("  devRecoverCorruptedTokens()");
  console.log("    Recover tokens from archive that have corrupted state data");
  console.log("    Fixes tokens received via DIRECT address transfer before bug fix");
  console.log("    Updates newStateHash and removes tombstones for recovered tokens");
  console.log("    Returns: { success, recovered, failed, details }");
  console.log("");
  console.log("  devValidateUnicityId()");
  console.log("    Validate your Unicity ID (nametag) configuration");
  console.log("    Checks: identity exists, nametag token valid, Nostr binding correct");
  console.log("    Returns: { isValid, identity, nametag, nostrBinding, errors, warnings }");
  console.log("");
  console.log("  devRepairUnicityId()");
  console.log("    Attempt to repair a broken Unicity ID by re-publishing to Nostr");
  console.log("    Only works if nametag is not already owned by someone else");
  console.log("    Returns: true if successful, false otherwise");
  console.log("");
  console.log("  devCheckNametag(name)");
  console.log("    Check who owns a nametag on Nostr relay");
  console.log("    Returns: pubkey if owned, null if available");
  console.log("    Example: devCheckNametag('eric')");
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
}

/**
 * Search chat messages for token transfer data containing the salt
 * The transfer payload might still be in message history!
 *
 * Usage from browser console:
 *   window.devFindTransferSalt(tokenId)
 */
export function devFindTransferSalt(tokenId: string): { found: boolean; salt?: string; fullPayload?: unknown } {
  console.group(`🔍 Searching for transfer salt for token ${tokenId.slice(0, 16)}...`);

  try {
    // Get all chat messages from localStorage
    const messagesJson = localStorage.getItem("unicity_chat_messages");
    if (!messagesJson) {
      console.log("No chat messages found in localStorage");
      console.groupEnd();
      return { found: false };
    }

    const messages = JSON.parse(messagesJson) as Array<{
      id: string;
      content: string;
      type: string;
      metadata?: Record<string, unknown>;
    }>;

    console.log(`Found ${messages.length} messages in history`);

    // Search for TOKEN_TRANSFER messages or any message containing the tokenId
    for (const msg of messages) {
      // Check if content contains the tokenId
      if (msg.content?.includes(tokenId) || msg.content?.includes(tokenId.slice(0, 32))) {
        console.log(`Found message potentially containing token: ${msg.id}`);

        try {
          // Try to parse the content as JSON payload
          const payload = JSON.parse(msg.content);

          // Check for transferTx with salt
          if (payload.transferTx) {
            const transferTx = typeof payload.transferTx === 'string'
              ? JSON.parse(payload.transferTx)
              : payload.transferTx;

            if (transferTx.data?.salt) {
              console.log(`✅ Found transfer salt in message ${msg.id}!`);
              console.log(`   Salt: ${transferTx.data.salt}`);
              console.groupEnd();
              return {
                found: true,
                salt: transferTx.data.salt,
                fullPayload: payload,
              };
            }
          }

          // Check sourceToken for matching token ID
          if (payload.sourceToken) {
            const sourceToken = typeof payload.sourceToken === 'string'
              ? JSON.parse(payload.sourceToken)
              : payload.sourceToken;

            if (sourceToken.genesis?.data?.tokenId === tokenId) {
              console.log(`Found matching sourceToken in message ${msg.id}`);
              // Look for transferTx in the same payload
              if (payload.transferTx) {
                const transferTx = typeof payload.transferTx === 'string'
                  ? JSON.parse(payload.transferTx)
                  : payload.transferTx;
                if (transferTx.data?.salt) {
                  console.log(`✅ Found transfer salt!`);
                  console.log(`   Salt: ${transferTx.data.salt}`);
                  console.groupEnd();
                  return {
                    found: true,
                    salt: transferTx.data.salt,
                    fullPayload: payload,
                  };
                }
              }
            }
          }
        } catch {
          // Not JSON, skip
        }
      }

      // Also check TOKEN_TRANSFER type messages
      if (msg.type === 'TOKEN_TRANSFER' && msg.metadata) {
        console.log(`Found TOKEN_TRANSFER message: ${msg.id}`);
        console.log(`Metadata:`, msg.metadata);
        // Check if metadata has transfer info
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = msg.metadata as any;
        if (meta?.salt) {
          console.log(`✅ Found salt in message metadata!`);
          console.groupEnd();
          return { found: true, salt: meta.salt, fullPayload: msg };
        }
      }
    }

    console.log(`❌ No transfer salt found for token ${tokenId.slice(0, 16)}...`);
    console.groupEnd();
    return { found: false };
  } catch (err) {
    console.error("Error searching messages:", err);
    console.groupEnd();
    return { found: false };
  }
}

// Add to window interface
declare global {
  interface Window {
    devFindTransferSalt: (tokenId: string) => { found: boolean; salt?: string; fullPayload?: unknown };
  }
}

/**
 * Dump all archived tokens to console for analysis
 * Use this to understand the structure of corrupted tokens
 *
 * Usage from browser console:
 *   window.devDumpArchivedTokens()
 */
export async function devDumpArchivedTokens(): Promise<void> {
  console.group("📦 Archived Tokens Dump");

  const identityManager = IdentityManager.getInstance();
  const identity = await identityManager.getCurrentIdentity();
  if (!identity) {
    console.error("❌ No wallet identity available");
    console.groupEnd();
    return;
  }

  const archivedTokens = getArchivedTokensForAddress(identity.address);

  console.log(`Found ${archivedTokens.size} archived token(s)`);

  for (const [tokenId, txf] of archivedTokens) {
    console.group(`\n🔸 Token: ${tokenId.slice(0, 16)}...`);

    // Basic structure
    console.log("Top-level keys:", Object.keys(txf));
    console.log("Version:", txf.version);

    // Genesis
    console.group("📜 Genesis:");
    console.log("Keys:", Object.keys(txf.genesis || {}));
    if (txf.genesis?.data) {
      console.log("genesis.data.tokenId:", txf.genesis.data.tokenId?.slice(0, 16) + '...');
      console.log("genesis.data.tokenType:", txf.genesis.data.tokenType?.slice(0, 16) + '...');
      console.log("genesis.data.salt:", txf.genesis.data.salt);
      console.log("genesis.data.recipient:", txf.genesis.data.recipient);
      console.log("genesis.data.coinData:", txf.genesis.data.coinData);
    }
    if (txf.genesis?.inclusionProof) {
      console.log("genesis.inclusionProof.authenticator.stateHash:", txf.genesis.inclusionProof.authenticator?.stateHash);
    }
    console.groupEnd();

    // State
    console.group("🔐 State:");
    console.log("state.data:", txf.state?.data);
    console.log("state.predicate:", txf.state?.predicate?.slice(0, 64) + '...');
    console.groupEnd();

    // Transactions
    console.group(`📝 Transactions (${txf.transactions?.length || 0}):`);
    txf.transactions?.forEach((tx, idx) => {
      console.group(`Transaction[${idx}]:`);
      console.log("Keys:", Object.keys(tx));
      console.log("previousStateHash:", tx.previousStateHash?.slice(0, 32) + '...');
      console.log("newStateHash:", tx.newStateHash || '❌ MISSING');
      console.log("predicate:", tx.predicate?.slice(0, 32) || '❌ MISSING');
      console.log("data:", tx.data);
      console.log("inclusionProof:", tx.inclusionProof ? '✅ present' : '❌ missing');
      if (tx.inclusionProof) {
        console.log("  authenticator.stateHash:", tx.inclusionProof.authenticator?.stateHash);
        console.log("  transactionHash:", tx.inclusionProof.transactionHash?.slice(0, 32) + '...');
      }
      console.groupEnd();
    });
    console.groupEnd();

    // Raw JSON for deep inspection
    console.log("📋 Full TXF JSON:", JSON.stringify(txf, null, 2));

    console.groupEnd();
  }

  console.groupEnd();
}

/**
 * Dump all localStorage data for debugging
 * Parses JSON values and displays them in a structured format
 *
 * Usage from browser console:
 *   devDumpLocalStorage()           // Dump all keys
 *   devDumpLocalStorage('wallet')   // Filter keys containing 'wallet'
 *   devDumpLocalStorage('unicity')  // Filter keys containing 'unicity'
 */
export function devDumpLocalStorage(filter?: string): void {
  console.group("📦 LocalStorage Dump" + (filter ? ` (filter: "${filter}")` : ""));

  const keys = Object.keys(localStorage).sort();
  const filteredKeys = filter
    ? keys.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
    : keys;

  console.log(`Total keys: ${keys.length}, Showing: ${filteredKeys.length}`);
  console.log("");

  let totalSize = 0;

  for (const key of filteredKeys) {
    const value = localStorage.getItem(key);
    if (!value) continue;

    const sizeBytes = new Blob([value]).size;
    totalSize += sizeBytes;
    const sizeStr = sizeBytes > 1024
      ? `${(sizeBytes / 1024).toFixed(1)} KB`
      : `${sizeBytes} B`;

    console.group(`🔑 ${key} (${sizeStr})`);

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(value);

      // Special handling for wallet data
      if (key.startsWith("unicity_wallet_")) {
        const wallet = parsed;
        console.log("📋 Wallet Summary:");
        console.log(`   Address: ${wallet.address || "(none)"}`);
        console.log(`   Tokens: ${wallet.tokens?.length || 0}`);
        console.log(`   Tombstones: ${wallet.tombstones?.length || 0}`);
        console.log(`   Archived: ${wallet.archivedTokens ? Object.keys(wallet.archivedTokens).length : 0}`);
        console.log(`   Forked: ${wallet.forkedTokens ? Object.keys(wallet.forkedTokens).length : 0}`);
        console.log(`   Invalidated Nametags: ${wallet.invalidatedNametags?.length || 0}`);

        if (wallet.nametag) {
          console.log(`   Nametag: @${wallet.nametag.name}`);
        }

        // Token details
        if (wallet.tokens?.length > 0) {
          console.group("   📦 Tokens:");
          for (const token of wallet.tokens) {
            let tokenId = token.id;
            let stateInfo = "";
            try {
              const txf = JSON.parse(token.jsonData || "{}");
              tokenId = txf.genesis?.data?.tokenId || token.id;
              const txCount = txf.transactions?.length || 0;
              const lastTx = txf.transactions?.[txCount - 1];
              stateInfo = lastTx?.newStateHash
                ? `state=${lastTx.newStateHash.slice(0, 12)}...`
                : txf._integrity?.currentStateHash
                  ? `genesis-state=${txf._integrity.currentStateHash.slice(0, 12)}...`
                  : "(no state hash)";
            } catch { /* ignore */ }
            console.log(`   - ${tokenId.slice(0, 12)}... ${token.symbol || ""} ${token.amount || ""} ${stateInfo}`);
          }
          console.groupEnd();
        }

        // Tombstone details
        if (wallet.tombstones?.length > 0) {
          console.group("   💀 Tombstones:");
          for (const t of wallet.tombstones) {
            console.log(`   - ${t.tokenId.slice(0, 12)}... state=${t.stateHash.slice(0, 12)}... (${new Date(t.timestamp).toISOString()})`);
          }
          console.groupEnd();
        }

        // Archived token details
        if (wallet.archivedTokens && Object.keys(wallet.archivedTokens).length > 0) {
          console.group("   📁 Archived Tokens:");
          for (const [id, txf] of Object.entries(wallet.archivedTokens)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = txf as any;
            const txCount = t.transactions?.length || 0;
            console.log(`   - ${id.slice(0, 12)}... (${txCount} transactions)`);
          }
          console.groupEnd();
        }

        // Full raw data
        console.log("📋 Raw data:", parsed);
      }
      // Special handling for outbox
      else if (key === "transfer_outbox" || key === "mint_outbox") {
        const entries = Array.isArray(parsed) ? parsed : [];
        console.log(`Entries: ${entries.length}`);
        for (const entry of entries) {
          console.log(`   - ${entry.id?.slice(0, 8) || "?"} status=${entry.status} token=${entry.sourceTokenId?.slice(0, 12) || entry.tokenId?.slice(0, 12) || "?"}...`);
        }
        console.log("📋 Raw data:", parsed);
      }
      // Generic JSON
      else {
        // For large objects, show summary
        if (typeof parsed === "object" && parsed !== null) {
          const keys = Object.keys(parsed);
          if (keys.length > 10) {
            console.log(`Object with ${keys.length} keys:`, keys.slice(0, 10).join(", ") + "...");
          }
          if (Array.isArray(parsed)) {
            console.log(`Array with ${parsed.length} elements`);
          }
        }
        console.log("📋 Value:", parsed);
      }
    } catch {
      // Not JSON, show as string (truncated if long)
      if (value.length > 200) {
        console.log(`📋 Value (truncated): ${value.slice(0, 200)}...`);
      } else {
        console.log(`📋 Value: ${value}`);
      }
    }

    console.groupEnd();
  }

  console.log("");
  const totalSizeStr = totalSize > 1024 * 1024
    ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
    : totalSize > 1024
      ? `${(totalSize / 1024).toFixed(1)} KB`
      : `${totalSize} B`;
  console.log(`📊 Total size: ${totalSizeStr}`);
  console.groupEnd();
}

/**
 * Inspect remote IPFS storage data
 * Fetches the current IPNS-resolved content and displays its structure
 *
 * Usage from browser console:
 *   devInspectIpfs()
 */
export async function devInspectIpfs(): Promise<unknown> {
  console.group("📦 IPFS Remote Data Inspection");

  try {
    const identityManager = IdentityManager.getInstance();
    const identity = await identityManager.getCurrentIdentity();

    if (!identity) {
      console.error("❌ No wallet identity available");
      console.groupEnd();
      return { error: "No identity" };
    }

    console.log(`📋 Identity: ${identity.address.slice(0, 30)}...`);

    // Get IPNS name from IpfsStorageService (it computes from identity keys)
    const ipfsService = IpfsStorageService.getInstance(identityManager);
    const ipnsName = ipfsService.getIpnsName();

    if (!ipnsName) {
      console.error("❌ No IPNS name available - IPFS service may not be initialized");
      console.groupEnd();
      return { error: "No IPNS name" };
    }

    console.log(`📋 IPNS Name: ${ipnsName}`);

    // Resolve IPNS and fetch content
    const httpResolver = getIpfsHttpResolver();
    console.log("🔍 Resolving IPNS...");

    const ipnsResult = await httpResolver.resolveIpnsName(ipnsName);
    if (!ipnsResult.cid) {
      console.warn("⚠️ No CID found for IPNS name - wallet may not have been synced to IPFS yet");
      console.groupEnd();
      return { error: "No IPNS record", ipnsName: identity.ipnsName };
    }

    console.log(`✅ IPNS resolved: CID=${ipnsResult.cid.slice(0, 20)}..., seq=${ipnsResult.sequence}`);

    // Fetch content with CID verification
    console.log("📥 Fetching content from IPFS...");
    const content = await httpResolver.fetchContentByCid(ipnsResult.cid) as TxfStorageData | null;

    if (!content) {
      console.error("❌ Failed to fetch content from IPFS (CID verification failed)");
      console.groupEnd();
      return { error: "Fetch failed - CID mismatch", cid: ipnsResult.cid };
    }

    // Analyze content
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("📊 IPFS STORAGE CONTENT SUMMARY");
    console.log("═══════════════════════════════════════════════════════════════\n");

    // Meta
    if (content._meta) {
      console.log("📋 _meta:");
      console.log(`   Version: ${content._meta.version}`);
      console.log(`   Address: ${content._meta.address?.slice(0, 30)}...`);
      console.log(`   IPNS Name: ${content._meta.ipnsName}`);
      console.log(`   Format: ${content._meta.formatVersion}`);
      console.log(`   Last CID: ${content._meta.lastCid?.slice(0, 20) || "(none)"}...`);
    }

    // Nametag
    if (content._nametag) {
      console.log(`\n📛 _nametag: "${content._nametag.name}"`);
    } else {
      console.log("\n📛 _nametag: (none)");
    }

    // Active tokens
    const tokenKeys = Object.keys(content).filter(isActiveTokenKey);
    console.log(`\n🪙 Active tokens: ${tokenKeys.length}`);
    for (const key of tokenKeys) {
      const tokenId = tokenIdFromKey(key);
      const token = content[key] as TxfToken;
      console.log(`   - ${tokenId.slice(0, 16)}... (tx=${token.transactions?.length || 0})`);
    }

    // Invalid tokens
    const invalidTokens = content._invalid as InvalidTokenEntry[] | undefined;
    console.log(`\n❌ _invalid tokens: ${invalidTokens?.length || 0}`);
    if (invalidTokens && invalidTokens.length > 0) {
      for (const entry of invalidTokens) {
        const tokenId = entry.token?.genesis?.data?.tokenId || "unknown";
        console.log(`   - ${tokenId.slice(0, 16)}...`);
        console.log(`     Reason: ${entry.reason}`);
        console.log(`     Details: ${entry.details || "(none)"}`);
        console.log(`     Invalidated: ${new Date(entry.invalidatedAt).toISOString()}`);
      }
    }

    // Tombstones
    const tombstones = content._tombstones;
    console.log(`\n⚰️ _tombstones: ${tombstones?.length || 0}`);
    if (tombstones && tombstones.length > 0) {
      for (const ts of tombstones) {
        console.log(`   - ${ts.tokenId.slice(0, 16)}... (state: ${ts.stateHash.slice(0, 12)}...)`);
      }
    }

    // Sent tokens
    const sentTokens = content._sent;
    console.log(`\n📤 _sent tokens: ${sentTokens?.length || 0}`);

    // Outbox
    const outbox = content._outbox;
    console.log(`\n📮 _outbox entries: ${outbox?.length || 0}`);

    // Mint outbox
    const mintOutbox = content._mintOutbox;
    console.log(`\n🏭 _mintOutbox entries: ${mintOutbox?.length || 0}`);

    // Invalidated nametags
    const invalidatedNametags = content._invalidatedNametags;
    console.log(`\n🚫 _invalidatedNametags: ${invalidatedNametags?.length || 0}`);

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.groupEnd();

    return {
      cid: ipnsResult.cid,
      sequence: ipnsResult.sequence,
      meta: content._meta,
      activeTokens: tokenKeys.length,
      invalidTokens: invalidTokens?.length || 0,
      tombstones: tombstones?.length || 0,
      sentTokens: sentTokens?.length || 0,
      outboxEntries: outbox?.length || 0,
      rawContent: content
    };

  } catch (error) {
    console.error("❌ Error inspecting IPFS:", error);
    console.groupEnd();
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Register developer tools on the window object
 * Call this during app initialization in development mode
 */
export function registerDevTools(): void {
  window.devHelp = devHelp;
  window.devDumpLocalStorage = devDumpLocalStorage;
  window.devRefreshProofs = devRefreshProofs;
  window.devSetAggregatorUrl = devSetAggregatorUrl;
  window.devGetAggregatorUrl = devGetAggregatorUrl;
  window.devSkipTrustBaseVerification = devSkipTrustBaseVerification;
  window.devEnableTrustBaseVerification = devEnableTrustBaseVerification;
  window.devIsTrustBaseVerificationSkipped = devIsTrustBaseVerificationSkipped;
  window.devReset = devReset;
  window.devTopup = devTopup;
  window.devRecoverCorruptedTokens = devRecoverCorruptedTokens;
  window.devDumpArchivedTokens = devDumpArchivedTokens;
  window.devFindTransferSalt = devFindTransferSalt;
  window.devIpfsSync = async () => {
    const identityManager = IdentityManager.getInstance();
    const identity = await identityManager.getCurrentIdentity();
    if (!identity) {
      console.error("❌ No wallet identity available");
      return { success: false, error: "No identity" };
    }
    const ipfsService = IpfsStorageService.getInstance(identityManager);
    console.log("☁️ Triggering IPFS sync...");
    const result = await ipfsService.syncNow({ forceIpnsPublish: false, callerContext: "devIpfsSync" });
    if (result.success) {
      console.log(`✅ IPFS sync complete (CID: ${result.cid?.slice(0, 16)}...)`);
    } else {
      console.error(`❌ IPFS sync failed: ${result.error}`);
    }
    return result;
  };
  window.devValidateUnicityId = unicityIdValidator.validate;
  window.devRepairUnicityId = unicityIdValidator.repair;
  window.devCheckNametag = unicityIdValidator.getNametagOwner;
  window.devRestoreNametag = async (nametagName: string) => {
    const identityManager = IdentityManager.getInstance();
    const identity = await identityManager.getCurrentIdentity();
    if (!identity) {
      console.error("❌ No wallet identity available");
      return false;
    }
    const invalidated = getInvalidatedNametagsForAddress(identity.address);
    console.log(`📋 Invalidated nametags: ${invalidated.map(e => e.name).join(", ") || "(none)"}`);
    if (nametagName) {
      // NOTE: restoreInvalidatedNametag requires direct WalletRepository access (dev tool only)
      // This function would need to be implemented in InventorySyncService for full migration
      console.error("❌ restoreInvalidatedNametag not yet migrated - requires WalletRepository");
      return false;
    }
    return false;
  };
  window.devDumpNametagToken = async () => {
    const identityManager = IdentityManager.getInstance();
    const identity = await identityManager.getCurrentIdentity();
    if (!identity) {
      console.error("❌ No wallet identity available");
      return null;
    }
    const nametagData = getNametagForAddress(identity.address);
    if (!nametagData) {
      console.log("❌ No nametag found");
      return null;
    }
    console.log("📋 Nametag data:", {
      name: nametagData.name,
      timestamp: nametagData.timestamp,
      format: nametagData.format,
      version: nametagData.version,
    });
    console.log("📋 Raw token:", nametagData.token);

    try {
      const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
      const token = await Token.fromJSON(nametagData.token);
      console.log("📋 Parsed token:");
      console.log("   ID:", token.id);
      console.log("   Type:", token.type?.toString?.() || "unknown");
      console.log("   State:", token.state);
      console.log("   Genesis:", token.genesis);
      console.log("   Transactions:", token.transactions?.length || 0);
      if (token.transactions?.length > 0) {
        token.transactions.forEach((tx: unknown, i: number) => {
          console.log(`   TX[${i}]:`, tx);
        });
      }
      return { nametagData, token };
    } catch (err) {
      console.error("❌ Failed to parse token:", err);
      return { nametagData, parseError: err };
    }
  };
  window.devInspectIpfs = devInspectIpfs;
  console.log("🛠️ Dev tools registered. Type devHelp() for available commands.");
}
