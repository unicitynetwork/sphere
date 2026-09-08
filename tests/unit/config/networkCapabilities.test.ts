import { describe, it, expect } from 'vitest';
import {
  allowsSharedAggregatorKey,
  canSelfMint,
  MINT_UNAVAILABLE_MESSAGE,
  isTestMoney,
  testMoneyMatchesSelfMint,
  requiresSalesOptIn,
  salesOptInMatchesTestMoney,
} from '../../../src/config/networkCapabilities';

describe('canSelfMint — fail-closed allowlist', () => {
  it('allows the test networks', () => {
    // 'testnet' stays: it is a real SDK alias of testnet2, not a leftover.
    expect(canSelfMint('testnet2')).toBe(true);
    expect(canSelfMint('testnet')).toBe(true);
  });

  it('denies mainnet', () => {
    expect(canSelfMint('mainnet')).toBe(false);
  });

  it('denies unknown, empty, cased and padded values', () => {
    expect(canSelfMint('')).toBe(false);
    // 'dev' was on the allowlist until sphere-sdk 0.16.0-dev.1 deleted the
    // network. The parameter is a plain `string`, so a stale entry would keep
    // granting mint to a name nothing can resolve — no compiler would object.
    expect(canSelfMint('dev')).toBe(false);
    expect(canSelfMint('testnet3')).toBe(false);
    expect(canSelfMint('some-future-network')).toBe(false);
    expect(canSelfMint('MAINNET')).toBe(false);
    expect(canSelfMint('Testnet2')).toBe(false); // exact match only — no case folding
    expect(canSelfMint(' testnet2')).toBe(false); // no trimming either
  });

  it('exposes the shared user-facing message', () => {
    // Names the FEATURE, not the network's capability: minting on mainnet is
    // exactly what a subscriber does with their own key via a dApp or the SDK.
    expect(MINT_UNAVAILABLE_MESSAGE).toBe('Top Up is only available on test networks');
  });
});

describe('allowsSharedAggregatorKey — fail-closed allowlist', () => {
  it('allows the shared key on test networks', () => {
    // The key ships readable to every visitor; on a test network it guards
    // worthless money and is published on purpose.
    expect(allowsSharedAggregatorKey('testnet2')).toBe(true);
    expect(allowsSharedAggregatorKey('testnet')).toBe(true);
  });

  it('refuses the shared key on mainnet', () => {
    // It would hand the operator's aggregator quota to anyone with devtools.
    expect(allowsSharedAggregatorKey('mainnet')).toBe(false);
  });

  it('denies unknown, empty, cased and padded values', () => {
    expect(allowsSharedAggregatorKey('')).toBe(false);
    expect(allowsSharedAggregatorKey('dev')).toBe(false); // network deleted in 0.16.0-dev.1
    expect(allowsSharedAggregatorKey('some-future-network')).toBe(false);
    expect(allowsSharedAggregatorKey('MAINNET')).toBe(false);
    expect(allowsSharedAggregatorKey(' testnet2')).toBe(false);
  });
});
describe('isTestMoney — the badge colour, not the minting gate', () => {
  it('is true for the test networks and false for mainnet', () => {
    expect(isTestMoney('testnet2')).toBe(true);
    expect(isTestMoney('testnet')).toBe(true);
    expect(isTestMoney('mainnet')).toBe(false);
  });

  it('fails closed on anything unknown — an unlabelled network is not play money', () => {
    // Getting this backwards paints real money amber ("tokens hold no real value"),
    // which is the asymmetry the badge exists to protect.
    expect(isTestMoney('')).toBe(false);
    expect(isTestMoney('Testnet2')).toBe(false); // exact match only — no case folding
    expect(isTestMoney('some-future-network')).toBe(false);
  });

  it('needs an explicit sales opt-in on exactly the test networks, and fails closed', () => {
    expect(requiresSalesOptIn('testnet2')).toBe(true);
    expect(requiresSalesOptIn('testnet')).toBe(true);
    expect(requiresSalesOptIn('mainnet')).toBe(false);
    // An unknown network is real-value until someone says otherwise, so it does
    // NOT get the test-network opt-in — it answers to the ordinary store flag.
    expect(requiresSalesOptIn('some-future-network')).toBe(false);
  });

  it('agrees with isTestMoney today — so a divergence has to be written down', () => {
    // A third separate QUESTION over a third set: a real-value network can exist
    // whose store is not open yet, and it must be able to require the opt-in
    // without being called play money. This pins that nobody split them by
    // accident; the day they legitimately differ, edit this test.
    for (const n of ['testnet2', 'testnet', 'mainnet', '', 'some-future-network']) {
      expect(salesOptInMatchesTestMoney(n)).toBe(true);
    }
  });

  it('agrees with canSelfMint today — so a divergence has to be written down', () => {

    // They are separate QUESTIONS over separate sets: a test network could have
    // minting switched off and would still hold play money. This pins that nobody
    // has split them by accident; the day they legitimately differ, edit this test.
    for (const n of ['testnet2', 'testnet', 'mainnet', '', 'some-future-network']) {
      expect(testMoneyMatchesSelfMint(n)).toBe(true);
    }
  });
});
