// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepartmentBoard, DepartmentChannel, type DepartmentClient } from '../components/DepartmentPanels';
import type { LiveMessage } from '../lib/live';

afterEach(cleanup);

const board = {
  department: { key: 'outreach', name: 'Outreach' },
  agents: [
    { key: 'scout', name: 'Scout', status: 'active' },
    { key: 'closer', name: 'Closer', status: 'active' },
  ],
  tasks: [
    { id: 't1', title: 'Check the replies', status: 'in_progress', priority: 3, blocked_reason: null, created_at: '2026-11-15T10:00:00Z', assignee_key: 'closer', assignee_name: 'Closer' },
    { id: 't2', title: 'Nobody has this yet', status: 'blocked', priority: 3, blocked_reason: 'Waiting on a price', created_at: '2026-11-15T09:00:00Z', assignee_key: null, assignee_name: null },
    { id: 't3', title: 'Write the follow-up', status: 'todo', priority: 3, blocked_reason: null, created_at: '2026-11-15T08:00:00Z', assignee_key: 'scout', assignee_name: 'Scout' },
    { id: 't4', title: 'Needs your yes', status: 'waiting_approval', priority: 3, blocked_reason: null, created_at: '2026-11-15T07:00:00Z', assignee_key: 'scout', assignee_name: 'Scout' },
  ],
};
const channel = {
  messages: [
    { id: 'm1', author: 'founder', body: 'Please keep replies short.', created_at: '2026-11-15T10:00:00Z' },
    { id: 'm2', author: 'agent:scout', body: 'On it.', created_at: '2026-11-15T10:01:00Z' },
  ],
};
const client = (over: Partial<DepartmentClient> = {}): DepartmentClient => ({
  board: vi.fn(async () => board),
  channel: vi.fn(async () => channel),
  say: vi.fn(async () => undefined),
  ...over,
});
const live = () => {
  let fn: (m: LiveMessage) => void = () => undefined;
  return { onEvents: (f: (m: LiveMessage) => void) => ((fn = f), () => undefined), send: (m: LiveMessage) => fn(m) };
};

describe('a department board (S6-13d)', () => {
  it('shows the department\'s name, its agents, and its open tasks by state with who has each', async () => {
    render(<DepartmentBoard dept="outreach" client={client()} onEvents={live().onEvents} />);
    expect(await screen.findByRole('heading', { name: 'Outreach' })).toBeTruthy();
    const people = screen.getByRole('list', { name: /agents/i });
    expect(within(people).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['Scout', 'Closer']);
    const groups = ['In progress', 'Waiting for you', 'Blocked', 'To do'];
    for (const g of groups) expect(screen.getByRole('heading', { name: g })).toBeTruthy();
    const inProgress = screen.getByRole('region', { name: 'In progress' });
    expect(inProgress.textContent).toMatch(/Check the replies/);
    expect(inProgress.textContent).toMatch(/Closer/);
    expect(screen.getByRole('region', { name: 'Blocked' }).textContent).toMatch(/Nobody has this yet.*unassigned|unassigned.*Nobody has this yet/s);
    expect(screen.getByRole('region', { name: 'Blocked' }).textContent).toMatch(/Waiting on a price/);
    expect(screen.getByRole('region', { name: 'To do' }).textContent).toMatch(/Write the follow-up/);
  });

  it('says so when there is nothing open, and when the department cannot be found', async () => {
    render(<DepartmentBoard dept="outreach" client={client({ board: vi.fn(async () => ({ ...board, tasks: [] })) })} onEvents={live().onEvents} />);
    expect(await screen.findByText(/nothing is open/i)).toBeTruthy();
    cleanup();
    render(<DepartmentBoard dept="nowhere" client={client({ board: vi.fn(async () => Promise.reject(new Error('Not found'))) })} onEvents={live().onEvents} />);
    expect(await screen.findByText(/cannot load this department/i)).toBeTruthy();
  });

  it('looks again when a task, a run or an approval changes', async () => {
    const l = live();
    const c = client();
    render(<DepartmentBoard dept="outreach" client={c} onEvents={l.onEvents} />);
    await screen.findByRole('heading', { name: 'Outreach' });
    const n = (c.board as ReturnType<typeof vi.fn>).mock.calls.length;
    l.send({ kind: 'task.changed' });
    await waitFor(() => expect((c.board as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n + 1));
    l.send({ kind: 'settings.changed' });
    expect((c.board as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n + 1);
  });
});

describe('a department channel (S6-13d)', () => {
  it('shows the messages oldest first, with who said each (you, or the agent)', async () => {
    render(<DepartmentChannel dept="outreach" client={client()} onEvents={live().onEvents} />);
    const list = await screen.findByRole('list', { name: /messages/i });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/You/);
    expect(items[0]!.textContent).toMatch(/Please keep replies short/);
    expect(items[1]!.textContent).toMatch(/scout/);
    expect(items[1]!.textContent).not.toMatch(/agent:/);
  });

  it('sends what you write, clears the box, and shows the channel again', async () => {
    const c = client();
    render(<DepartmentChannel dept="outreach" client={c} onEvents={live().onEvents} />);
    await screen.findByRole('list', { name: /messages/i });
    const send = screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: ' Thanks both ' } });
    fireEvent.click(send);
    await waitFor(() => expect(c.say).toHaveBeenCalledWith('outreach', 'Thanks both'));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('says plainly when it is empty and when a message cannot be sent', async () => {
    render(<DepartmentChannel dept="outreach" client={client({ channel: vi.fn(async () => ({ messages: [] })), say: vi.fn(async () => Promise.reject(new Error('Write a message of up to 2000 characters.'))) })} onEvents={live().onEvents} />);
    expect(await screen.findByText(/no messages yet/i)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(await screen.findByText(/up to 2000 characters/)).toBeTruthy();
  });

  it('shows a new message when the department\'s channel changes, and ignores another department\'s', async () => {
    const l = live();
    const c = client();
    render(<DepartmentChannel dept="outreach" client={c} onEvents={l.onEvents} />);
    await screen.findByRole('list', { name: /messages/i });
    const n = (c.channel as ReturnType<typeof vi.fn>).mock.calls.length;
    l.send({ kind: 'department.changed', department: 'research' });
    expect((c.channel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n);
    l.send({ kind: 'department.changed', department: 'outreach' });
    await waitFor(() => expect((c.channel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n + 1));
  });
});
