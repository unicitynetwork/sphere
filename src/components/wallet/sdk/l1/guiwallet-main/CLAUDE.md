# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Unicity WEB GUI Wallet is a self-contained, browser-based cryptocurrency wallet for the Unicity network. The entire application runs in a single HTML file (`index.html`, 12871 lines, 888KB) with embedded JavaScript and CSS, requiring no build process or external dependencies. It supports the Alpha cryptocurrency on the consensus layer (PoW blockchain) with architecture designed for future offchain layer integration.

## Key Architecture

### Single-File Design
- **index.html**: Complete wallet application (888KB) containing:
  - Embedded CryptoJS library for AES, PBKDF2, SHA-512
  - Embedded elliptic.js for secp256k1 curve operations
  - BIP32/BIP44 HD wallet implementation
  - Bech32 encoding for SegWit addresses
  - QR code generation library
  - Fulcrum WebSocket integration
  - Complete UI with tabbed interface
  - All crypto operations run client-side in browser

### Cryptographic Stack
- **Key Generation**: Web Crypto API → 32 bytes entropy → secp256k1 keypair
- **HD Derivation**: BIP44 path `m/44'/0'/{index}'` using HMAC-SHA512
- **Address Format**: P2WPKH (SegWit) with `alpha1` Bech32 prefix
- **Wallet Encryption**: AES-256 with PBKDF2 (100,000 iterations)

### Operating Modes
1. **Full Wallet**: Private key control for sending/receiving
2. **Watch-Only**: Monitor addresses without private keys
3. **Online**: Connected to Fulcrum for real-time blockchain data
4. **Offline**: Create/sign transactions without network

## Core Functions

### Wallet Management
- `initializeWallet()`: Generate master key from secure entropy (line ~1980)
- `generateNewAddress()`: Derive child keys via BIP32
- `restoreFromWalletDat(file)`: Import Alpha wallet.dat (SQLite) (line ~3083)
  - Auto-detects: descriptor wallets, legacy HD, legacy non-HD, encrypted wallets
  - Extracts DER-encoded private keys from SQLite binary format
  - Searches for patterns: `walletdescriptorkey`, `hdchain`, `mkey` (encryption), `ckey` (encrypted keys)
  - Triggers address scanning for BIP32 wallets (up to 100 addresses)
- `decryptAndImportWallet()`: Decrypt encrypted wallet.dat files (line ~3450)
  - Prompts for password when encrypted wallet detected
  - Uses SHA-512 key derivation (Bitcoin Core compatible)
  - Decrypts master key with AES-256-CBC
  - Extracts chain code from wallet descriptors
  - Derives BIP32 addresses from decrypted master key
- Multi-wallet support: Switch between multiple wallets stored in localStorage/IndexedDB

### Transaction Handling
- `createTransaction()`: Build with UTXO selection
- `signTransaction()`: Offline signing capability
- `broadcastTransaction()`: Submit via Fulcrum
- `updateTransactionHistory()`: Paginated display (20/page)
- `updateUtxoListDisplay()`: Paginated UTXOs (20/page)

### Fulcrum Integration
- `connectToElectrumServer()`: WebSocket connection
- `subscribeToAddressChanges()`: Real-time updates
- `refreshBalance()`: Fetch UTXOs and balance

## Development Commands

```bash
# Run the main wallet application
open index.html
# Or serve locally
python3 -m http.server 8000
# Navigate to http://localhost:8000/index.html

# Migrate wallet to Alpha Core node
./alpha-migrate.sh <private_key_wif> <wallet_name>

# Run debug service (for collecting debug reports from wallets)
cd debug-service
npm install
npm start        # Production mode on port 3487
npm run dev      # Development mode with auto-restart

# Test scripts for wallet.dat analysis (root directory, require Node.js + dependencies)
npm install      # Install dependencies: elliptic, sqlite3, bip32, etc.
node analyze_encrypted_wallet.js    # Analyze encrypted wallet structure
node test_wallet_decryption.js      # Test wallet decryption logic
node decrypt_wallet_standard.js     # Decrypt and extract keys
node compare_dat_files.js           # Compare multiple wallet files
node decrypt_and_derive.js          # Full decryption and address derivation
# See individual .js files for more analysis/testing utilities

# Create release
./create_release.sh    # Creates GitHub release with index.html
```

## Migration Script

The `alpha-migrate.sh` script imports wallet private keys to Alpha Core:
1. Creates/uses specified wallet
2. Imports key using `wpkh()` descriptor format
3. Verifies import and checks balance
4. Provides rescan instructions if needed

## Critical Implementation Details

1. **No Build Process**: Direct HTML file execution, no npm/webpack required
2. **Child Key Export**: Exports derived keys (not master key) for security
3. **Address Scanning**: Auto-scans up to 100 addresses for BIP32 wallets after import
4. **Wallet.dat Formats**: Supports descriptor (modern), legacy HD, legacy non-HD, and encrypted formats
5. **Encrypted Wallet Support**: Can decrypt and import encrypted wallet.dat files with `mkey` records
6. **Storage**: IndexedDB primary, localStorage fallback for cross-tab persistence
7. **Multi-Wallet**: Supports multiple wallets with wallet switching functionality
8. **Auto-Hide**: Private keys hidden after 30 seconds for security
9. **Pagination**: 20 items per page for transactions/UTXOs
10. **Binary Parsing**: Direct SQLite binary parsing without SQL-js dependency

