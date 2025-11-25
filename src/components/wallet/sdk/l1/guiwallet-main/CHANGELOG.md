# Changelog

All notable changes to the Unicity WEB GUI Wallet will be documented in this file.

## [v0.3.0] - 2025-09-06

### Added
- **Comprehensive Debug System**
  - Transaction debug logging with automatic tracking of all operations
  - Debug Modal with Summary, Logs, Errors, and History tabs
  - One-click bug report submission to debug service
  - Failed transaction recovery and export functionality
  - Express.js microservice for collecting and analyzing reports
  - Privacy protection with automatic data sanitization

- **Enhanced Security Features**
  - Mandatory password verification for encrypted wallets
  - Proper password field masking for re-entry
  - Removed ability to skip verification
  - Critical error prevention for wallet encryption

- **Improved Wallet Management**
  - Automatic wallet type detection (BIP32 vs WIF) before decryption
  - Optimized loading for encrypted WIF wallets (no scanning)
  - Clear wallet type indicators in UI
  - Better user experience with informative messages

- **Documentation Updates**
  - New Debug & Bug Reporting tab in help modal
  - Comprehensive instructions for debug features
  - Privacy and security information
  - Troubleshooting guide for common issues

### Changed
- Version bumped to v0.3.0
- Password verification is now mandatory for encrypted wallets
- WIF wallets load directly without address scanning
- Improved error messages and user feedback

### Fixed
- Fixed Cold Wallet Tools tab not displaying (incorrect element ID)
- Fixed undefined updateAddressTable error for encrypted WIF wallets
- Fixed help modal cold wallet tab reference inconsistency
- Corrected tab switching logic for main and help modals

## [v0.2.0] - 2025-08-13

### Added
- **BIP32 HD Wallet Support**
  - Import BIP32 hierarchical deterministic wallets from wallet.dat files
  - Automatic wallet scanning to discover addresses with balances
  - Support for multiple derivation paths (up to 100 addresses)
  - Visual [BIP32] indicator for BIP32 wallet addresses
  - Preserve BIP32 wallet type through save/load cycles

- **Tabbed Interface**
  - Main page split into "Wallet" and "Cold Wallet Tools" tabs
  - Help modal split into "General Usage" and "Cold Wallet" tabs
  - Improved organization of wallet features

- **Enhanced Cold Wallet Documentation**
  - Comprehensive step-by-step cold wallet transaction guide
  - Two fully documented transaction methods
  - Security best practices and troubleshooting section

- **Smart Wallet Detection**
  - Automatic detection of wallet type (WIF vs BIP32)
  - Skip unnecessary scanning for standard WIF wallets
  - Adaptive UI based on wallet type

### Changed
- Updated terminology from "Alpha wallet" to "BIP32 wallet" for technical accuracy
- Moved Import & Broadcast button to main wallet actions bar
- Improved file change detection and error handling
- Enhanced wallet type detection regex patterns

### Fixed
- Fixed "Cannot update cache: missing master key" error in watch-only mode
- Fixed "Cannot read properties of null" error in performLazyRescan
- Removed excessive transaction logging from console
- Fixed BIP32 wallet type preservation when saving/loading
- Resolved duplicate element IDs causing Cold Wallet tab display issues

## [v0.1.2] - 2024-01-10

### Added
- **Transaction Broadcast Queue System**
  - Automatic queue management for reliable transaction delivery
  - Rate limiting: Up to 30 transactions per block
  - Visual progress indicator showing pending, broadcasting, complete, failed, and cancelled transactions
  - Queue persistence across page refreshes and connection drops
  - Automatic retry for failed transactions (up to 3 attempts)
  - UTXO consumption tracking to prevent double-spending
  - Clickable transaction counts for detailed information
  - Export functionality for failed/cancelled transactions
  - Individual and bulk actions for cancelled transactions (Resend, Save, Delete)
  - Auto-cleanup of completed transactions after 24 hours

- **Enhanced Transaction Display**
  - "From" address shown for all transactions in the transaction list
  - Multiple destination addresses displayed when no wallet is loaded
  - Complete transaction details preserved in exports
  - Improved address display in broadcast queue modals

- **User Interface Improvements**
  - "Max available" button between amount field and Send button for quick fee calculation
  - Version number display (v0.1.2) in top-right corner
  - Updated "How to use" modal with broadcast queue instructions
  - Limited popup notifications to maximum 3 visible at once
  - Removed redundant "New Block" and "Address Activity" notifications

- **File Import Enhancements**
  - Wallet restore accepts .txt and .dat files
  - Import & Broadcast Transactions accepts only .json files
  - Import UTXO Data accepts only .json files

### Changed
- Updated default Fulcrum endpoint from unicorn.unicity.network to fulcrum.unicity.network
- Transaction broadcast limit increased from 1 to 30 per block
- Improved error handling for connection issues

### Fixed
- Fixed encryptionStatus undefined error
- Fixed multiple variable initialization order issues
- Fixed modal close button syntax errors
- Fixed export notifications showing wrong messages for cancelled transactions
- Fixed import error handling for cancelled transactions
- Fixed missing favicon.ico 404 error
- Fixed ERR_CONNECTION_RESET issues

### Technical Details
- Implemented consumed UTXO tracking in transaction creation
- Added address field to UTXOs when fetching from Electrum
- Improved transaction amount calculations for proper recipient totals
- Enhanced queue state persistence with localStorage
- Better handling of block height changes for queue processing

## [v0.1.1] - 2024-01-10
- Minor bug fixes and improvements

## [v0.1.0] - 2024-01-10
- Initial release of Unicity WEB GUI Wallet
- Basic wallet functionality for Alpha cryptocurrency
- Support for SegWit addresses with 'alpha1' prefix
- Online and offline transaction capabilities
- Watch-only mode for monitoring addresses
- Wallet encryption and backup features