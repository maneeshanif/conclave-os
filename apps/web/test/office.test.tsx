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

  it('gives every object a button that opens its panel, and says "coming" for one with no page yet', async () => {
    const open = vi.fn();
    render(<OfficeView client={client()} onPanel={open} />);
    await screen.findByRole('heading', { name: 'Outreach' });
    for (const [name, id] of [
      [/Approvals inbox/, 'approvals'],
      [/Goal ladder/, 'goals'],
      [/Health dashboard/, 'health'],
      [/^Inbox$/, 'inbox'],
      [/^Boardroom$/, 'boardroom'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(open).toHaveBeenLastCalledWith(id);
    }
    expect(open).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('button', { name: /Talent room/ })).toBeNull();
    expect(screen.getByText(/Talent room/).textContent).toMatch(/coming/i);
  });

  it('says an agent that is handing a task on is doing so, and lists it under the room of the desk it is standing at', async () => {
    const handing: OfficePlace[] = [{ agentId: 'a1', key: 'scout', place: 'handoff', reason: 'Handing a task to Closer.', x: 2, y: 2 }, places[1]!];
    render(<OfficeView client={client({ state: vi.fn(async () => handing) })} />);
    const scout = await screen.findByRole('button', { name: /Scout/ });
    expect(scout.textContent).toMatch(/Handing over a task/);
    expect(scout.textContent).toMatch(/Handing a task to Closer/);
  });

  it('gives each department room a Board and a Channel button for that department, and leaves them out of the row of things', async () => {
    const open = vi.fn();
    const rooms = { ...facts, map: { ...facts.map, objects: [...facts.map.objects, { type: 'dept-board' as const, name: 'Outreach board', x: 1, y: 2 }, { type: 'dept-table' as const, name: 'Outreach table', x: 3, y: 2 }] } };
    render(<OfficeView client={client({ office: vi.fn(async () => rooms) })} onPanel={open} />);
    const section = (await screen.findByRole('heading', { name: 'Outreach' })).closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: /^board$/i }));
    expect(open).toHaveBeenLastCalledWith('department-board', { dept: 'outreach' });
    fireEvent.click(within(section).getByRole('button', { name: /^channel$/i }));
    expect(open).toHaveBeenLastCalledWith('department-meeting', { dept: 'outreach' });
    expect(within(screen.getByRole('region', { name: 'Things in the office' })).queryByText(/Department board|Meeting table/)).toBeNull();
    // A room that is not a department's has neither.
    const lounge = screen.getByRole('heading', { name: 'Lounge' }).closest('section')!;
    expect(within(lounge).queryByRole('button', { name: /^board$/i })).toBeNull();
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
