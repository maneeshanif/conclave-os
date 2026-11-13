// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficeView, type OfficeClient } from '../components/OfficeView';
import type { OfficeFacts, OfficePlace } from '../lib/api';

afterEach(cleanup);

const facts: OfficeFacts = {
  map: {
    width: 40,
    height: 24,
    tile: 32,
    rooms: [
      { name: 'Outreach', kind: 'department', department: 'outreach', x: 0, y: 0, w: 5, h: 5, maxUsers: null, locked: false, silent: false, focusable: false },
      { name: 'Boardroom', kind: 'boardroom', department: null, x: 6, y: 0, w: 5, h: 5, maxUsers: 8, locked: false, silent: false, focusable: false },
      { name: 'Lounge', kind: 'lounge', department: null, x: 12, y: 0, w: 5, h: 5, maxUsers: null, locked: false, silent: false, focusable: false },
    ],
    desks: [],
    objects: [
      { type: 'approvals-desk', name: 'Approvals', x: 1, y: 1 },
      { type: 'whiteboard', name: 'Goals', x: 2, y: 1 },
      { type: 'screen', name: 'Health', x: 3, y: 1 },
      { type: 'mailbox', name: 'Inbox', x: 4, y: 1 },
      { type: 'jobboard', name: 'Jobs', x: 5, y: 1 },
      { type: 'boardroom-table', name: 'Table', x: 6, y: 1 },
    ],
    entries: [],
    walls: [],
  },
  agents: [
    { id: 'a1', key: 'scout', name: 'Scout', department: 'outreach', status: 'active', room: 'Outreach', desk: 1 },
    { id: 'a2', key: 'closer', name: 'Closer', department: 'outreach', status: 'active', room: 'Outreach', desk: 2 },
  ],
};
const places: OfficePlace[] = [
  { agentId: 'a1', key: 'scout', place: 'desk', reason: 'Working on a task.', x: 1, y: 1 },
  { agentId: 'a2', key: 'closer', place: 'approvals', reason: 'Waiting for you to decide.', x: 2, y: 2 },
];
const drawerOf = (id: string) => ({ agent: { id, key: 'scout', name: 'Scout', department: 'outreach', status: 'active' }, run: { id: 'r1', status: 'running' }, tasks: [{ id: 't1', title: 'Find leads', status: 'todo' }] });
const client = (over: Partial<OfficeClient> = {}) =>
  ({
    office: vi.fn(async () => facts),
    state: vi.fn(async () => places),
    drawer: vi.fn(async (id: string) => drawerOf(id)),
    message: vi.fn(async () => undefined),
    live: vi.fn(() => () => undefined),
    ...over,
  }) satisfies OfficeClient;

describe('the plain office (S6-8)', () => {
  it('lists every room, and each agent where it is with the reason', async () => {
    render(<OfficeView client={client()} />);
    for (const r of ['Outreach', 'Boardroom', 'Lounge']) expect(await screen.findByRole('heading', { name: r })).toBeTruthy();
    const scout = screen.getByRole('button', { name: /Scout/ });
    expect(scout.textContent).toMatch(/Working on a task/);
    expect(screen.getByRole('button', { name: /Closer/ }).textContent).toMatch(/Waiting for you to decide/);
  });

  it('gives every object a button to its panel, and says "coming" for one with no page yet', async () => {
    render(<OfficeView client={client()} />);
    await screen.findByRole('heading', { name: 'Outreach' });
    expect(screen.getByRole('link', { name: /Approvals inbox/ }).getAttribute('href')).toBe('/approvals');
    expect(screen.getByRole('link', { name: /Goal ladder/ }).getAttribute('href')).toBe('/goals');
    expect(screen.getByRole('link', { name: /Health dashboard/ }).getAttribute('href')).toBe('/health');
    expect(screen.getByRole('link', { name: /Inbox/ }).getAttribute('href')).toBe('/inbox');
    expect(screen.queryByRole('link', { name: /Talent room/ })).toBeNull();
    expect(screen.getByText(/Talent room/).textContent).toMatch(/coming/i);
    expect(screen.getByText(/Boardroom$/, { selector: 'span' }).textContent).toMatch(/coming/i);
  });

  it('opens the drawer for an agent: its run, its open tasks, and a box that sends a message', async () => {
    const c = client();
    render(<OfficeView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Scout/ }));
    const d = await screen.findByRole('region', { name: /Scout/ });
    expect(within(d).getByText(/running/i)).toBeTruthy();
    expect(within(d).getByText('Find leads')).toBeTruthy();
    fireEvent.change(within(d).getByRole('textbox'), { target: { value: 'Find five more leads' } });
    fireEvent.click(within(d).getByRole('button', { name: /send/i }));
    await waitFor(() => expect(c.message).toHaveBeenCalledWith('a1', 'Find five more leads'));
  });

  it('does not send an empty message, and closes the drawer on request', async () => {
    const c = client();
    render(<OfficeView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /Scout/ }));
    const d = await screen.findByRole('region', { name: /Scout/ });
    expect((within(d).getByRole('button', { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(d).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('region', { name: /Scout/ })).toBeNull();
  });

  it('looks again when the server says the office changed', async () => {
    let onMsg: (m: { kind: string }) => void = () => undefined;
    const c = client({ live: vi.fn((fn) => ((onMsg = fn), () => undefined)) });
    render(<OfficeView client={c} />);
    await screen.findByRole('heading', { name: 'Outreach' });
    const before = (c.state as ReturnType<typeof vi.fn>).mock.calls.length;
    onMsg({ kind: 'office.changed' });
    await waitFor(() => expect((c.state as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1));
    onMsg({ kind: 'task.changed' });
    expect((c.state as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it('says plainly when the server cannot be reached', async () => {
    render(<OfficeView client={client({ office: vi.fn(async () => Promise.reject(new Error('down'))) })} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });
});
