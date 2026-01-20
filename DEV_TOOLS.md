# Developer Tools Guide

This guide explains how to use the browser console developer tools in AgentSphere for testing and development purposes.

## Prerequisites

The dev tools are only available in development builds. Open your browser's developer console (F12 or Cmd+Option+I) to access these commands.

## Available Commands

### View All Commands

```javascript
devHelp()
```

Displays a list of all available developer commands with descriptions.

---

## Setting a Custom Aggregator URL

Use `devSetAggregatorUrl()` to connect to a different aggregator endpoint at runtime.

### Usage

```javascript
// Set a custom aggregator URL
devSetAggregatorUrl('https://your-aggregator.example.com/')

// Use the Vite proxy for dev aggregator (recommended for local development)
devSetAggregatorUrl('/dev-rpc')

// Use the Vite proxy for testnet aggregator
devSetAggregatorUrl('/rpc')

// Reset to default (from VITE_AGGREGATOR_URL environment variable)
devSetAggregatorUrl(null)

// Check current aggregator URL
devGetAggregatorUrl()
```

### Vite Proxy Routes

When running locally with `npm run dev`, the following proxy routes are available:

| Route | Target |
|-------|--------|
| `/rpc` | `https://goggregator-test.unicity.network` (testnet) |
| `/dev-rpc` | `https://dev-aggregator.dyndns.org` (dev aggregator) |

Using proxy routes avoids CORS issues when connecting to external aggregators.

---

## Skipping Trust Base Verification

When connecting to development or test aggregators that have different trust bases than production, you may need to skip trust base verification.

### Usage

```javascript
devSkipTrustBaseVerification()
```

This command:
- Disables trust base verification for inclusion proofs
- Allows token operations against aggregators with non-production trust bases
- Displays a warning in the console when verification is skipped

### Important Notes

- This setting persists only for the current session
- Refreshing the page resets verification to enabled
- Only use this for development/testing purposes
- Tokens created with verification skipped should not be used in production

### Typical Workflow for Dev Aggregator

```javascript
// 1. Set the dev aggregator URL
devSetAggregatorUrl('https://dev-aggregator.dyndns.org/')

// 2. Skip trust base verification (required for dev aggregators)
devSkipTrustBaseVerification()

// 3. Now you can create nametags, mint tokens, etc.
```

---

## Refreshing Token Proofs

Use `devRefreshProofs()` to refresh inclusion proofs for all tokens in your inventory. This is useful when:

- Tokens were created on a different aggregator
- Proofs have become stale
- You need to verify tokens against the current aggregator state

### Usage

```javascript
// Refresh all token proofs
devRefreshProofs()
```

### What It Does

1. Retrieves all tokens from your L3 wallet inventory
2. For each token, fetches a fresh inclusion proof from the aggregator
3. Updates the local token storage with the new proofs
4. Reports success/failure for each token in the console

### Output Example

```
Starting proof refresh for 3 tokens...
Refreshing proof for token: abc123...
  Updated proof for token abc123
Refreshing proof for token: def456...
  Updated proof for token def456
Refreshing proof for token: ghi789...
  Failed to refresh proof for ghi789: No block found with root hash
Proof refresh complete: 2 succeeded, 1 failed
```

---

## Complete Example: Testing with Dev Aggregator

```javascript
// Step 1: Check current configuration
devHelp()
devGetAggregatorUrl()

// Step 2: Configure for dev aggregator
devSetAggregatorUrl('https://dev-aggregator.dyndns.org/')
devSkipTrustBaseVerification()

// Step 3: Perform operations (create nametag, transfer tokens, etc.)
// ... use the UI normally ...

// Step 4: If needed, refresh proofs after switching aggregators
devRefreshProofs()

// Step 5: Reset to production settings (optional)
devSetAggregatorUrl(null)
// Note: Refresh the page to re-enable trust base verification
```

---

## Troubleshooting

### CORS Errors

If you see CORS errors when connecting to an aggregator:
- Use the Vite proxy routes (`/rpc` or `/dev-rpc`) instead of direct URLs
- Or ensure the aggregator has proper CORS headers configured

### "NOT_AUTHENTICATED" Errors

This usually means trust base verification is failing:
- Run `devSkipTrustBaseVerification()` before performing token operations
- This is expected when connecting to dev/test aggregators

### "Failed to get inclusion proof" Errors

This can happen if:
- The aggregator is not processing commitments (check aggregator logs)
- The commitment was submitted but the round hasn't completed yet
- Network connectivity issues

### Tokens Not Appearing After Refresh

If `devRefreshProofs()` fails for some tokens:
- The tokens may have been created on a different aggregator
- The aggregator's SMT state may not include those tokens
- Check the console for specific error messages
