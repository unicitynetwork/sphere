/**
 * Developer Tools for AgentSphere
 *
 * This module provides utilities callable from the browser console for debugging
 * and development purposes. Only loaded in development mode.
 */

import { WalletRepository } from "../repositories/WalletRepository";
import { Token, TokenStatus } from "../components/wallet/L3/data/model";
import { ServiceProvider } from "../components/wallet/L3/services/ServiceProvider";
import { OutboxRepository } from "../repositories/OutboxRepository";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment";
import { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment";
import { MintTransactionData } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils";
import { RequestId } from "@unicitylabs/state-transition-sdk/lib/api/RequestId";
import type { TxfToken, TxfInclusionProof, TxfTransaction, TxfGenesis } from "../components/wallet/L3/services/types/TxfTypes";
import type { OutboxEntry } from "../components/wallet/L3/services/types/OutboxTypes";

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
  requestId?: string; // If we can derive it
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

    // Convert TxfGenesisData to IMintTransactionDataJson format
    // The formats are similar but coinData needs conversion
    const mintDataJson = {
      tokenId: data.tokenId,
      tokenType: data.tokenType,
      tokenData: data.tokenData || null,
      coinData: data.coinData && data.coinData.length > 0
        ? { coins: data.coinData.map(([id, amount]) => ({ coinId: id, amount })) }
        : null,
      recipient: data.recipient,
      salt: data.salt,
      recipientDataHash: data.recipientDataHash,
      reason: data.reason ? JSON.parse(data.reason) : null,
    };

    // Use SDK's fromJSON to properly reconstruct the MintTransactionData
    const mintTransactionData = await MintTransactionData.fromJSON(mintDataJson);

    // Create commitment from transaction data
    const commitment = await MintCommitment.create(mintTransactionData);
    return { commitment };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { commitment: null, error: msg };
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
      return await pollForProofNoVerify(commitment.requestId.toString(), timeoutMs);
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
      return await pollForProofNoVerify(commitment.requestId.toString(), timeoutMs);
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
        console.warn("⚠️ Returning inclusion proof WITHOUT verification (dev mode)");
        return response.inclusionProof.toJSON() as TxfInclusionProof;
      }

      // Proof not ready yet, keep polling
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
 * Extract state hashes, requestIds and strip proofs from a TxfToken
 * Returns the modified token and the list of proof requests to make
 */
function stripProofsAndCollectHashes(txf: TxfToken): {
  stripped: TxfToken;
  requests: ProofRequest[];
  hasUncommittedTransactions: boolean;
} {
  const requests: ProofRequest[] = [];
  const stripped = JSON.parse(JSON.stringify(txf)) as TxfToken;
  let hasUncommittedTransactions = false;

  // Handle genesis proof (check if genesis exists first - SDK Token format may differ)
  if (stripped.genesis && stripped.genesis.inclusionProof) {
    const proof = stripped.genesis.inclusionProof;
    const genesisStateHash = proof.authenticator.stateHash;
    // Try to extract requestId from the authenticator data
    // The requestId format is typically the stateHash itself or derived from it
    requests.push({
      type: "genesis",
      stateHash: genesisStateHash,
      requestId: genesisStateHash, // stateHash is the requestId for lookup
    });
    // We need to cast to unknown first since TxfGenesis expects inclusionProof to be non-null
    // But we'll restore it before returning
    (stripped.genesis as { inclusionProof: TxfInclusionProof | null }).inclusionProof = null;
  }

  // Handle transaction proofs
  if (stripped.transactions && stripped.transactions.length > 0) {
    for (let i = 0; i < stripped.transactions.length; i++) {
      const tx = stripped.transactions[i];
      if (tx.inclusionProof) {
        // Has existing proof - we can refresh it
        const stateHash = tx.inclusionProof.authenticator.stateHash;
        requests.push({
          type: "transaction",
          index: i,
          stateHash: stateHash,
          requestId: stateHash, // Use stateHash as requestId for lookup
        });
        stripped.transactions[i] = {
          ...tx,
          inclusionProof: null,
        };
      } else {
        // Transaction without proof - commitment may not have been submitted
        hasUncommittedTransactions = true;
        requests.push({
          type: "transaction",
          index: i,
          stateHash: tx.newStateHash,
          // No requestId - will need outbox recovery
        });
      }
    }
  }

  return { stripped, requests, hasUncommittedTransactions };
}

