// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { OBJECT_PANELS, panelFor } from '@conclave/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsView, type MeetingsClient } from '../components/MeetingsView';
import type { Meeting } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const meeting = (over: Partial<Meeting> = {}): Meeting => ({ id: 'm1', title: 'Kickoff with Glow Clinic', startsAt: '2026-12-01T10:00:00Z', status: 'planned', room: null, dealId: null, invites: 2, ...over });
const client = (rows: Meeting[] | Error): MeetingsClient => ({ meetings: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)) });

describe('the Meetings panel (S10-3)', () => {
  it('lists each meeting with its state and how many guest links are live, and never shows a link', async () => {
    render(<MeetingsView client={client([meeting(), meeting({ id: 'm2', title: 'Review', status: 'open', room: 'local-m2', invites: 1, dealId: 'd1' })])} />);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Kickoff with Glow Clinic')).toBeTruthy();
    expect(within(cards[0]!).getByText('Planned')).toBeTruthy();
    expect(cards[0]!.textContent).toMatch(/2 live guest links/);
    expect(within(cards[1]!).getByText('Room open')).toBeTruthy();
    expect(cards[1]!.textContent).toMatch(/1 live guest link\b/);
    expect(cards[1]!.textContent).toMatch(/on a deal/);
    expect(document.body.innerHTML).not.toMatch(/\/meet\//);
  });

  it('shows text as text, says plainly when there is nothing, and when the server cannot be reached', async () => {
    const { unmount } = render(<MeetingsView client={client([meeting({ title: '<img src=x onerror=alert(1)>' })])} />);
    expect((await screen.findByRole('article')).querySelector('img')).toBeNull();
    unmount();
    render(<MeetingsView client={client([])} />);
    expect(await screen.findByText(/No client meetings yet/)).toBeTruthy();
    cleanup();
    render(<MeetingsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from the board in the Meeting Centre reception and from a link', () => {
    expect(panelFor('meetings-board')).toMatchObject({ panel: 'meetings', ready: true });
    expect(OBJECT_PANELS['meetings-board'].label).toBe('Client meetings');
    expect(PANEL_IDS as readonly string[]).toContain('meetings');
    expect(panelHref('meetings')).toBe('/?panel=meetings');
    expect(parsePanel('?panel=meetings')).toEqual({ id: 'meetings' });
  });
});
