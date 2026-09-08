import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpgradeReasonBanner } from '@/components/upgrade/PlanScreen';

describe('UpgradeReasonBanner', () => {
  it('renders the quota banner for reason "quota"', () => {
    render(<UpgradeReasonBanner reason="quota" />);
    expect(screen.queryByText(/hit your plan's limit/i)).not.toBeNull();
    expect(screen.queryByText(/plan has expired/i)).toBeNull();
  });

  it('renders the expired banner for reason "expired"', () => {
    render(<UpgradeReasonBanner reason="expired" />);
    expect(
      screen.queryByText(/your plan has expired — renew to restore your limits\./i),
    ).not.toBeNull();
    expect(screen.queryByText(/hit your plan's limit/i)).toBeNull();
  });

  it('explains a switch-triggered open with the network banner', () => {
    // The one reason the app raises by itself without the user asking, so it
    // has to say why the screen appeared.
    render(<UpgradeReasonBanner reason="network" />);
    expect(screen.queryByText(/switched networks/i)).not.toBeNull();
    expect(screen.queryByText(/plans are per network/i)).not.toBeNull();
  });

  it('renders no banner for reason "settings"', () => {
    const { container } = render(<UpgradeReasonBanner reason="settings" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders no banner when reason is undefined', () => {
    const { container } = render(<UpgradeReasonBanner reason={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