## Testing Focus Areas

- SegWit address generation (`alpha1` prefix)
- Wallet.dat import (descriptor, legacy, encrypted formats)
- BIP32 address scanning functionality (100 address limit)
- Encryption/decryption with various passwords
- Online/offline mode transitions
- QR code generation/scanning
- Migration script functionality
- Watch-only mode operations
- Pagination for large datasets
- Multi-wallet switching
- Binary SQLite parsing accuracy

## Debug Service

The `debug-service/` directory contains a standalone Node.js microservice for collecting and analyzing debug reports:
- **Purpose**: Collects debug reports from wallet instances for troubleshooting
- **API Endpoints**: Submit reports, list reports, extract/export transactions
- **Web Interface**: Browse reports at http://localhost:3487
- **Storage**: File-based storage organized by date in `reports/` directory
- **Security**: Rate limiting (100 req/15min), CORS protection, 10MB size limit

## Analysis Scripts

The repository includes Node.js utilities for wallet.dat analysis and testing in the root directory:
- **analyze_*.js**: Examine wallet structure, encryption, and key formats
  - `analyze_encrypted_wallet.js`: Detect mkey records and encryption metadata
  - `analyze_mkey_format.js`: Parse master key structure
- **decrypt_*.js**: Test decryption logic with various wallet types
  - `decrypt_wallet_standard.js`: Standard Bitcoin Core wallet decryption
  - `decrypt_and_derive.js`: Full decryption + BIP32 address derivation
  - `decrypt_enc_wallet2.js`, `decrypt_enc_wallet2_full.js`: Specific test cases
- **test_*.js**: Validate address derivation, BIP32 functionality
  - `test_bip32_steps.js`: Step-by-step BIP32 derivation testing
  - `test_wallet_decryption.js`: End-to-end decryption validation
- **compare_dat_files.js**: Compare multiple wallet.dat files side-by-side
- **find_*.js**: Search for specific keys or derivation paths (e.g., `find_derivation_path.js`)

These scripts require root-level `node_modules/` dependencies (elliptic, sqlite3, bip32, bs58check, tiny-secp256k1) and are used for debugging wallet import issues. They work with wallet.dat files placed in `ref_materials/` or specified paths.

## Reference Materials

The `ref_materials/` directory contains test wallet.dat files and reference data:
- Contains symbolic link to Alpha Core wallet directory for testing
- Houses encrypted wallet.dat files for testing decryption logic
- Test files referenced by analysis scripts (e.g., `enc_wallet2.dat`)

## Project Structure

```
/
├── index.html                    # Main wallet application (888KB single file)
├── alpha-migrate.sh             # Migration script to Alpha Core
├── create_release.sh            # GitHub release automation
├── package.json                 # Root dependencies for test scripts
├── *.js                         # Analysis/testing scripts (20+ files)
├── debug-service/               # Standalone debug report collector
│   ├── server.js               # Express server (port 3487)
│   ├── package.json            # Service dependencies
│   └── public/                 # Web interface
└── ref_materials/              # Test wallet.dat files
```

## Important Implementation Considerations

### Working with index.html
- **Single massive file**: All code, CSS, and libraries embedded in one 888KB HTML file
- **No build process**: Edit HTML directly, test by opening in browser
- **Embedded libraries**: CryptoJS, elliptic.js, and other crypto libraries are inline
- **Line numbers matter**: Functions referenced by approximate line numbers (may shift with edits)
- **Reading the file**: Use offset/limit parameters when using Read tool due to 12K+ lines

### Wallet.dat Binary Format
- **SQLite-based**: Uses direct binary parsing, not SQL-js
- **Multiple formats**: Descriptor (modern), legacy HD, legacy non-HD, encrypted (mkey)
- **DER encoding**: Private keys stored as DER-encoded values in binary
- **Pattern matching**: Search for byte patterns like `walletdescriptorkey`, `hdchain`, `mkey`, `ckey`
- **Chain code extraction**: Required for BIP32 derivation from wallet descriptors

### Encryption Implementation
- **Bitcoin Core compatible**: Uses SHA-512 for key derivation (not PBKDF2 like wallet.dat format)
- **AES-256-CBC**: Same encryption as Bitcoin Core for compatibility
- **Master key (mkey)**: Contains encrypted master key + derivation parameters
- **Encrypted keys (ckey)**: Individual key encryption with public key as identifier

### Testing Wallet Import
- Use test files in `ref_materials/` directory
- Alpha Core symlink points to actual blockchain wallet directory
- Test both encrypted and unencrypted wallet.dat files
- Verify address scanning produces expected `alpha1` addresses
- Test with various wallet ages (different descriptor versions)

## Future Offchain Layer Integration Points

When implementing offchain support:
1. Add layer selection UI
2. Implement state channel management
3. Add cross-layer transfer mechanisms
4. Update balance displays for both layers
5. Implement offchain transaction formats