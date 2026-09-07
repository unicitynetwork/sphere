/**
 * The GitHub Pages branch preview is where subscription and payment fixes are
 * exercised before merge, and mainnet is the only network where paid plans
 * exist at all (PAID_PLANS_ENABLED is ANDed with chargesRealMoney).
 *
 * That deploy has NO container, so nothing writes runtime-config.js: the build
 * env is the only source of these flags. Drop one and mainnet silently stops
 * being selectable — `unavailableReasonFor` reports it as unavailable, the
 * switcher hides the row, and nothing fails anywhere. These assertions name the
 * gate each variable answers so a future edit has to argue with the reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(
  resolve(__dirname, '../../../.github/workflows/deploy-pages-branch.yml'),
  'utf8',
);

/** Value of `KEY: value` in the workflow, quotes stripped. */
function envValue(key: string): string | null {
  const m = workflow.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

describe('the Pages preview build can actually reach mainnet', () => {
  it('serves a wallet-api base for mainnet (gate: not-served-here)', () => {
    // walletApiUrlFor('mainnet') reads ENV_URL.mainnet on a non-Docker build;
    // the legacy single VITE_WALLET_API_URL only ever described testnet2.
    expect(envValue('VITE_WALLET_API_URL_MAINNET')).toMatch(/^https:\/\/\S+$/);
  });

  it('keeps subscriptions on (gate: not-served-here for a real-money network)', () => {
    // allowsSharedAggregatorKey('mainnet') is false, so without subscriptions
    // the network is refused rather than run on the shared build-time key.
    expect(envValue('VITE_SUBSCRIPTION_ENABLED')).toBe('true');
  });

  it('opts into the mainnet rollout (gate: not-rolled-out)', () => {
    expect(envValue('VITE_MAINNET_ROLLOUT_ENABLED')).toBe('true');
  });

  it('offers paid plans, as live staging does', () => {
    // Still ANDed with chargesRealMoney, so this only shows plans once the
    // user deliberately switches to mainnet.
    expect(envValue('VITE_PAID_PLANS_ENABLED')).toBe('true');
  });

  it('still serves testnet2, so the preview is not mainnet-only', () => {
    expect(envValue('VITE_WALLET_API_URL_TESTNET2')).toMatch(/^https:\/\/\S+$/);
  });
});
