// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { OBJECT_PANELS, panelFor } from '@conclave/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalentView, type TalentClient } from '../components/TalentView';
import type { Scorecard, TalentRoom } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const room = (over: Partial<TalentRoom> = {}): TalentRoom => ({
  policy: { level: 'H0', rosterCap: 20, trialBudgetCapUsd: 5, active: 7 },
  bakeoffs: [{ id: 'b1', department: 'outreach', query: 'landing copy', status: 'scored', createdAt: '2026-11-19T10:00:00Z', candidates: [
    { source: 'agency', key: 'steady', name: 'Steady Copywriter', boundaryAttempts: 0, rating: 80, costUsd: 0.3 },
    { source: 'agency', key: 'flashy', name: 'Flashy Copywriter', boundaryAttempts: 2, rating: 95, costUsd: 0.4 },
  ] }],
  catalog: [{ source: 'agency', roles: 12, flagged: 2 }],
  hires: [{ approvalId: 'a1', status: 'pending', name: 'Steady Copywriter', department: 'outreach' }],
  ...over,
});
const card = (over: Partial<Scorecard> = {}): Scorecard => ({ agentKey: 'w', name: 'Wren', department: 'outreach', tasksDone: 3, runs: 4, checksPassed: 4, accepted: 2, acceptedAsIs: 2, edited: 0, rejected: 0, costUsd: 1, costPerAccepted: 0.5, boundaryAttempts: 0, suggestion: null, ...over });
const client = (r: TalentRoom | Error, c: Scorecard[] = []): TalentClient => ({ talent: vi.fn(async () => (r instanceof Error ? Promise.reject(r) : r)), scorecards: vi.fn(async () => c) });

describe('the Talent room panel (S8-8)', () => {
  it('shows the policy and roster, bake-offs in rank order with boundaries, hire cards, and the catalog with its flagged count', async () => {
    render(<TalentView client={client(room(), [card()])} />);
    expect(await screen.findByText(/Level/)).toBeTruthy();
    const policy = screen.getByLabelText('Hiring policy');
    expect(within(policy).getByText('H0')).toBeTruthy();
    expect(policy.textContent).toMatch(/7 of 20 active agents/);
    const bake = screen.getByLabelText('Bake-offs');
    const items = within(bake).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/Steady Copywriter.*no boundary attempts/);
    expect(items[1]!.textContent).toMatch(/Flashy Copywriter.*2 boundary attempts/);
    expect(screen.getByLabelText('Hires').textContent).toMatch(/Steady Copywriter → outreach · pending/);
    expect(screen.getByLabelText('Catalog').textContent).toMatch(/agency: 12 roles, 2 flagged and kept out of search/);
  });

  it('shows each scorecard with its suggestion for a weak agent', async () => {
    render(<TalentView client={client(room(), [card({ suggestion: { move: 'bench', why: 'it tried to cross a boundary 3 times this week' } })])} />);
    const sc = await screen.findByLabelText('Scorecards');
    expect(sc.textContent).toMatch(/3 tasks done · 4 of 4 runs passed checks/);
    expect(sc.textContent).toMatch(/Bench it: it tried to cross a boundary 3 times/);
  });

  it('says plainly when there is nothing, shows text as text, and says when the server cannot be reached', async () => {
    const { unmount } = render(<TalentView client={client(room({ bakeoffs: [], hires: [], catalog: [], policy: { level: 'H1', rosterCap: 20, trialBudgetCapUsd: 5, active: 0 } }), [])} />);
    expect(await screen.findByText(/No bake-off has run yet/)).toBeTruthy();
    expect(screen.getByText(/Nobody is proposed for hire/)).toBeTruthy();
    expect(screen.getByText(/Nothing is imported yet/)).toBeTruthy();
    expect(screen.getByText(/inside the mandate starts on trial by itself/)).toBeTruthy();
    unmount();
    render(<TalentView client={client(room({ hires: [{ approvalId: 'x', status: 'pending', name: '<img src=x onerror=alert(1)>', department: 'outreach' }] }))} />);
    expect((await screen.findByLabelText('Hires')).querySelector('img')).toBeNull();
    cleanup();
    render(<TalentView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from the job board in the world and from a link', () => {
    expect(OBJECT_PANELS.jobboard).toMatchObject({ panel: 'talent', ready: true });
    expect(panelFor('jobboard')!.panel).toBe('talent');
    expect(PANEL_IDS as readonly string[]).toContain('talent');
    expect(panelHref('talent')).toBe('/?panel=talent');
    expect(parsePanel('?panel=talent')).toEqual({ id: 'talent' });
  });
});
