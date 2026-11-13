// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignsView, type CampaignsClient } from '../components/CampaignsView';
import type { CampaignResults, CampaignRow } from '../lib/api';

afterEach(cleanup);

const row = (id: string, status: CampaignRow['status'], name = 'Clinics Lahore'): CampaignRow => ({ id, name, market: 'services', channel: 'email', status, channel_account_id: 'm1', channel_handle: 'hello@example.test', approved_at: status === 'draft' ? null : '2026-11-12T10:00:00Z', steps: 2 });
const results: CampaignResults = {
  campaign: 'c1',
  name: 'Clinics Lahore',
  status: 'running',
  enrolled: 40,
  enrollment: { active: 30, paused: 8, unsubscribed: 2, done: 0 },
  sent: 25,
  delivered: null,
  opened: null,
  replied: 5,
  positive_replies: 2,
  reply_rate: 0.2,
  meetings: null,
  won: 1,
  cost_usd: 0.75,
};
function fake(rows: CampaignRow[]) {
  return {
    campaigns: vi.fn(async () => rows),
    results: vi.fn(async () => results),
    act: vi.fn(async () => ({ id: 'c1', status: 'ok' })) as unknown as CampaignsClient['act'] & ReturnType<typeof vi.fn>,
  } satisfies CampaignsClient;
}

describe('the campaigns page (S2-11)', () => {
  it('lists campaigns with status, mailbox and number of steps', async () => {
    render(<CampaignsView client={fake([row('c1', 'running'), row('c2', 'draft', 'Spas')])} />);
    const items = within(await screen.findByRole('list', { name: 'campaigns' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Clinics Lahore')).toBeTruthy();
    expect(within(items[0]!).getByText('running')).toBeTruthy();
    expect(within(items[0]!).getByText(/hello@example.test/)).toBeTruthy();
    expect(within(items[0]!).getByText(/2 steps/)).toBeTruthy();
  });

  it('shows the results of the one you open, and says what cannot be known', async () => {
    const c = fake([row('c1', 'running')]);
    render(<CampaignsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clinics Lahore/ }));
    const box = await screen.findByRole('region', { name: 'Results' });
    expect(within(box).getByText('40')).toBeTruthy(); // enrolled
    expect(within(box).getByText('25')).toBeTruthy(); // sent
    expect(within(box).getByText('20%')).toBeTruthy(); // reply rate
    expect(within(box).getAllByText('not tracked').length).toBe(3); // delivered, opened, meetings
    expect(within(box).getByText(/\$0\.75/)).toBeTruthy();
    expect(c.results).toHaveBeenCalledWith('c1');
  });

  it.each([
    ['draft', 'Approve campaign', 'approve'],
    ['approved', 'Start', 'start'],
    ['running', 'Pause', 'pause'],
    ['paused', 'Start', 'start'],
  ] as const)('a %s campaign offers the one next step, %s', async (status, button, action) => {
    const c = fake([row('c1', status)]);
    render(<CampaignsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clinics Lahore/ }));
    fireEvent.click(await screen.findByRole('button', { name: button }));
    await waitFor(() => expect(c.act).toHaveBeenCalledWith('c1', action));
  });

  it('a finished campaign offers nothing to do', async () => {
    render(<CampaignsView client={fake([row('c1', 'done')])} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clinics Lahore/ }));
    await screen.findByRole('region', { name: 'Results' });
    expect(screen.queryByRole('button', { name: /Start|Pause|Approve/ })).toBeNull();
  });

  it('says why when the server refuses (an unhealthy mailbox, say), and keeps the campaign as it was', async () => {
    const c = fake([row('c1', 'draft')]);
    c.act.mockRejectedValue(new Error('The mailbox hello@example.test is blocked, so the campaign cannot be approved.'));
    render(<CampaignsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clinics Lahore/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve campaign' }));
    expect(await screen.findByText(/is blocked/)).toBeTruthy();
    expect(screen.getByText('draft')).toBeTruthy();
  });

  it('ignores a double click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const c = fake([row('c1', 'running')]);
    c.act.mockImplementation(async () => {
      await gate;
      return { id: 'c1', status: 'paused' };
    });
    render(<CampaignsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Clinics Lahore/ }));
    const pause = await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(pause);
    fireEvent.click(pause);
    expect(c.act).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(c.campaigns.mock.calls.length).toBeGreaterThan(1));
  });

  it('says so when there are none, and when the server is unreachable', async () => {
    render(<CampaignsView client={fake([])} />);
    expect(await screen.findByText(/No campaigns yet/)).toBeTruthy();
    cleanup();
    render(<CampaignsView client={{ ...fake([]), campaigns: vi.fn(async () => Promise.reject(new Error('fetch failed'))) }} />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
  });
});