/**
 * Re-fetch all unicity proofs for all tokens in the wallet
 *
 * This function:
 * 1. Scans all loaded L3 tokens
 * 2. For tokens with existing proofs: re-fetches fresh proofs from the aggregator
 * 3. For tokens with uncommitted transactions: attempts recovery via OutboxEntry
 *    - Submits commitment if not already submitted (handles REQUEST_ID_EXISTS)
 *    - Waits for inclusion proof
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
  console.log(`📡 Aggregator: ${ServiceProvider.getAggregatorUrl()}`);
  console.log(`🔐 Trust base verification: ${ServiceProvider.isTrustBaseVerificationSkipped() ? "SKIPPED" : "enabled"}`);

  const repo = WalletRepository.getInstance();
  const tokens = repo.getTokens();
  const nametag = repo.getNametag();

  // Include nametag token if present
  const hasNametag = !!(nametag?.token);

  const totalToProcess = tokens.length + (hasNametag ? 1 : 0);
  console.log(`📦 Found ${tokens.length} tokens${hasNametag ? ` + 1 nametag ("${nametag?.name}")` : ""} to process`);

  if (totalToProcess === 0) {
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

  // Process nametag first if present
  if (hasNametag && nametag?.token) {
    console.group(`🏷️ Nametag "${nametag.name}"`);

    // Debug: log the raw nametag data from storage
    console.log(`   Raw nametag from storage:`, {
      name: nametag.name,
      tokenType: typeof nametag.token,
      tokenIsNull: nametag.token === null,
      tokenIsUndefined: nametag.token === undefined,
      format: nametag.format,
      version: nametag.version,
    });

    // The token is already an object from storage (NametagData.token is typed as object)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nametagTxf = nametag.token as any;

    // Debug: log structure to help diagnose format differences
    const keys = Object.keys(nametagTxf);
    console.log(`   Token structure keys (${keys.length}): ${keys.join(", ") || "(empty)"}`);

    if (keys.length === 0) {
      console.error("   ❌ Nametag token is empty - may need to re-mint");
      console.log("   Raw token value:", nametag.token);
      errors.push({ tokenId: `nametag:${nametag.name}`, error: "Token data is empty" });
      failed++;
      console.groupEnd();
    } else if (!nametagTxf.genesis) {
      console.error("   ❌ Nametag token has no 'genesis' property");
      console.log("   Full structure:", JSON.stringify(nametagTxf, null, 2).slice(0, 1000));
      errors.push({ tokenId: `nametag:${nametag.name}`, error: "Invalid token structure - no genesis" });
      failed++;
      console.groupEnd();
    } else {
      // We have a valid nametag token with genesis
      const genesis = nametagTxf.genesis;
      console.log(`   Genesis keys: ${Object.keys(genesis).join(", ")}`);

      // Get the inclusion proof from genesis (SDK format: genesis.inclusionProof)
      const genesisProof = genesis.inclusionProof;
      if (!genesisProof) {
        console.warn("   ⚠️ Genesis has no inclusionProof - may already be stripped or never had one");
      }

      // Try to refresh the proof
      let proof: TxfInclusionProof | null = null;

      // For nametag proofs, we MUST reconstruct the MintCommitment to get the correct requestId
      // (The stateHash in the authenticator is NOT the same as the requestId!)
      const genesisData = genesis.data;
      if (genesisData && genesisData.salt) {
        try {
          // Create a TxfGenesis-like structure for reconstruction
          const txfGenesis = {
            data: genesisData,
            inclusionProof: genesisProof,
          } as TxfGenesis;

          console.log(`   genesis: Reconstructing mint commitment to get correct requestId...`);
          const result = await reconstructMintCommitment(txfGenesis);
          if (result.commitment) {
            // Use toJSON() to get the hex string format that RequestId.fromJSON() expects
            const correctRequestId = result.commitment.requestId.toJSON();
            console.log(`   genesis: Correct requestId (hex): ${correctRequestId.slice(0, 20)}...`);

            // Try to fetch existing proof first
            console.log(`   genesis: Fetching proof by requestId...`);
            proof = await fetchProofByRequestId(correctRequestId);

            if (proof) {
              console.log(`   ✅ genesis: Proof fetched successfully`);
            } else {
              // Proof not found - try to resubmit commitment (tree reset scenario)
              console.log(`   genesis: Proof not found - resubmitting commitment...`);
              const submitResult = await submitMintCommitmentToAggregator(result.commitment);
              console.log(`   genesis: Submission result: ${submitResult.status}`);
              if (submitResult.success) {
                proof = await waitForMintProofWithSDK(result.commitment, 60000);
                if (proof) {
                  console.log(`   ✅ genesis: Mint commitment resubmitted successfully`);
                } else {
                  console.warn(`   ⚠️ genesis: Timeout waiting for proof after resubmission`);
                }
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

      if (proof) {
        // Update the token with the new proof
        nametagTxf.genesis.inclusionProof = proof;
        const updatedNametag = {
          ...nametag,
          token: nametagTxf,
        };
        repo.setNametag(updatedNametag);
        succeeded++;
        console.log(`✅ Nametag proof refreshed`);
      } else {
        // Check if original proof is still valid - if so, that's OK
        const originalProof = nametagTxf.genesis?.inclusionProof;
        if (originalProof?.authenticator) {
          console.log(`ℹ️ Keeping original proof (new proof from aggregator incomplete)`);
          console.log(`💡 The dev aggregator may not return complete proofs - your original token is still valid`);
          succeeded++;
        } else {
          failed++;
          errors.push({ tokenId: `nametag:${nametag.name}`, error: "Failed to refresh genesis proof - aggregator returns incomplete proofs" });
        }
      }
    }
    console.groupEnd();
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
    const { stripped, requests, hasUncommittedTransactions } = stripProofsAndCollectHashes(txf);

    if (requests.length === 0) {
      console.log("ℹ️ No proofs to refresh (token has no proofs)");
      succeeded++;
      console.groupEnd();
      continue;
    }

    console.log(`🔍 Processing ${requests.length} proof request(s)...`);
    if (hasUncommittedTransactions) {
      console.log(`⚠️ Token has uncommitted transactions - will attempt outbox recovery`);
    }

    // Process each proof request
    let allProofsSucceeded = true;
    const proofErrors: string[] = [];

    for (const req of requests) {
      const { type, index, requestId } = req;
      const label = `${type}${index !== undefined ? ` #${index}` : ""}`;

      let proof: TxfInclusionProof | null = null;

      // Strategy 1: If we have a requestId, try direct fetch
      if (requestId) {
        console.log(`   ${label}: Fetching proof by requestId...`);
        proof = await fetchProofByRequestId(requestId);

        if (proof) {
          console.log(`   ✅ ${label}: Proof fetched successfully`);
        }
      }

      // Strategy 2: Proof not found but requestId exists - tree reset scenario
      // Try to resubmit the commitment and get a new proof
      if (!proof && requestId) {
        console.log(`   ${label}: Proof not found - attempting commitment resubmission (tree reset)...`);

        if (type === "genesis") {
          // Genesis: reconstruct MintCommitment from TxfGenesisData
          const result = await reconstructMintCommitment(stripped.genesis);
          if (result.commitment) {
            const submitResult = await submitMintCommitmentToAggregator(result.commitment);
            console.log(`   ${label}: Mint submission result: ${submitResult.status}`);
            if (submitResult.success) {
              proof = await waitForMintProofWithSDK(result.commitment, 60000);
              if (proof) {
                console.log(`   ✅ ${label}: Mint commitment resubmitted successfully`);
              } else {
                console.warn(`   ⚠️ ${label}: Timeout waiting for mint proof after resubmission`);
              }
            }
          } else {
            console.warn(`   ❌ ${label}: Cannot reconstruct mint: ${result.error}`);
          }
        } else {
          // Transfer: use OutboxEntry with forceResubmit=true for tree reset
          const recovery = await tryRecoverFromOutbox(token.id, true);
          if (recovery.recovered && recovery.proof) {
            proof = recovery.proof;
            console.log(`   ✅ ${label}: ${recovery.message}`);
          } else {
            console.warn(`   ⚠️ ${label}: ${recovery.message}`);
          }
        }
      }

      // Strategy 3: No requestId - uncommitted transaction, try regular outbox recovery
      if (!proof && !requestId) {
        console.log(`   ${label}: No requestId - attempting outbox recovery...`);
        const recovery = await tryRecoverFromOutbox(token.id);

        if (recovery.recovered && recovery.proof) {
          proof = recovery.proof;
          console.log(`   ✅ ${label}: ${recovery.message}`);
        } else {
          console.warn(`   ❌ ${label}: ${recovery.message}`);
        }
      }

      // Strategy 4: If still no proof, log detailed error with recovery tips
      if (!proof) {
        allProofsSucceeded = false;
        let errorMsg: string;
        if (type === "genesis") {
          errorMsg = `${label}: failed to refresh genesis proof - mint commitment reconstruction failed`;
        } else if (requestId) {
          errorMsg = `${label}: transfer proof not found - no OutboxEntry available (received token?)`;
          console.log(`   💡 If this is a received token, ask the sender to re-transfer`);
        } else {
          errorMsg = `${label}: uncommitted transaction - no outbox entry found for recovery`;
        }
        proofErrors.push(errorMsg);
        console.warn(`   ❌ ${errorMsg}`);
        continue;
      }

      // Re-attach the proof to the stripped token
      if (type === "genesis") {
        (stripped.genesis as { inclusionProof: TxfInclusionProof | null }).inclusionProof = proof;
      } else if (type === "transaction" && index !== undefined) {
        stripped.transactions[index] = {
          ...stripped.transactions[index],
          inclusionProof: proof,
        } as TxfTransaction;
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
  console.log(`\n✅ Complete: ${succeeded} succeeded, ${failed} failed (${duration}ms)`);
  if (failed > 0) {
    console.log(`\n💡 Tips for failed tokens:`);
    console.log(`   - If commitment wasn't submitted: check if OutboxEntry exists`);
    console.log(`   - If using different aggregator: commitment may not exist there`);
    console.log(`   - For uncommitted transfers: use OutboxRecoveryService`);
  }
  console.groupEnd();

  return {
    totalTokens: totalToProcess,
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
  console.log("    Example: devSetAggregatorUrl('/dev-rpc')  // Uses Vite proxy");
  console.log("    Proxied routes: /rpc (testnet), /dev-rpc (dev aggregator)");
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
