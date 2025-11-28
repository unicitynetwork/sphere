# Unicity WEB GUI Wallet

A comprehensive web-based wallet for the Unicity network that enables secure management of funds across both the consensus layer (Proof of Work blockchain) and the upcoming offchain state transition layer. This wallet runs entirely in your browser with no server dependencies, providing maximum security and privacy.

![Unicity WEB GUI Wallet](wallet-screenshot.png)

## Overview

The Unicity WEB GUI Wallet is designed to be the primary interface for interacting with the Unicity network's multi-layer architecture:

- **Consensus Layer (Active)**: Manage your Alpha cryptocurrency on the Proof of Work blockchain
- **Offchain State Transition Layer (Coming Soon)**: Future support for high-speed, low-cost transactions in the offchain layer

> **Note**: The offchain state transition layer is not yet implemented. Current functionality focuses on secure management of funds in the consensus layer.

## Features

### Core Wallet Features
- **100% Client-Side**: All operations happen in your browser - no data is ever sent to any server
- **Offline Capable**: Save the HTML file and run it completely offline for maximum security
- **HD Wallet**: Hierarchical Deterministic wallet with BIP44-style derivation
- **Multi-Mode Operation**: Supports both full wallet mode and watch-only mode

### Transaction Management
- **UTXO Management**: Full visibility and control over your unspent transaction outputs
- **Transaction History**: Complete transaction history with pagination (20 per page)
- **Offline Signing**: Create and sign transactions offline, broadcast when connected
- **Fee Control**: Manual fee adjustment for transaction priority

### Security Features
- **Password Protection**: AES encryption with 100,000 PBKDF2 iterations
- **Auto-Hide**: Private keys automatically hide after 30 seconds
- **Secure Key Generation**: Uses Web Crypto API for cryptographically secure randomness
- **Watch-Only Mode**: Monitor addresses without exposing private keys

### Integration Features
- **Fulcrum Server Support**: Connect to Fulcrum servers for real-time blockchain data
- **Import/Export**: 
  - Export UTXOs for offline transaction creation
  - Import and broadcast signed transactions
  - Backup and restore wallet data
- **Migration Tools**: Included script for migrating to Alpha Core nodes

## How to Use

### Initial Setup
1. **Access the Wallet**:
   - Visit https://unicitynetwork.github.io/guiwallet/ 
   - Or download `index.html` and open locally
   - For maximum security, save the file and use it on an offline computer

2. **Create a New Wallet**:
   - Click "Create Wallet" to generate a new master key
   - The wallet uses secure random generation for maximum entropy

3. **Secure Your Wallet**:
   - Click "Encrypt Wallet" to add password protection
   - Use a strong, unique password
   - Backup your wallet data immediately

### Managing Funds

#### Online Mode (Connected to Fulcrum)
1. Connect to a Fulcrum server using the RPC connection
2. View real-time balance and transaction history
3. Create and broadcast transactions directly

#### Offline Mode
1. Export UTXO data while online
2. Transfer to offline computer
3. Create and sign transactions offline
4. Transfer signed transaction back to online computer for broadcasting

### Watch-Only Mode
- Monitor any Alpha address without private keys
- View balance, transactions, and UTXOs
- Perfect for cold storage monitoring

## Technical Architecture

### Consensus Layer Support
The wallet fully supports the Unicity consensus layer (Proof of Work blockchain):
- **Address Format**: SegWit Bech32 addresses with `alpha1` prefix
- **Key Derivation**: BIP44 path `m/44'/0'/{index}'`
- **Transaction Format**: Native SegWit (P2WPKH) transactions

### Cryptographic Implementation
- **Key Generation**: secp256k1 elliptic curve cryptography
- **HD Derivation**: HMAC-SHA512 for child key generation
- **Encryption**: AES with PBKDF2 key derivation (100,000 iterations)
- **Address Encoding**: Bech32 for SegWit compatibility

### Storage
- **IndexedDB**: Primary storage for cross-tab persistence
- **LocalStorage**: Fallback storage option
- **Encrypted Format**: All sensitive data encrypted before storage

## Migration to Alpha Core

The wallet includes tools for migrating funds to Alpha Core nodes:

```bash
# Use the included migration script
./alpha-migrate.sh <private_key_wif> <wallet_name>

# Example:
./alpha-migrate.sh KxaRsSTC8uVbh6eJDwiyRu8oGgWpkFVFq7ff6QbaMTJfBHNZTMpV my_wallet
```

The migration script:
1. Creates or uses an existing Alpha wallet
2. Imports the private key with proper SegWit descriptors
3. Verifies the import and checks for available funds

## Security Best Practices

1. **Offline Usage**: For maximum security, use on an air-gapped computer
2. **Backup Strategy**: 
   - Keep multiple encrypted backups
   - Store in geographically separate locations
   - Test restore process regularly
3. **Password Security**:
   - Use strong, unique passwords
   - Never share or write down passwords insecurely
4. **Transaction Verification**: Always verify addresses and amounts before signing

## Future Development

### Offchain State Transition Layer (Planned)
- High-speed transaction processing
- Minimal fees for microtransactions
- Seamless integration with consensus layer
- State channel management

### Additional Features (Roadmap)
- Multi-signature support
- Hardware wallet integration
- Advanced coin control features
- Mobile-responsive design improvements

## Development

The entire wallet is self-contained in a single `index.html` file with embedded:
- JavaScript implementation
- CSS styling
- Cryptographic libraries
- No external dependencies or build process required

## License

[MIT License](LICENSE)

## Support

For issues, feature requests, or contributions, please visit:
https://github.com/unicitynetwork/guiwallet