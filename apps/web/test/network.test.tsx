// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OBJECT_PANELS, panelFor } from '@conclave/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkView, type NetworkClient } from '../components/NetworkView';
import type { NetworkPerson } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const person = (over: Partial<NetworkPerson> = {}): NetworkPerson => ({ id: 'p1', name: 'Priya Rao', whereFound: 'https://example.test/priya', note: 'Founder of a booking tool for clinics.', status: 'new', lastTouch: null, nextNudge: null, drafts: [], ...over });
const client = (rows: NetworkPerson[] | Error, sent = vi.fn(async () => ({ ok: true }))): NetworkClient & { sentByYou: typeof sent } => ({ people: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)), sentByYou: sent });

describe('the Founder Network panel (S8-11b)', () => {
  it('lists each person with their note, where they were found, and their state', async () => {
    render(<NetworkView client={client([person(), person({ id: 'p2', name: 'Sam Lee', status: 'in_touch', nextNudge: '2026-12-01', lastTouch: '2026-11-15T10:00:00Z' })])} />);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Priya Rao')).toBeTruthy();
    expect(cards[0]!.textContent).toMatch(/Founder of a booking tool/);
    expect(cards[1]!.textContent).toMatch(/In touch/);
    expect(cards[1]!.textContent).toMatch(/nudge on 2026-12-01/);
  });

  it('shows a draft with only one action: "I sent this myself", which records it and changes nothing else', async () => {
    const c = client([person({ drafts: [{ id: 'd1', text: 'Hi Priya, short call?', status: 'draft' }] })]);
    render(<NetworkView client={c} />);
    expect(await screen.findByText('Hi Priya, short call?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I sent this myself' }));
    await waitFor(() => expect(c.sentByYou).toHaveBeenCalledWith('d1', 14));
  });

  it('says a draft you already sent was sent by you, with no button', async () => {
    render(<NetworkView client={client([person({ drafts: [{ id: 'd1', text: 'Sent text', status: 'sent_by_you' }] })])} />);
    expect(await screen.findByText('You sent this.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows text as text, says plainly when there is nobody, and when the server cannot be reached', async () => {
    const { unmount } = render(<NetworkView client={client([person({ name: '<img src=x onerror=alert(1)>' })])} />);
    expect((await screen.findByRole('article')).querySelector('img')).toBeNull();
    unmount();
    render(<NetworkView client={client([])} />);
    expect(await screen.findByText(/Nobody in the network yet/)).toBeTruthy();
    cleanup();
    render(<NetworkView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from the board in the Hall and from a link', () => {
    expect(panelFor('network-board')).toMatchObject({ panel: 'network', ready: true });
    expect(OBJECT_PANELS['network-board'].label).toBe('Founder Network');
    expect(PANEL_IDS as readonly string[]).toContain('network');
    expect(panelHref('network')).toBe('/?panel=network');
    expect(parsePanel('?panel=network')).toEqual({ id: 'network' });
  });
});
