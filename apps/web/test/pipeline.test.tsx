// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineView, type PipelineClient } from '../components/PipelineView';
import type { PipelineData } from '../lib/api';

afterEach(cleanup);

const services: PipelineData = {
  funnel: 'services',
  name: 'Services funnel',
  stages: [
    { key: 'target', name: 'Target', position: 1, owner: 'lead-gen', current: 1, reached: 4, conversion: 0.75, avg_days: 6, median_days: 5.5 },
    { key: 'signal', name: 'Signal', position: 2, owner: 'outreach', current: 1, reached: 3, conversion: 0.6667, avg_days: 3, median_days: 3 },
    { key: 'retainer', name: 'Retainer', position: 3, owner: 'founder', current: 0, reached: 0, conversion: null, avg_days: null, median_days: null },
  ],
  totals: { open: 3, won: 1, lost: 0 },
  stuck: [{ deal_id: 'd1', account: 'Old Clinic', stage: 'first-priced-outcome', days_in_stage: 20.4, missing: ['decision_maker', 'due'] }],
  stuck_after_days: 14,
};
const product: PipelineData = { ...services, funnel: 'product', name: 'Product funnel (Vespera)', stuck: [], totals: { open: 0, won: 0, lost: 0 } };
const client = (d: PipelineData[] | Error): PipelineClient => ({ pipeline: vi.fn(async () => (d instanceof Error ? Promise.reject(d) : d)) });

describe('the pipeline page (S2-11)', () => {
  it('shows conversion and days for each stage, and a dash where there is nothing to show', async () => {
    render(<PipelineView client={client([services])} />);
    const table = await screen.findByRole('table', { name: 'Services funnel' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Target')).toBeTruthy();
    expect(within(rows[0]!).getByText('75%')).toBeTruthy();
    expect(within(rows[0]!).getByText('6')).toBeTruthy();
    expect(within(rows[1]!).getByText('67%')).toBeTruthy();
    const last = within(rows[2]!).getAllByText('–');
    expect(last.length).toBeGreaterThanOrEqual(3); // conversion, average and median
  });

  it('totals open, won and lost deals', async () => {
    render(<PipelineView client={client([services])} />);
    await screen.findByRole('table');
    expect(screen.getByText(/3 open/)).toBeTruthy();
    expect(screen.getByText(/1 won/)).toBeTruthy();
    expect(screen.getByText(/0 lost/)).toBeTruthy();
  });

  it('flags stuck deals and says what each is waiting for', async () => {
    render(<PipelineView client={client([services])} />);
    const list = await screen.findByRole('list', { name: 'stuck deals' });
    expect(within(list).getByText(/Old Clinic/)).toBeTruthy();
    expect(within(list).getByText(/20 days/)).toBeTruthy();
    expect(within(list).getByText(/a named decision-maker/)).toBeTruthy();
    expect(within(list).getByText(/a date/)).toBeTruthy();
  });

  it('switches between funnels', async () => {
    render(<PipelineView client={client([services, product])} />);
    await screen.findByRole('table', { name: 'Services funnel' });
    fireEvent.click(screen.getByRole('tab', { name: 'Product funnel (Vespera)' }));
    expect(await screen.findByRole('table', { name: 'Product funnel (Vespera)' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'stuck deals' })).toBeNull();
    expect(screen.getByText(/No deals are stuck/)).toBeTruthy();
  });

  it('says so when there are no funnels, and when the server is unreachable', async () => {
    render(<PipelineView client={client([])} />);
    expect(await screen.findByText(/No funnels/)).toBeTruthy();
    cleanup();
    render(<PipelineView client={client(new Error('fetch failed'))} />);
    await waitFor(() => expect(screen.getByText(/Cannot reach the server/)).toBeTruthy());
  });
});
