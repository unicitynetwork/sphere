/**
 * Unicity ID Validator
 *
 * Validates that a user's Unicity ID (nametag) is properly configured:
 * 1. Nametag token exists and is valid
 * 2. Nametag is published to Nostr relay
 * 3. The Nostr pubkey for the nametag matches the wallet's identity
 *
 * IMPORTANT - Key relationship:
 * - L3 pubkey (33 bytes compressed ECDSA): 02/03 prefix + 32 bytes x-coordinate
 * - Nostr pubkey (32 bytes x-only Schnorr): derived using BIP-340 Schnorr
 *
 * WARNING: You CANNOT simply strip the prefix from L3 pubkey to get Nostr pubkey!
 * BIP-340 Schnorr negates the private key if y-coordinate is odd, which produces
 * a DIFFERENT x-coordinate. The correct approach is to derive the Nostr pubkey
 * from the private key using the Nostr SDK's Schnorr implementation.
 */

import { IdentityManager, type UserIdentity } from "../components/wallet/L3/services/IdentityManager";
import { NostrService } from "../components/wallet/L3/services/NostrService";
import { NostrKeyManager } from "@unicitylabs/nostr-js-sdk";
import { IpfsStorageService, SyncPriority } from "../components/wallet/L3/services/IpfsStorageService";
import { WalletRepository } from "../repositories/WalletRepository";
import type { NametagData } from "../repositories/WalletRepository";
import type { InvalidatedNametagEntry } from "../components/wallet/L3/services/types/TxfTypes";

export interface UnicityIdValidationResult {
  isValid: boolean;
  identity: {
    l3Pubkey: string;
    expectedNostrPubkey: string;
    directAddress: string;
  } | null;
  nametag: {
    name: string;
    hasToken: boolean;
    tokenRecipient: string | null;
  } | null;
  nostrBinding: {
    resolvedPubkey: string | null;
    matchesIdentity: boolean;
  } | null;
  errors: string[];
  warnings: string[];
}

/**
 * Derive Nostr pubkey from L3 identity's private key
 *
 * IMPORTANT: This uses the Nostr SDK's Schnorr implementation which follows BIP-340.
 * BIP-340 may negate the private key if the y-coordinate is odd, producing a different
 * x-coordinate than the ECDSA public key. This is why we MUST derive from the private
 * key rather than trying to convert the L3 public key.
 *
 * @param identity - The L3 identity containing the private key
 * @returns The 32-byte Nostr pubkey as hex string (64 chars)
 */
export function deriveNostrPubkeyFromIdentity(identity: UserIdentity): string {
  const secretKey = Buffer.from(identity.privateKey, "hex");
  const keyManager = NostrKeyManager.fromPrivateKey(secretKey);
  return keyManager.getPublicKeyHex();
}

/**
 * @deprecated Use deriveNostrPubkeyFromIdentity instead.
 * This function is BROKEN because it assumes stripping the ECDSA prefix gives
 * the Schnorr pubkey, which is only true ~50% of the time due to BIP-340 key negation.
 */
export function l3PubkeyToNostrPubkey(l3Pubkey: string): string {
  console.warn("DEPRECATED: l3PubkeyToNostrPubkey is broken. Use deriveNostrPubkeyFromIdentity instead.");
  // L3 pubkey should be 66 hex chars (33 bytes)
  if (l3Pubkey.length !== 66) {
    throw new Error(`Invalid L3 pubkey length: ${l3Pubkey.length}, expected 66`);
  }

  // First byte (02 or 03) indicates y-coordinate parity
  const prefix = l3Pubkey.substring(0, 2);
  if (prefix !== "02" && prefix !== "03") {
    throw new Error(`Invalid L3 pubkey prefix: ${prefix}, expected 02 or 03`);
  }

  // Return the x-coordinate (32 bytes = 64 hex chars)
  // WARNING: This is NOT correct for Nostr! BIP-340 may negate the key!
  return l3Pubkey.substring(2);
}

/**
 * Validate a user's Unicity ID (nametag) configuration
 *
 * Checks:
 * 1. Identity exists and can be loaded
 * 2. Nametag token exists locally
 * 3. Nametag is published to Nostr relay
 * 4. The Nostr pubkey matches the wallet's expected pubkey
 */
