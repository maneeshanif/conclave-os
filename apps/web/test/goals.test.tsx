// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalsView, type GoalsClient } from '../components/GoalsView';
import type { GoalsData } from '../lib/api';

afterEach(cleanup);

const data = (over: Partial<GoalsData> = {}): GoalsData => ({
  current_rung: 'rung-1',
  rungs: [
    { key: 'rung-1', title: '$1000 a month', target: 1000, due: '2026-12-12', status: 'active', source: 'services', unit: 'usd', window: 'this month', measured: true, current: 850, pct: 85, met: false },
    { key: 'rung-2', title: '$4000 a month', target: 4000, due: '2027-02-12', status: 'planned', source: 'services+pilot', unit: 'usd', window: 'this month', measured: true, current: 850, pct: 21.25, met: false },
  ],
  departments: [
    { key: 'lead-gen:qualified_leads_per_week', department: 'lead-gen', metric: 'qualified_leads_per_week', serves: 'rung-1', stage: null, target: 20, unit: 'leads', window: '7 days', measured: true, current: 12, pct: 60 },
    { key: 'outreach:vibes', department: 'outreach', metric: 'vibes_per_week', serves: 'rung-1', stage: null, target: 3, unit: null, window: null, measured: false, current: null, pct: null },
  ],
  ...over,
});
const client = (d: GoalsData | Error) => ({ goals: vi.fn(async () => (d instanceof Error ? Promise.reject(d) : d)) }) satisfies GoalsClient;

describe('the goals page (S2-9)', () => {
  it('shows the ladder with where each rung stands, the current one first and marked', async () => {
    render(<GoalsView client={client(data())} />);
    const rungs = within(await screen.findByRole('list', { name: 'goal ladder' })).getAllByRole('listitem');
    expect(rungs).toHaveLength(2);
    expect(within(rungs[0]!).getByText('$1000 a month')).toBeTruthy();
    expect(within(rungs[0]!).getByText('current')).toBeTruthy();
    expect(within(rungs[0]!).getByText(/850/)).toBeTruthy();
    expect(within(rungs[0]!).getByText(/85%/)).toBeTruthy();
    expect(within(rungs[0]!).getByText(/12 Dec 2026|2026-12-12/)).toBeTruthy();
    expect(within(rungs[1]!).queryByText('current')).toBeNull();
  });

  it('draws progress as a bar a screen reader can read', async () => {
    render(<GoalsView client={client(data())} />);
    const bars = await screen.findAllByRole('progressbar');
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('85');
    expect(bars[0]!.getAttribute('aria-valuemax')).toBe('100');
  });

  it('lists the department goals with the number, the target and the period', async () => {
    render(<GoalsView client={client(data())} />);
    const rows = within(await screen.findByRole('list', { name: 'department goals' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('lead-gen')).toBeTruthy();
    expect(within(rows[0]!).getByText(/12 of 20/)).toBeTruthy();
    expect(within(rows[0]!).getByText(/7 days/)).toBeTruthy();
  });

  it('says "not measured" instead of showing a zero for a metric nothing can compute', async () => {
    render(<GoalsView client={client(data())} />);
    const rows = within(await screen.findByRole('list', { name: 'department goals' })).getAllByRole('listitem');
    expect(within(rows[1]!).getByText(/not measured/i)).toBeTruthy();
    expect(within(rows[1]!).queryByRole('progressbar')).toBeNull();
  });

  it('marks a rung that has been met', async () => {
    const d = data();
    d.rungs[0] = { ...d.rungs[0]!, current: 1150, pct: 115, met: true };
    render(<GoalsView client={client(d)} />);
    expect(await screen.findByText(/met/i)).toBeTruthy();
    expect(screen.getAllByRole('progressbar')[0]!.getAttribute('aria-valuenow')).toBe('100'); // the bar stops at full; the text says 115%
    expect(screen.getByText(/115%/)).toBeTruthy();
  });

  it('says where goals are changed, and what to do when there are none', async () => {
    render(<GoalsView client={client(data({ rungs: [], departments: [], current_rung: null }))} />);
    expect(await screen.findByText(/company\/goals\.yaml/)).toBeTruthy();
    expect(screen.getByText(/no goals/i)).toBeTruthy();
  });

  it('tells you when the server cannot be reached', async () => {
    render(<GoalsView client={client(new Error('fetch failed'))} />);
    await waitFor(() => expect(screen.getByText(/Cannot reach the server/)).toBeTruthy());
  });
});
