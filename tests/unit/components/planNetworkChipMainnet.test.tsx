/**
 * The half of PlanNetworkChip that actually protects money: on a live network
 * it must say so, in the colour the wallet already uses for real assets.
 *
 * Its own file because SPHERE_NETWORK is resolved once at module load, so a
 * mainnet session cannot be simulated inside the testnet suite.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../src/config/network', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/network')>()),
  SPHERE_NETWORK: 'mainnet',
}));

import { PlanNetworkChip } from '@/components/upgrade/PlanScreen';

describe('PlanNetworkChip on a live network', () => {
  it('names mainnet and says purchases are real', () => {
    render(<PlanNetworkChip />);
    const chip = screen.getByText('Mainnet');
    expect(chip).toBeDefined();
    expect(chip.getAttribute('title') ?? '').toMatch(/real money/i);
  });

  it('does not wear the test-money colour', () => {
    // NetworkBadge's rule: amber means "not real money". Wearing it here would
    // tell a mainnet buyer their charge is play money.
    render(<PlanNetworkChip />);
    const chip = screen.getByText('Mainnet');
    expect(chip.className).not.toMatch(/amber/);
    expect(chip.className).toMatch(/emerald/);
  });
});