export async function validateUnicityId(): Promise<UnicityIdValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result: UnicityIdValidationResult = {
    isValid: false,
    identity: null,
    nametag: null,
    nostrBinding: null,
    errors,
    warnings,
  };

  // Step 1: Get identity
  let identity: UserIdentity | null = null;
  let expectedNostrPubkey: string = "";

  try {
    const identityManager = IdentityManager.getInstance();
    identity = await identityManager.getCurrentIdentity();

    if (!identity) {
      errors.push("No identity found - wallet not initialized");
      return result;
    }

    // Derive Nostr pubkey using Schnorr (BIP-340) - must use private key, not convert from L3 pubkey
    expectedNostrPubkey = deriveNostrPubkeyFromIdentity(identity);

    result.identity = {
      l3Pubkey: identity.publicKey,
      expectedNostrPubkey,
      directAddress: identity.address,
    };

    console.log("✅ Identity loaded");
    console.log(`   L3 pubkey: ${identity.publicKey.substring(0, 20)}...`);
    console.log(`   Nostr pubkey (Schnorr): ${expectedNostrPubkey.substring(0, 20)}...`);
    console.log(`   Address: ${identity.address.substring(0, 40)}...`);
  } catch (err) {
    errors.push(`Failed to load identity: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // Step 2: Check local nametag token
  let nametagData: NametagData | null = null;
  let nametagName: string | null = null;

  try {
    const walletRepo = WalletRepository.getInstance();
    nametagData = walletRepo.getNametag();

    if (!nametagData) {
      errors.push("No nametag registered locally");
      result.nametag = { name: "", hasToken: false, tokenRecipient: null };
    } else {
      nametagName = nametagData.name;
      const hasToken = !!nametagData.token;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = nametagData.token as any;
      const tokenRecipient = token?.genesis?.data?.recipient || null;

      result.nametag = {
        name: nametagName,
        hasToken,
        tokenRecipient,
      };

      console.log(`✅ Local nametag: "${nametagName}"`);
      console.log(`   Has token: ${hasToken}`);
      if (tokenRecipient) {
        console.log(`   Token recipient: ${tokenRecipient.substring(0, 40)}...`);
      }

      // Verify token recipient matches our address
      if (tokenRecipient && tokenRecipient !== identity.address) {
        warnings.push(
          `Nametag token recipient (${tokenRecipient.substring(0, 30)}...) ` +
            `doesn't match current address (${identity.address.substring(0, 30)}...)`
        );
      }
    }
  } catch (err) {
    errors.push(`Failed to load nametag: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 3: Check Nostr binding
  if (nametagName) {
    try {
      const nostrService = NostrService.getInstance();
      const resolvedPubkey = await nostrService.queryPubkeyByNametag(nametagName);

      result.nostrBinding = {
        resolvedPubkey,
        matchesIdentity: resolvedPubkey === expectedNostrPubkey,
      };

      if (!resolvedPubkey) {
        errors.push(`Nametag "${nametagName}" is not published to Nostr relay`);
        console.log(`❌ Nametag "${nametagName}" not found on Nostr relay`);
      } else if (resolvedPubkey === expectedNostrPubkey) {
        console.log(`✅ Nostr binding verified: "${nametagName}" -> ${resolvedPubkey.substring(0, 16)}...`);
      } else {
        errors.push(
          `Nametag "${nametagName}" is owned by different pubkey!\n` +
            `   Expected: ${expectedNostrPubkey.substring(0, 20)}...\n` +
            `   Actual:   ${resolvedPubkey.substring(0, 20)}...`
        );
        console.log(`❌ Nostr pubkey mismatch for "${nametagName}":`);
        console.log(`   Expected: ${expectedNostrPubkey}`);
        console.log(`   Actual:   ${resolvedPubkey}`);
      }
    } catch (err) {
      warnings.push(`Failed to query Nostr relay: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`⚠️ Could not verify Nostr binding: ${err}`);
    }
  }

  // Determine overall validity
  result.isValid = errors.length === 0;

  // Summary
  console.log("\n=== Unicity ID Validation Summary ===");
  console.log(`Valid: ${result.isValid ? "✅ YES" : "❌ NO"}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((e) => console.log(`  ❌ ${e}`));
  }
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    warnings.forEach((w) => console.log(`  ⚠️ ${w}`));
  }

  return result;
}

/**
 * Fix a broken Unicity ID by re-publishing the nametag binding to Nostr
 *
 * This will only work if:
 * 1. The nametag is not already owned by someone else
 * 2. We have a valid nametag token
 *
 * @returns true if successful, false otherwise
 */
export async function repairUnicityId(): Promise<boolean> {
  console.log("\n=== Attempting to Repair Unicity ID ===\n");

  const validation = await validateUnicityId();

  if (validation.isValid) {
    console.log("✅ Unicity ID is already valid, no repair needed");
    return true;
  }

  if (!validation.identity) {
    console.log("❌ Cannot repair: No identity found");
    return false;
  }

  if (!validation.nametag?.name) {
    console.log("❌ Cannot repair: No nametag registered");
    return false;
  }

  const nametagName = validation.nametag.name;

  // Check if nametag is owned by someone else
  if (
    validation.nostrBinding?.resolvedPubkey &&
    validation.nostrBinding.resolvedPubkey !== validation.identity.expectedNostrPubkey
  ) {
    console.log(`❌ Cannot repair: Nametag "${nametagName}" is owned by another pubkey`);
    console.log(`   Owner: ${validation.nostrBinding.resolvedPubkey}`);
    console.log(`   You need to choose a different nametag`);
    return false;
  }

  // Try to publish/re-publish the nametag
  try {
    const nostrService = NostrService.getInstance();
    const success = await nostrService.publishNametagBinding(nametagName, validation.identity.directAddress);

    if (success) {
      // Wait for propagation
      console.log("Waiting for Nostr propagation...");
      await new Promise((r) => setTimeout(r, 2000));

      // Verify
      const verifyResult = await validateUnicityId();
      if (verifyResult.isValid) {
        console.log(`✅ Repair successful! Nametag "${nametagName}" is now valid`);
        return true;
      } else {
        console.log("⚠️ Publish succeeded but verification failed");
        console.log("   The nametag may be owned by someone else");
        return false;
      }
    } else {
      console.log("❌ Failed to publish nametag binding");
      return false;
    }
  } catch (err) {
    console.log(`❌ Repair failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Invalidate the current Unicity ID by:
 * 1. Moving the nametag to invalidatedNametags array (preserves history)
 * 2. Clearing the current nametag
 *
 * This triggers the wallet to show CreateWalletFlow for new nametag registration.
 * Invalidation is one-way - once invalidated, user must create a new nametag.
 *
 * @param reason - Explanation of why the nametag was invalidated
 * @returns true if invalidation was successful, false if no nametag to invalidate
 */
export async function invalidateUnicityId(reason: string): Promise<boolean> {
  const walletRepo = WalletRepository.getInstance();
  const currentNametag = walletRepo.getNametag();

  if (!currentNametag) {
    console.log("No nametag to invalidate");
    return false;
  }

  const nametagName = currentNametag.name;

  // Create invalidated entry with full history
  const invalidatedEntry: InvalidatedNametagEntry = {
    name: currentNametag.name,
    token: currentNametag.token || {},
    timestamp: currentNametag.timestamp || Date.now(),
    format: currentNametag.format || "unknown",
    version: currentNametag.version || "unknown",
    invalidatedAt: Date.now(),
    invalidationReason: reason,
  };

  // Add to invalidated list (this also saves to localStorage)
  walletRepo.addInvalidatedNametag(invalidatedEntry);

  // Clear current nametag (this triggers CreateWalletFlow)
  walletRepo.clearNametag();

  console.log(`Invalidated Unicity ID "${nametagName}": ${reason}`);

  // Trigger wallet refresh so UI updates
  window.dispatchEvent(new Event("wallet-updated"));

  // CRITICAL: Sync to IPFS immediately to push the invalidation to remote
  // This prevents subsequent syncs from restoring the old nametag
  try {
    const identityManager = IdentityManager.getInstance();
    const ipfsService = IpfsStorageService.getInstance(identityManager);
    // Use HIGH priority so it runs immediately
    // Don't await - let it run in background to not block UI
    ipfsService.syncNow({
      forceIpnsPublish: true,
      priority: SyncPriority.HIGH,
      callerContext: 'unicity-id-invalidation',
    }).then(() => {
      console.log(`✅ IPFS sync completed after invalidating "${nametagName}"`);
    }).catch((err) => {
      console.warn(`⚠️ IPFS sync failed after invalidating "${nametagName}":`, err);
    });
  } catch (err) {
    console.warn(`⚠️ Could not trigger IPFS sync after invalidation:`, err);
  }

  return true;
}

/**
 * Check if a nametag is available (not owned by anyone)
 */
export async function isNametagAvailable(nametag: string): Promise<boolean> {
  try {
    const nostrService = NostrService.getInstance();
    const pubkey = await nostrService.queryPubkeyByNametag(nametag);
    return pubkey === null;
  } catch {
    // If query fails, assume unavailable to be safe
    return false;
  }
}

/**
 * Get the owner of a nametag
 */
export async function getNametagOwner(nametag: string): Promise<string | null> {
  try {
    const nostrService = NostrService.getInstance();
    return await nostrService.queryPubkeyByNametag(nametag);
  } catch {
    return null;
  }
}

// Export for dev tools
export const unicityIdValidator = {
  validate: validateUnicityId,
  repair: repairUnicityId,
  invalidate: invalidateUnicityId,
  isNametagAvailable,
  getNametagOwner,
  deriveNostrPubkeyFromIdentity,
  l3PubkeyToNostrPubkey, // deprecated - kept for backwards compatibility
};
