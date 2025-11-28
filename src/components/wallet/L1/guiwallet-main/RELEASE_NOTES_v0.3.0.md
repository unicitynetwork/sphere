# Unicity WEB GUI Wallet v0.3.0

## Release Date: 2025-09-06

## Major Features and Improvements

### 🐛 Comprehensive Debug System
- **Transaction Debug Logging**: Automatic tracking of all transaction operations with detailed logs
- **Debug Modal Interface**: Interactive debug viewer with Summary, Logs, Errors, and History tabs
- **Bug Report Submission**: One-click submission to debug service at https://unicity-debug-report.dyndns.org:3487
- **Failed Transaction Recovery**: Export and retry failed transactions
- **Privacy Protection**: Automatic sanitization of sensitive data (private keys never included)
- **Debug Service**: Express.js microservice for collecting and analyzing debug reports

### 🔐 Enhanced Security Features
- **Mandatory Password Verification**: Encrypted wallets now require password verification during save
- **Masked Password Input**: Fixed password re-entry to use proper password field masking
- **No Skip Option**: Removed ability to skip verification for encrypted wallets
- **Critical Error Prevention**: Prevents users from losing access to funds due to unverified encryption

### 💼 Improved Wallet Management
- **Wallet Type Detection**: Automatically detects and displays wallet type (BIP32 vs WIF) before decryption
- **Optimized WIF Loading**: Encrypted WIF wallets now load directly without unnecessary address scanning
- **Clear Type Indicators**: Shows "(BIP32 HD Wallet - will scan for addresses)" or "(Standard WIF Wallet - single address)"
- **Better User Experience**: Users know what type of wallet they're decrypting before entering password

### 🛠️ Bug Fixes
- Fixed Cold Wallet Tools tab not displaying due to incorrect element ID reference
- Fixed undefined `updateAddressTable` error when loading encrypted WIF wallets
- Fixed help modal cold wallet tab reference inconsistency
- Corrected tab switching logic for both main and help modals

### 📚 Documentation Updates
- **Debug & Bug Reporting Tab**: Added comprehensive help documentation for debug features
- **Step-by-Step Instructions**: Clear guide on accessing debug features and submitting reports
- **Privacy Information**: Detailed explanation of data sanitization and security
- **Troubleshooting Guide**: Tips for better bug reports and common issues

## Technical Details

### Debug System Architecture
- **Frontend**: Integrated debug logging with IndexedDB persistence
- **Backend**: Node.js/Express service with SSL support
- **Storage**: Organized report storage by date with JSON index
- **API Endpoints**: RESTful API for report submission and retrieval

### Files Modified
- `index.html`: Main wallet application with debug integration
- `debug-service/server.js`: Debug report collection service
- `debug-service/public/`: Web interface for viewing reports

## Installation & Usage

### For Users
Simply open the `index.html` file in your browser. The debug features are automatically available via the Debug button in the bottom-right corner.

### For Developers (Debug Service)
```bash
cd debug-service
npm install
node server.js
```

## Breaking Changes
None - All changes are backward compatible.

## Migration Notes
- Existing encrypted wallets will now require password verification when saving
- WIF wallets will load faster due to optimized loading process

## Known Issues
- None at this time

## Contributors
- Unicity Network Development Team
- Community testers and bug reporters

## Support
For issues or questions, please visit: https://github.com/unicitynetwork/guiwallet/issues

---

**Download**: [unicity-wallet-v0.3.0.html](https://github.com/unicitynetwork/guiwallet/releases/download/v0.3.0/unicity-wallet-v0.3.0.html)

**Full Changelog**: [v0.2.0...v0.3.0](https://github.com/unicitynetwork/guiwallet/compare/v0.2.0...v0.3.0)