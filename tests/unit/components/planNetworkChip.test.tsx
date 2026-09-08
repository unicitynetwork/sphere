/**
 * sphere#511: the plan screen must say which network a plan belongs to.
 *
 * The same grid sells test-network play money and mainnet real money, and the
 * screen looked identical in both. The chip is the only thing on it that
 * distinguishes the two, so it must survive every mode and every step.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanNetworkChip } from '@/components/upgrade/PlanScreen';

describe('PlanNetworkChip', () => {
  it('names the active network', () => {
    // The test environment resolves to the build default, testnet2.
    render(<PlanNetworkChip />);
    expect(screen.getByText('Testnet')).toBeDefined();
  });

  it('says in its tooltip that test-network money is not real', () => {
    render(<PlanNetworkChip />);
    const chip = screen.getByText('Testnet');
    expect(chip.getAttribute('title') ?? chip.parentElement?.getAttribute('title') ?? '').toMatch(
      /test network/i,
    );
  });
});
