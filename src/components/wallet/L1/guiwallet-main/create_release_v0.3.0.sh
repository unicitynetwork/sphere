#!/bin/bash

# Create GitHub release for v0.3.0
echo "Creating GitHub release for Unicity WEB GUI Wallet v0.3.0..."

# Create the release with the index.html file as an asset
gh release create v0.3.0 \
  --repo unicitynetwork/guiwallet \
  --title "Unicity WEB GUI Wallet v0.3.0 - Debug System & Enhanced Security" \
  --notes-file RELEASE_NOTES_v0.3.0.md \
  index.html#unicity-wallet-v0.3.0.html

echo "Release created successfully!"
echo "View it at: https://github.com/unicitynetwork/guiwallet/releases/tag/v0.3.0"