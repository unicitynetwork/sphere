# Release Notes - v0.2.0

## Release Date: August 13, 2025

## Major Features

### 🎯 Full BIP32 HD Wallet Support
- Import BIP32 hierarchical deterministic wallets from wallet.dat files
- Automatic wallet scanning to discover addresses with balances
- Support for multiple derivation paths (up to 100 addresses by default)
- Visual [BIP32] indicator for BIP32 wallet addresses
- Preserve BIP32 wallet type through save/load cycles

### 🎨 New Tabbed Interface
- **Main Page Tabs:**
  - **Wallet Tab**: Core wallet operations (Create, Load, Save, Send, etc.)
  - **Cold Wallet Tools Tab**: UTXO management for offline transactions
- **Help Modal Tabs:**
  - **General Usage**: Overall wallet instructions
  - **Cold Wallet**: Comprehensive cold wallet guide

### 📚 Enhanced Cold Wallet Documentation
- Complete step-by-step cold wallet transaction guide
- Two transaction methods fully documented:
  - PATH 1: Transaction Template Method (recommended)
  - PATH 2: UTXO Export Method
- Security best practices and troubleshooting section
- Clear ONLINE/OFFLINE labeling for each step

### 🔧 Improved Wallet Detection
- Automatic detection of wallet type (WIF vs BIP32)
- Skip unnecessary address scanning for standard WIF wallets
- Smart UI adaptation based on wallet type:
  - WIF wallets: Direct load button
  - BIP32 wallets: Address scanning interface
  - Encrypted wallets: Decrypt workflow

## Bug Fixes
- Fixed "Cannot update cache: missing master key" error in watch-only mode
- Fixed "Cannot read properties of null" error in performLazyRescan
- Removed excessive transaction logging from console
- Fixed BIP32 wallet type preservation when saving/loading from text files
- Resolved duplicate element IDs causing Cold Wallet tab display issues

## Technical Improvements
- Updated terminology from "Alpha wallet" to "BIP32 wallet" for accuracy
- Improved regex patterns for wallet type detection
- Added safety checks to prevent null reference errors
- Optimized file change detection for better performance
- Relocated Import & Broadcast button to main wallet actions bar

## UI/UX Enhancements
- Reorganized interface with intuitive tab navigation
- Added [BIP32] indicator next to addresses from BIP32 wallets
- Improved button placement for better workflow
- Enhanced visual feedback for wallet operations
- Cleaner separation between wallet management and cold wallet tools

## Compatibility
- Supports both legacy and descriptor wallet.dat formats
- Backward compatible with existing wallet backups
- Works with encrypted and unencrypted wallet files
- Compatible with all modern browsers supporting Web Crypto API

## Known Limitations
- Only unencrypted wallet.dat files are supported for direct import
- To decrypt wallet.dat files, use: `alpha-cli walletpassphrase "yourpassword" 600`
- BIP32 wallet scanning limited to 100 addresses by default (configurable)

## Upgrade Instructions
1. No special steps required - simply use the new index.html
2. Existing wallets will continue to work without modification
3. To use new features, reload any BIP32 wallets to enable scanning

## Security Notes
- All cryptographic operations remain client-side
- Private keys never leave your browser
- No external dependencies or CDN requirements
- Complete offline capability maintained

---

For questions or issues, please visit: https://github.com/your-repo/issues