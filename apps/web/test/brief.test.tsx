// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BriefView, type BriefClient } from '../components/BriefView';
import type { Brief } from '../lib/api';

afterEach(cleanup);

const brief = (over: Partial<Brief> = {}): Brief => ({
  day: '2026-11-13',
  quiet: false,
  summary: ['4 new leads (2 scored, 2 qualified).', '2 approvals waiting for you, the oldest 5 hours.'],
  narrative: null,
  narrative_by: null,
  created_at: '2026-11-13T06:30:00Z',
  updated_at: '2026-11-13T06:30:00Z',
  content: {
    leads: { new: 4, scored: 2, qualified: 2, top: [{ id: 'l1', name: 'Alpha Clinic', score: 92, reason: 'Owner-led; slow booking page.' }] },
    approvals: { waiting: 2, oldest_hours: 5, items: [{ id: 'a1', kind: 'email.send', label: 'Email to dana@alpha.test: Hello', created_at: '2026-11-13T01:00:00Z' }] },
    replies: { to_triage: 1, items: [{ task_id: 't1', title: 'Triage reply from Beta' }] },
    deals: { stuck: 1, items: [{ deal_id: 'd1', account: 'Stuck Clinic', stage: 'signal', days: 20 }] },
    attention: { blocked: [{ task_id: 't2', title: 'Write copy', reason: 'No brand voice document.' }], action_items: [{ id: 'i1', kind: 'question', title: 'Which city first?' }], kill_switch: false },
    sent: { emails_24h: 3 },
    goals: { current_rung: 'rung-1', rungs: [{ key: 'rung-1', title: '$1000 a month', target: 1000, current: 250, pct: 25, met: false }], departments: [] },
  },
  ...over,
});
const client = (b: Brief | null | Error, rebuilt?: Brief) =>
  ({
    brief: vi.fn(async () => (b instanceof Error ? Promise.reject(b) : b)),
    rebuild: vi.fn(async () => rebuilt ?? (b as Brief)),
  }) satisfies BriefClient;

describe('the morning brief page (S2-10)', () => {
  it('leads with the summary, then shows each part with what is in it', async () => {
    render(<BriefView client={client(brief())} />);
    expect(await screen.findByText('4 new leads (2 scored, 2 qualified).')).toBeTruthy();
    expect(screen.getByText(/2 approvals waiting/)).toBeTruthy();
    expect(screen.getByText('Alpha Clinic')).toBeTruthy();
    expect(screen.getByText(/92/)).toBeTruthy();
    expect(screen.getByText('Email to dana@alpha.test: Hello')).toBeTruthy();
    expect(screen.getByText('Triage reply from Beta')).toBeTruthy();
    expect(screen.getByText(/Stuck Clinic/)).toBeTruthy();
    expect(screen.getByText(/20 days/)).toBeTruthy();
    expect(screen.getByText('Write copy')).toBeTruthy();
    expect(screen.getByText(/No brand voice document/)).toBeTruthy();
    expect(screen.getByText('Which city first?')).toBeTruthy();
    expect(screen.getByText(/\$1000 a month/)).toBeTruthy();
    expect(screen.getByText(/25%/)).toBeTruthy();
  });

  it('shows the day it is for and when it was counted', async () => {
    render(<BriefView client={client(brief())} />);
    expect(await screen.findByText(/2026-11-13/)).toBeTruthy();
    expect(screen.getByText(/counted at/i)).toBeTruthy();
  });

  it('shows the agent\'s paragraph labelled as the agent\'s, apart from the counted parts', async () => {
    render(<BriefView client={client(brief({ narrative: 'Alpha looks the strongest. Approve the two emails first.', narrative_by: 'agent:cos-1' }))} />);
    const note = await screen.findByText(/Alpha looks the strongest/);
    const box = note.closest('[data-note]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(within(box).getByText(/written by cos-1/i)).toBeTruthy();
    expect(within(box).getByText(/not counted/i)).toBeTruthy();
  });

  it('is complete without a paragraph', async () => {
    render(<BriefView client={client(brief())} />);
    await screen.findByText(/4 new leads/);
    expect(document.querySelector('[data-note]')).toBeNull();
  });

  it('says plainly that a quiet day was quiet, and hides the empty parts', async () => {
    const quiet = brief({ quiet: true, summary: ['Nothing happened overnight, and nothing needs you.'] });
    quiet.content = { ...quiet.content, leads: { new: 0, scored: 0, qualified: 0, top: [] }, approvals: { waiting: 0, oldest_hours: null, items: [] }, replies: { to_triage: 0, items: [] }, deals: { stuck: 0, items: [] }, attention: { blocked: [], action_items: [], kill_switch: false }, sent: { emails_24h: 0 } };
    render(<BriefView client={client(quiet)} />);
    expect(await screen.findByText('Nothing happened overnight, and nothing needs you.')).toBeTruthy();
    expect(screen.queryByText(/Approvals waiting/i)).toBeNull();
  });

  it('refreshes the numbers when asked, and shows the new ones', async () => {
    const c = client(brief(), brief({ summary: ['5 new leads (3 scored, 3 qualified).'] }));
    render(<BriefView client={c} />);
    await screen.findByText(/4 new leads/);
    fireEvent.click(screen.getByRole('button', { name: 'Count again' }));
    expect(await screen.findByText('5 new leads (3 scored, 3 qualified).')).toBeTruthy();
    expect(c.rebuild).toHaveBeenCalledTimes(1);
  });

  it('offers to make the first brief when there is none', async () => {
    const c = client(null, brief());
    render(<BriefView client={c} />);
    expect(await screen.findByText(/no brief yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make today\'s brief' }));
    expect(await screen.findByText(/4 new leads/)).toBeTruthy();
  });

  it('tells you when the server cannot be reached', async () => {
    render(<BriefView client={client(new Error('fetch failed'))} />);
    await waitFor(() => expect(screen.getByText(/Cannot reach the server/)).toBeTruthy());
  });
});
