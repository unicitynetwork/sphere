#!/bin/bash

# Create GitHub release for v0.2.0
echo "Creating GitHub release for Unicity WEB GUI Wallet v0.2.0..."

# Create the release with the index.html file as an asset
gh release create v0.2.0 \
  --repo unicitynetwork/guiwallet \
  --title "Unicity WEB GUI Wallet v0.2.0 - BIP32 HD Wallet Support" \
  --notes-file RELEASE_NOTES_v0.2.0.md \
  --latest \
  index.html#unicity-wallet-v0.2.0.html

echo "Release created successfully!"
echo "View it at: https://github.com/unicitynetwork/guiwallet/releases/tag/v0.2.0"