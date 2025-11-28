#!/bin/bash

# Create release v0.3.5
echo "Creating release v0.3.5..."

# Create the release with release notes
gh release create v0.3.5 \
  --title "v0.3.5 - Multi-Wallet Support & Bug Fixes" \
  --notes "## What's New in v0.3.5

### 🎯 Major Features
- **Multi-Wallet Support**: Store and manage multiple wallets in the same browser
  - Each wallet stored under unique key derived from master key hash
  - Wallet selector UI when multiple wallets detected
  - New 'Switch' button to change between wallets
  - Prevents data mixing between tabs with different wallets

### 🐛 Bug Fixes
- Fixed encrypted wallet loading flow - now loads instantly after decryption
- Fixed wallet state contamination between tabs
- Fixed performLazyRescan null reference errors
- Fixed updateUIFromWallet scope issues
- Fixed transaction list and UTXO list references
- Improved childPrivateKey recovery for corrupted wallets

### 🔧 Improvements
- Clear all wallet state when switching/loading wallets
- Better error handling and logging
- Automatic migration from legacy wallet storage format
- Consistent behavior between encrypted and unencrypted wallets

### 📝 Technical Details
- Wallets now stored with unique keys: \`alphaWallet_<hash>\`
- Current wallet tracked via \`currentWalletKey\` in localStorage
- Comprehensive state cleanup when switching wallets
- Encrypted wallets follow same flow as unencrypted after decryption

### 🔒 Security
- Each wallet completely isolated in storage
- No cross-tab data leaking
- Proper cleanup of sensitive data when switching wallets" \
  index.html

echo "Release v0.3.5 created successfully!"