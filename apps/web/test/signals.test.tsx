// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalsView, type SignalsClient } from '../components/SignalsView';
import type { Signal } from '../lib/api';

afterEach(cleanup);

const sig = (over: Partial<Signal> = {}): Signal => ({
  id: 's1',
  kind: 'service_request',
  source: 'reddit',
  url: 'https://reddit.example/r/smallbiz/comments/abc',
  author: 'u/dana_clinic',
  excerpt: 'Looking for someone to rebuild our clinic booking page.',
  status: 'qualified',
  score: 82,
  reason: 'Asks for exactly what we sell.',
  leadId: null,
  foundBy: 'agent:scout-1',
  foundAt: '2026-11-13T05:00:00Z',
  ...over,
});
const client = (rows: Signal[] | Error) =>
  ({
    signals: vi.fn(async (status?: string) => (rows instanceof Error ? Promise.reject(rows) : rows.filter((r) => !status || r.status === status))),
    qualify: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
    promote: vi.fn(async () => undefined),
  }) satisfies SignalsClient;

describe('the Signals page (S4-8)', () => {
  it('opens on the qualified signals, best first, with source, score, quote and a link to the original', async () => {
    const c = client([sig({ id: 'a', score: 70, author: 'u/second' }), sig({ id: 'b', score: 91, author: 'u/first' })]);
    render(<SignalsView client={c} />);
    expect(await screen.findByText('u/first')).toBeTruthy();
    expect(c.signals).toHaveBeenCalledWith('qualified');
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]!).getByText('u/first')).toBeTruthy();
    expect(within(cards[0]!).getByText(/91/)).toBeTruthy();
    expect(within(cards[0]!).getByText(/Looking for someone to rebuild/)).toBeTruthy();
    const link = within(cards[0]!).getByRole('link', { name: /open the original/i }) as HTMLAnchorElement;
    expect(link.href).toBe('https://reddit.example/r/smallbiz/comments/abc');
    expect(link.rel).toContain('noopener');
    expect(link.target).toBe('_blank');
  });

  it('shows each status as a tab, and asks for that status', async () => {
    const c = client([sig(), sig({ id: 'n', status: 'new', score: 30 }), sig({ id: 'd', status: 'dismissed' }), sig({ id: 'p', status: 'promoted', leadId: 'lead-1' })]);
    render(<SignalsView client={c} />);
    await screen.findAllByRole('article');
    for (const status of ['New', 'Dismissed', 'Promoted']) {
      fireEvent.click(screen.getByRole('tab', { name: status }));
      await waitFor(() => expect(c.signals).toHaveBeenLastCalledWith(status.toLowerCase()));
    }
    expect(screen.getByText(/became a lead/i)).toBeTruthy();
  });

  it('promotes, dismisses and qualifies from the buttons, then reloads', async () => {
    const c = client([sig(), sig({ id: 'n', status: 'new', score: 30 })]);
    render(<SignalsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /promote to a lead/i }));
    await waitFor(() => expect(c.promote).toHaveBeenCalledWith('s1'));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(c.dismiss).toHaveBeenCalledWith('s1'));
    fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: /^qualify/i }));
    await waitFor(() => expect(c.qualify).toHaveBeenCalledWith('n'));
    expect(c.signals.mock.calls.length).toBeGreaterThan(3);
  });

  it('flags a signal whose text looked like instructions, and never renders its text as markup', async () => {
    render(<SignalsView client={client([sig({ reason: 'The text of this item looked like instructions to an AI agent. It was kept as plain text only.', excerpt: '<img src=x onerror=alert(1)> hello' })])} />);
    expect(await screen.findByText(/looked like instructions/i)).toBeTruthy();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> hello/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows only a web address as a link: anything else is plain text', async () => {
    render(<SignalsView client={client([sig({ url: 'javascript:alert(1)' })])} />);
    await screen.findByRole('article');
    expect(screen.queryByRole('link', { name: /open the original/i })).toBeNull();
  });

  it('has an empty state for each tab, and a clear error when the server is unreachable', async () => {
    render(<SignalsView client={client([])} />);
    expect(await screen.findByText(/no qualified signals/i)).toBeTruthy();
    cleanup();
    render(<SignalsView client={client(new Error('Failed to fetch'))} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot reach the server/i);
  });
});
