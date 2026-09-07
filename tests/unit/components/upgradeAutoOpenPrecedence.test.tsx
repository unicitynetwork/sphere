/**
 * sphere#511 review: the two automatic openers must not silence each other.
 *
 * The network offer is a one-shot courtesy; the downgrade prompt is a state
 * change the user has to know about ("your limits just dropped"). A latch that
 * treats them as equals lets the courtesy swallow the notice — and
 * PlanDowngradeWatcher records the plan as seen either way, so the notice never
 * comes back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const ctx = vi.hoisted(() => ({
  openFromNetwork: null as null | ((r?: string) => void),
  openFromDowngrade: null as null | ((r?: string) => void),
  screen: { isOpen: false, reason: undefined as string | undefined },
}));

vi.mock('../../../src/components/upgrade/NetworkSwitchPlanOffer', () => ({
  NetworkSwitchPlanOffer: ({ openUpgrade }: { openUpgrade: (r?: string) => void }) => {
    ctx.openFromNetwork = openUpgrade;
    return null;
  },
}));

vi.mock('../../../src/components/upgrade/PlanDowngradeWatcher', () => ({
  PlanDowngradeWatcher: ({ openUpgrade }: { openUpgrade: (r?: string) => void }) => {
    ctx.openFromDowngrade = openUpgrade;
    return null;
  },
}));

vi.mock('../../../src/components/upgrade/PlanScreen', () => ({
  PlanScreen: ({ isOpen, reason }: { isOpen: boolean; reason?: string }) => {
    ctx.screen = { isOpen, reason };
    return null;
  },
}));

vi.mock('../../../src/components/subscription/AddressKeyPromptModal', () => ({
  AddressKeyPromptModal: () => null,
}));

import { UpgradeProvider } from '../../../src/components/upgrade/UpgradeProvider';

beforeEach(() => {
  ctx.openFromNetwork = null;
  ctx.openFromDowngrade = null;
  ctx.screen = { isOpen: false, reason: undefined };
});

describe('automatic openers', () => {
  it('lets the network offer open the screen once', () => {
    render(<UpgradeProvider>{null}</UpgradeProvider>);
    act(() => ctx.openFromNetwork?.('network'));
    expect(ctx.screen).toEqual({ isOpen: true, reason: 'network' });
  });

  it('ignores a repeat from the network offer', () => {
    render(<UpgradeProvider>{null}</UpgradeProvider>);
    act(() => ctx.openFromNetwork?.('network'));
    act(() => ctx.openFromDowngrade?.('expired'));
    act(() => ctx.openFromNetwork?.('network'));
    // The last call must not rewrite the banner the user is reading.
    expect(ctx.screen.reason).toBe('expired');
  });

  it('still delivers a downgrade notice after the network offer has fired', () => {
    // A lapsed paid plan on a second address is a real state change, minutes
    // later in the same session. Swallowing it loses it for good, because
    // PlanDowngradeWatcher remembers the plan as seen regardless.
    render(<UpgradeProvider>{null}</UpgradeProvider>);
    act(() => ctx.openFromNetwork?.('network'));
    act(() => ctx.openFromDowngrade?.('expired'));
    expect(ctx.screen).toEqual({ isOpen: true, reason: 'expired' });
  });

  it('lets the downgrade notice take precedence over a later network offer', () => {
    render(<UpgradeProvider>{null}</UpgradeProvider>);
    act(() => ctx.openFromDowngrade?.('expired'));
    act(() => ctx.openFromNetwork?.('network'));
    expect(ctx.screen.reason).toBe('expired');
  });
});
