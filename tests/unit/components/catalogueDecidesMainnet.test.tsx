/**
 * The other half: on a live network the notice must stay out of the way. An
 * amber "not real money" warning shown where the money IS real would train
 * people to ignore the one place it matters.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../src/config/network', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/network')>()),
  SPHERE_NETWORK: 'mainnet',
}));

import { TestMoneyPurchaseNotice } from '@/components/upgrade/PlanScreen';

describe('TestMoneyPurchaseNotice on a live network', () => {
  it('renders nothing', () => {
    const { container } = render(<TestMoneyPurchaseNotice />);
    expect(container.firstChild).toBeNull();
  });
});
