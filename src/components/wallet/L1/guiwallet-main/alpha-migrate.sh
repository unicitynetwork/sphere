#!/bin/bash
###############################################################################
# Unicity ALPHA Alpha Wallet Migration Tool
###############################################################################
# 
# DESCRIPTION:
#   This script helps users migrate funds from an offline Alpha wallet by
#   importing the child private key into an online Alpha node. The script
#   handles the technical details of importing a private key using descriptors,
#   allowing users to access funds stored at SegWit (alpha1...) addresses.
#
# BACKGROUND:
#   Offline wallets generate SegWit addresses, but importing the master private
#   key directly into an Alpha node doesn't always recognize the correct address
#   format. This script solves the problem by using the child private key
#   (exported from the offline wallet) with the proper descriptor format.
#
# USAGE:
#   ./alpha-migrate.sh <private_key_wif> <wallet_name>
#
# ARGUMENTS:
#   private_key_wif - The child private key in WIF format from offline wallet
#   wallet_name     - Name of the wallet to create or use for importing
#
# EXAMPLES:
#   ./alpha-migrate.sh KxaRsSTC8uVbh6eJDwiyRu8oGgWpkFVFq7ff6QbaMTJfBHNZTMpV my_wallet
#
# NOTES:
#   - You must use the child private key, not the master key
#   - If no funds appear, try rescanning the blockchain
#   - The script will create a new wallet if the specified name doesn't exist
#
###############################################################################

# Check if required parameters are provided
if [ $# -lt 2 ]; then
    echo "Usage: $0 <private_key_wif> <wallet_name>"
    echo "Example: $0 KxaRsSUC8uVbh6eJDwiyRu8oGgWpkFVFq7ff6QbaMTJfBHNZTMpV segwit_recovery"
    exit 1
fi

PRIVATE_KEY="$1"
WALLET_NAME="$2"

echo "Alpha Wallet Migration Tool"
echo "==========================="
echo "This tool imports your child private key from the offline wallet"
echo ""

# Create or use existing wallet
WALLET_EXISTS=$(alpha-cli listwallets | grep -c "\"$WALLET_NAME\"")

if [ "$WALLET_EXISTS" -eq 0 ]; then
    echo "Creating new wallet: $WALLET_NAME"
    alpha-cli createwallet "$WALLET_NAME" false false "" false true false
else
    echo "Using existing wallet: $WALLET_NAME"
fi

# Get descriptor info with checksum
echo "Getting descriptor info for your private key..."
DESCRIPTOR_INFO=$(alpha-cli getdescriptorinfo "wpkh($PRIVATE_KEY)")
CHECKSUM=$(echo "$DESCRIPTOR_INFO" | grep -o '"checksum": "[^"]*"' | cut -d'"' -f4)

echo "Checksum: $CHECKSUM"

# Import the descriptor
echo "Importing private key to wallet..."
alpha-cli -rpcwallet="$WALLET_NAME" importdescriptors '[{"desc":"wpkh('$PRIVATE_KEY')#'$CHECKSUM'","timestamp":"now", "internal":false, "watchonly":false}]'

# List addresses to verify
echo "Verifying imported addresses..."
ADDRESSES=$(alpha-cli -rpcwallet="$WALLET_NAME" listreceivedbyaddress 0 true)

echo "Addresses in wallet:"
echo "$ADDRESSES" | grep -o '"address": "[^"]*"' | cut -d'"' -f4

# Simple check for UTXOs
echo "Checking for available funds..."
UTXO_COUNT=$(alpha-cli -rpcwallet="$WALLET_NAME" listunspent | grep -c "txid")

if [ $UTXO_COUNT -eq 0 ]; then
    echo "No UTXOs found. The address has no funds or the blockchain needs rescanning."
else
    echo "UTXOs found: $UTXO_COUNT transaction(s) available to spend."
    alpha-cli -rpcwallet="$WALLET_NAME" listunspent
fi

# Check balance
BALANCE=$(alpha-cli -rpcwallet="$WALLET_NAME" getbalance)
echo "Wallet balance: $BALANCE"

echo ""
echo "Migration complete! Your offline wallet's private key has been imported."
echo "You can now use the wallet '$WALLET_NAME' to manage your funds."
echo ""
echo "If no funds are showing, but you're expecting some, try rescanning:"
echo "alpha-cli -rpcwallet=\"$WALLET_NAME\" rescanblockchain"
