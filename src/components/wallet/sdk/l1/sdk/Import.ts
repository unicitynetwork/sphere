export async function restoreWallet() {
  const file = restoreFileInput.files[0];
  if (!file) {
    restoreStatus.className = "info-box error";
    restoreStatus.textContent = "Please select a wallet backup file.";
    restoreStatus.style.display = "block";
    return;
  }

  // Clear ALL previous wallet state before loading new wallet
  console.log("Clearing previous wallet state...");
  currentUtxos = [];
  currentTransactions = [];
  currentTransactionPage = 1;
  currentUtxoPage = 1;
  offlineUtxoData = null;

  // Clear UI displays
  if (walletBalance) walletBalance.textContent = "0.00000000 ALPHA";
  if (walletUnconfirmed) walletUnconfirmed.textContent = "";
  const transactionHistoryList = document.getElementById(
    "transactionHistoryList"
  );
  if (transactionHistoryList)
    transactionHistoryList.innerHTML =
      '<div style="text-align: center; color: #666; padding: 20px;">Loading wallet...</div>';
  const currentUtxoList = document.getElementById("currentUtxoList");
  if (currentUtxoList)
    currentUtxoList.innerHTML =
      '<div style="text-align: center; color: #666; padding: 20px;">Loading wallet...</div>';

  // Clear any existing scan cache when loading a new wallet
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      (key.startsWith("walletScan_") ||
        key.startsWith("walletScanCache_") ||
        key === "lastScannedWalletData" ||
        key === "lastLazyScanTime")
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
    console.log("Cleared cached scan data on wallet load:", key);
  });

  // Clear in-memory scan data and stop any ongoing rescans
  lastScannedWalletData = null;
  scannedWallets = [];

  // Clear any existing rescan interval
  if (lazyScanInterval) {
    clearInterval(lazyScanInterval);
    lazyScanInterval = null;
  }

  try {
    // Check if this is a wallet.dat file (SQLite)
    if (file.name.endsWith(".dat")) {
      await restoreFromWalletDat(file);
      return;
    }

    // Otherwise, read as text file (original backup format)
    const fileContent = await file.text();

    // Parse the master key from the file
    let masterKey = "";
    let isEncrypted = false;
    let encryptedMasterKey = "";

    // Check if this is an encrypted wallet
    if (fileContent.includes("ENCRYPTED MASTER KEY")) {
      isEncrypted = true;
      console.log("Loading encrypted wallet...");

      // Extract the encrypted master key
      const encryptedKeyMatch = fileContent.match(
        /ENCRYPTED MASTER KEY \(password protected\):\s*([^\n]+)/
      );
      if (encryptedKeyMatch && encryptedKeyMatch[1]) {
        encryptedMasterKey = encryptedKeyMatch[1].trim();
        console.log("Found encrypted master key");

        // Get the decryption password
        const password = restorePasswordInput.value;
        if (!password) {
          restoreStatus.className = "info-box error";
          restoreStatus.textContent =
            "This is an encrypted wallet. Please enter the decryption password.";
          restoreStatus.style.display = "block";
          return;
        }

        // Decrypt the master key
        try {
          console.log("Attempting to decrypt with provided password...");
          const salt = "alpha_wallet_salt";
          const passwordKey = CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: 100000,
          }).toString();

          // Try to decrypt
          const decryptedBytes = CryptoJS.AES.decrypt(
            encryptedMasterKey,
            passwordKey
          );
          masterKey = decryptedBytes.toString(CryptoJS.enc.Utf8);

          if (!masterKey) {
            restoreStatus.className = "info-box error";
            restoreStatus.textContent =
              "Failed to decrypt the wallet. The password may be incorrect.";
            restoreStatus.style.display = "block";
            return;
          }
          console.log(
            "Successfully decrypted master key:",
            masterKey.substring(0, 8) + "..."
          );
        } catch (e) {
          restoreStatus.className = "info-box error";
          restoreStatus.textContent = "Error decrypting wallet: " + e.message;
          restoreStatus.style.display = "block";
          return;
        }
      } else {
        restoreStatus.className = "info-box error";
        restoreStatus.textContent =
          "Could not find the encrypted master key in the backup file.";
        restoreStatus.style.display = "block";
        return;
      }
    } else {
      // Unencrypted wallet, extract the master key directly
      const masterKeyMatch = fileContent.match(
        /MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/
      );
      if (masterKeyMatch && masterKeyMatch[1]) {
        masterKey = masterKeyMatch[1].trim();
      } else {
        restoreStatus.className = "info-box error";
        restoreStatus.textContent =
          "Could not find the master private key in the backup file.";
        restoreStatus.style.display = "block";
        return;
      }
    }

    // Check if this is an Alpha descriptor wallet with chain code
    let masterChainCode = null;
    let isImportedAlphaWallet = false;

    const chainCodeMatch = fileContent.match(
      /MASTER CHAIN CODE \(for (?:BIP32 HD|Alpha) wallet compatibility\):\s*([^\n]+)/
    );
    if (chainCodeMatch && chainCodeMatch[1]) {
      masterChainCode = chainCodeMatch[1].trim();
      isImportedAlphaWallet = true;
    }

    // Also check wallet type explicitly
    if (
      fileContent.includes(
        "WALLET TYPE: BIP32 hierarchical deterministic wallet"
      ) ||
      fileContent.includes("WALLET TYPE: Alpha descriptor wallet")
    ) {
      isImportedAlphaWallet = true;
    }

    // Parse addresses from the backup file
    let parsedAddresses = [];
    const addressSection = fileContent.match(
      /YOUR ADDRESSES:\s*\n([\s\S]*?)(?:\n\nGenerated on:|$)/
    );
    console.log("Address section found:", !!addressSection);
    if (addressSection && addressSection[1]) {
      const addressLines = addressSection[1].trim().split("\n");
      console.log("Address lines to parse:", addressLines);
      for (const line of addressLines) {
        // Parse lines like: "Address 1: alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d (Path: m/44'/0'/0')"
        // or: "Address 1: alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d (Path: undefined)"
        const addressMatch = line.match(
          /Address\s+(\d+):\s+(\w+)\s*\(Path:\s*([^)]*)\)/
        );
        if (addressMatch) {
          const index = parseInt(addressMatch[1]) - 1; // Convert to 0-based index
          const address = addressMatch[2];
          const path = addressMatch[3] === "undefined" ? null : addressMatch[3];
          const addressInfo = {
            index: index,
            address: address,
            path: path,
            createdAt: new Date().toISOString(),
          };
          console.log("Parsed address:", addressInfo);
          parsedAddresses.push(addressInfo);
        }
      }
    }
    console.log(
      "Total parsed addresses:",
      parsedAddresses.length,
      parsedAddresses
    );

    // Confirmation before overwriting
    if (wallet.masterPrivateKey) {
      const confirmOverwrite = confirm(
        "This will overwrite your existing wallet. Are you sure you want to proceed?"
      );
      if (!confirmOverwrite) {
        return;
      }
    }

    // Create a new wallet with the restored master key
    wallet = {
      masterPrivateKey: masterKey,
      addresses: parsedAddresses, // Use parsed addresses instead of empty array
      isEncrypted: isEncrypted,
      encryptedMasterKey: encryptedMasterKey,
      childPrivateKey: null, // Will be set when generating first address or recovered
      isImportedAlphaWallet: isImportedAlphaWallet,
      masterChainCode: masterChainCode,
    };

    // Update global reference
    window.walletGlobal = wallet;

    // Update UI for both key displays
    // masterKeyElement.textContent = masterKey; // Removed with Security section
    // masterKeyElement.classList.add('masked'); // Removed with Security section

    // Convert and display WIF key
    const wifKey = hexToWIF(masterKey);
    // const wifKeyElement = document.getElementById('wifMasterKey'); // Removed with Security section
    // wifKeyElement.textContent = wifKey; // Removed with Security section
    // wifKeyElement.classList.add('masked'); // Removed with Security section

    // Enable buttons
    updateButtonStates(true);

    // Update encryption UI
    if (isEncrypted) {
      // encryptionStatus.style.display = 'block'; // Removed with Security section
      // Hide password strength indicator when wallet is encrypted
      passwordStrength.innerHTML = "";
    } else {
      // encryptionStatus.style.display = 'none'; // Removed with Security section
    }

    // Generate addresses properly
    if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
      // For BIP32 wallets, ALWAYS regenerate addresses from master key
      // Don't trust the addresses in the file - derive them properly
      wallet.addresses = []; // Clear any loaded addresses
      generateNewAddress(); // This will use BIP32 derivation
    } else if (wallet.addresses.length === 0) {
      // For standard wallets with no addresses, generate one
      generateNewAddress();
    } else {
      // For standard wallets with addresses, recover and verify them
      console.log(
        "Recovering standard wallet with parsed addresses:",
        wallet.addresses
      );
      console.log("Master private key available:", !!wallet.masterPrivateKey);
      console.log("Is encrypted:", wallet.isEncrypted);

      // Keep only the first address for standard wallets
      if (wallet.addresses.length > 1) {
        wallet.addresses = [wallet.addresses[0]];
      }

      // Recover childPrivateKey for the first address
      const addressIndex = wallet.addresses[0].index || 0;
      const derivationPath = `m/44'/0'/${addressIndex}'`;

      console.log("Attempting to derive child key for path:", derivationPath);
      console.log(
        "Master key (first 8 chars):",
        wallet.masterPrivateKey
          ? wallet.masterPrivateKey.substring(0, 8) + "..."
          : "null"
      );

      // Derive child key using HMAC (standard wallet method)
      const hmacInput = CryptoJS.enc.Hex.parse(wallet.masterPrivateKey);
      const hmacKey = CryptoJS.enc.Utf8.parse(derivationPath);
      const hmacOutput = CryptoJS.HmacSHA512(hmacInput, hmacKey).toString();
      const childPrivateKey = hmacOutput.substring(0, 64);

      console.log(
        "Derived child private key (first 8 chars):",
        childPrivateKey.substring(0, 8) + "..."
      );

      // Generate address from the derived key to verify
      const ec = new elliptic.ec("secp256k1");
      const keyPair = ec.keyFromPrivate(childPrivateKey);
      const publicKey = keyPair.getPublic(true, "hex");

      // Calculate address
      const sha256Hash = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
      const ripemd160Hash = CryptoJS.RIPEMD160(sha256Hash);
      const programData = ripemd160Hash.toString();
      const witnessVersion = 0;
      const derivedAddress = createBech32(
        "alpha",
        witnessVersion,
        hexToBytes(programData)
      );

      // Verify the address matches
      if (derivedAddress === wallet.addresses[0].address) {
        console.log(
          "✓ Address verification successful! Recovered childPrivateKey correctly."
        );
        console.log("  Address:", wallet.addresses[0].address);
        console.log("  Path:", derivationPath);
        console.log(
          "  Child Private Key (first 8 chars):",
          childPrivateKey.substring(0, 8) + "..."
        );
        wallet.childPrivateKey = childPrivateKey;
        wallet.addresses[0].publicKey = publicKey;
        wallet.addresses[0].path = derivationPath;

        // Show success message
        restoreStatus.className = "info-box success";
        restoreStatus.textContent =
          "Wallet restored successfully. Address verified and private key recovered.";
        restoreStatus.style.display = "block";
      } else {
        console.error("✗ Address verification failed!");
        console.error("Expected:", wallet.addresses[0].address);
        console.error("Derived:", derivedAddress);

        // Try to recover by scanning for the correct index
        let recovered = false;
        for (let i = 0; i < 100; i++) {
          const testPath = `m/44'/0'/${i}'`;
          const testHmac = CryptoJS.HmacSHA512(
            hmacInput,
            CryptoJS.enc.Utf8.parse(testPath)
          ).toString();
          const testChildKey = testHmac.substring(0, 64);
          const testKeyPair = ec.keyFromPrivate(testChildKey);
          const testPublicKey = testKeyPair.getPublic(true, "hex");
          const testSha256 = CryptoJS.SHA256(
            CryptoJS.enc.Hex.parse(testPublicKey)
          );
          const testRipemd = CryptoJS.RIPEMD160(testSha256);
          const testAddress = createBech32(
            "alpha",
            witnessVersion,
            hexToBytes(testRipemd.toString())
          );

          if (testAddress === wallet.addresses[0].address) {
            console.log(`✓ Found correct derivation at index ${i}!`);
            wallet.childPrivateKey = testChildKey;
            wallet.addresses[0].publicKey = testPublicKey;
            wallet.addresses[0].path = testPath;
            wallet.addresses[0].index = i;
            recovered = true;

            restoreStatus.className = "info-box success";
            restoreStatus.textContent = `Wallet recovered! Found correct key at index ${i}.`;
            restoreStatus.style.display = "block";
            break;
          }
        }

        if (!recovered) {
          restoreStatus.className = "info-box warning";
          restoreStatus.textContent =
            "Warning: Could not verify address. Wallet may not work correctly.";
          restoreStatus.style.display = "block";
          // Still set the childPrivateKey to avoid using master key
          wallet.childPrivateKey = childPrivateKey;
        }
      }

      console.log("About to call addAddressToUI with:", wallet.addresses[0]);
      addAddressToUI(wallet.addresses[0]);

      // Force wallet info section to be visible
      const walletInfoSection = document.getElementById("walletInfo");
      if (walletInfoSection) {
        walletInfoSection.style.display = "block";
        console.log("Forced walletInfo section to be visible");
      }

      // Update the wallet address directly as backup
      const walletAddressElement = document.getElementById("walletAddress");
      if (walletAddressElement && wallet.addresses[0]) {
        walletAddressElement.textContent = wallet.addresses[0].address;
        console.log(
          "Directly updated wallet address element to:",
          wallet.addresses[0].address
        );
      }
    }

    // Save the restored wallet
    saveWalletData();

    // Close the restore modal for non-BIP32 wallets
    if (!wallet.isImportedAlphaWallet) {
      // Standard wallet - close modal and show wallet UI immediately
      closeRestoreModal();

      // Show success notification
      if (isEncrypted) {
        showInAppNotification(
          "Encrypted Wallet Loaded",
          "Successfully decrypted and recovered wallet",
          "success"
        );
      } else {
        showInAppNotification(
          "Wallet Loaded",
          "Successfully loaded wallet",
          "success"
        );
      }
    }

    // If already connected to Fulcrum, refresh balance
    if (electrumConnected) {
      // Reset initial load flag when wallet is restored
      isInitialLoad = true;
      setTimeout(() => {
        refreshBalance();
        updateTransactionHistory();
        // Allow notifications after initial load
        setTimeout(() => {
          isInitialLoad = false;
        }, 2000);
      }, 500);
    }

    // Close any open sections to maintain a clean UI
    // document.getElementById('keys-section').style.display = 'none'; // Removed with Security section

    // Reset section button text
    // document.getElementById('showEncryptionBtn').innerHTML = ` // Removed with Security section
    /* <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Encrypt Wallet`; */

    // document.getElementById('showRestoreBtn').innerHTML = ` // Removed with Security section
    /* <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        Restore Wallet`; */

    // document.getElementById('showAdvancedBtn').innerHTML = ` // Removed with Security section
    /* <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        Migrate Wallet`; */

    // Show success message
    restoreStatus.className = "info-box success";
    restoreStatus.textContent = "Wallet restored successfully!";
    restoreStatus.style.display = "block";
    showInAppNotification(
      "Wallet Restored",
      "Your wallet has been successfully restored from backup",
      "success"
    );

    // Close modal after a delay
    setTimeout(() => {
      closeRestoreModal();
    }, 2000);
  } catch (e) {
    console.error("Error restoring wallet:", e);
    restoreStatus.className = "info-box error";
    restoreStatus.textContent = "Failed to restore wallet: " + e.message;
    restoreStatus.style.display = "block";
  }
}
