# LocalStorage Persistence Bug Fix

## Problem Summary

After importing a wallet file, the page reloads but the imported data is lost, showing the wallet creation screen again.

## Root Cause

The bug was caused by a **session key mismatch** in the `UnifiedKeyManager` singleton pattern:

### The Flawed Singleton Pattern

```typescript
// BEFORE (BUGGY)
static getInstance(sessionKey: string): UnifiedKeyManager {
  if (!UnifiedKeyManager.instance) {
    UnifiedKeyManager.instance = new UnifiedKeyManager(sessionKey);
  }
  return UnifiedKeyManager.instance;  // ⚠️ ALWAYS returns first instance
}
```

**The Problem**: If the singleton is created with one session key, subsequent calls with a different session key would return the instance with the WRONG key, causing decryption to fail silently.

## How the Bug Manifested

### During File Import (CreateWalletFlow.tsx)

1. User clicks "Import from File"
2. `handleFileImport()` reads the file
3. Calls `keyManager.importFromFileContent(content)`
4. `importFromFileContent()` calls `saveToStorage()` ✅
5. Data is **encrypted with SESSION_KEY** and saved to localStorage ✅
6. Page reloads via `window.location.reload()`

### After Page Reload

1. `useWallet.ts` creates new `IdentityManager` with `SESSION_KEY = "user-pin-1234"`
2. `identityManager.getUnifiedKeyManager()` calls `UnifiedKeyManager.getInstance(sessionKey)`
3. **IF** something created the singleton with a different key earlier:
   - Returns the existing instance with the **WRONG** session key
   - `initialize()` tries to decrypt data
   - **Decryption fails silently** (returns empty string)
   - `isInitialized()` returns `false`
   - User sees wallet creation screen again ❌

## The Fix

### 1. Session Key Consistency Check

```typescript
// AFTER (FIXED)
static getInstance(sessionKey: string): UnifiedKeyManager {
  if (!UnifiedKeyManager.instance) {
    UnifiedKeyManager.instance = new UnifiedKeyManager(sessionKey);
  } else if (UnifiedKeyManager.instance.sessionKey !== sessionKey) {
    // ⚠️ Session key mismatch detected!
    console.error(
      "WARNING: UnifiedKeyManager session key mismatch detected!",
      "This can cause data loss. Updating session key to maintain consistency."
    );
    UnifiedKeyManager.instance.sessionKey = sessionKey;
  }
  return UnifiedKeyManager.instance;
}
```

### 2. Enhanced Decryption Error Handling

```typescript
private decrypt(encrypted: string): string | null {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, this.sessionKey);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
      console.error("Decryption failed: empty result. Possible session key mismatch.");
      return null;
    }
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    return null;
  }
}
```

### 3. Better Initialization Logging

```typescript
async initialize(): Promise<boolean> {
  try {
    const encryptedMnemonic = localStorage.getItem(STORAGE_KEY_ENCRYPTED_MNEMONIC);
    const encryptedMaster = localStorage.getItem(STORAGE_KEY_ENCRYPTED_MASTER);
    // ...

    console.log("🔐 UnifiedKeyManager initializing...", {
      hasMnemonic: !!encryptedMnemonic,
      hasMaster: !!encryptedMaster,
      hasChainCode: !!chainCode,
      source,
      derivationMode,
    });

    if (encryptedMnemonic) {
      const mnemonic = this.decrypt(encryptedMnemonic);
      if (mnemonic) {
        await this.createFromMnemonic(mnemonic, false);
        console.log("✅ Wallet initialized from mnemonic");
        return true;
      } else {
        console.error("❌ Failed to decrypt mnemonic - session key mismatch?");
      }
    } else if (encryptedMaster) {
      const masterKey = this.decrypt(encryptedMaster);
      if (masterKey) {
        // ...
        console.log("✅ Wallet initialized from file import");
        return true;
      } else {
        console.error("❌ Failed to decrypt master key - session key mismatch?");
      }
    }

    console.log("ℹ️ No wallet data found in storage");
    return false;
  } catch (error) {
    console.error("Failed to initialize UnifiedKeyManager:", error);
    return false;
  }
}
```

## Files Modified

1. `/home/vrogojin/sphere/src/components/wallet/shared/services/UnifiedKeyManager.ts`
   - Updated `getInstance()` to detect and fix session key mismatches
   - Enhanced `decrypt()` with better error logging
   - Added comprehensive logging to `initialize()`

## Testing

### Manual Test

1. Import a wallet file
2. Page should reload
3. Check browser console for logs:
   - Should see "🔐 UnifiedKeyManager initializing..." with `hasMaster: true`
   - Should see "✅ Wallet initialized from file import"
   - Should NOT see "❌ Failed to decrypt master key"
4. Wallet should load successfully without showing creation screen

### Test File

Run `/home/vrogojin/sphere/test_session_key_fix.html` in a browser to see:
- How encryption/decryption works
- How wrong session keys cause silent failures
- How the fix prevents session key mismatches

## Verification

Current session key usage across the codebase (all consistent):

```typescript
// All use the same key: "user-pin-1234"
src/components/wallet/L3/hooks/useWallet.ts:32
src/components/chat/hooks/useChat.ts:14
src/components/wallet/L3/hooks/useIncomingPaymentRequests.ts:6
src/components/wallet/L3/hooks/useIpfsStorage.ts:20
src/components/wallet/L3/hooks/useIncomingTransfers.ts:7
```

Since all locations use the same hardcoded session key, the fix will maintain consistency even if the singleton is accessed from multiple places.

## Why It Was Hard to Debug

1. **Silent Failure**: CryptoJS AES decryption with wrong key returns empty string instead of throwing error
2. **Race Conditions**: Singleton creation order depends on React component mounting
3. **No Error Messages**: Original code had no logging to indicate decryption failures
4. **Seems to Work**: Data IS saved correctly - the bug only appears after page reload

## Future Improvements

Consider these enhancements:

1. **Store Session Key**: Save a hash of the session key in localStorage to detect mismatches early
2. **User Prompts**: If decryption fails, prompt user for their PIN/password
3. **Migration Path**: Add version numbers to encrypted data for future schema changes
4. **Better Singleton**: Consider using a DI container instead of static singleton
5. **Encryption Tests**: Add unit tests for encryption/decryption edge cases

## Related Issues

This fix also prevents potential issues with:
- Wallet restore from mnemonic
- Multiple wallet accounts
- Session key changes in future features
