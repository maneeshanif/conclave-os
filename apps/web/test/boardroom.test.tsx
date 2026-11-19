// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardroomView, type BoardroomClient } from '../components/BoardroomView';
import type { LiveMessage } from '../lib/live';

afterEach(cleanup);

const discussions = [
  { id: 'd1', kind: 'adhoc', question: 'Should we pause cold email?', status: 'open', opened_by: 'founder', participants: ['scout', 'closer'], opened_at: '2026-11-16T10:00:00Z', closed_at: null, turns: 2 },
  { id: 'd2', kind: 'weekly', question: 'Weekly review', status: 'closed', opened_by: 'agent:scout', participants: [], opened_at: '2026-11-09T10:00:00Z', closed_at: '2026-11-09T11:00:00Z', turns: 0 },
];
const turns = [
  { id: 't1', speaker: 'scout', round: 1, body: 'Twelve tasks are still to do.', evidence: [{ type: 'count', table: 'tasks', where: { column: 'status', value: 'todo' }, claimed: 12 }], disagreements: null, at: '2026-11-16T10:05:00Z' },
  { id: 't2', speaker: 'closer', round: 1, body: 'Options: pause, or carry on.', evidence: [{ type: 'record', table: 'leads', id: '11111111-1111-4111-8111-111111111111' }], disagreements: 'Scout wants to pause; Closer wants to carry on.', at: '2026-11-16T10:06:00Z' },
];
const decisions = [
  { id: 'x1', discussion_id: 'd1', title: 'No weekend sends', decision: 'Nothing goes out on Saturday or Sunday.', owner: 'Outreach', due: '2026-12-01', decided_by: 'founder', decided_at: '2026-11-16T12:00:00Z' },
  { id: 'x2', discussion_id: null, title: 'Keep the sequence', decision: 'Three steps.', owner: null, due: null, decided_by: 'founder', decided_at: '2026-11-10T12:00:00Z' },
];
const client = (over: Partial<BoardroomClient> = {}): BoardroomClient => ({
  discussions: vi.fn(async () => ({ discussions })),
  discussion: vi.fn(async (id: string) => ({ discussion: discussions.find((d) => d.id === id)!, turns: id === 'd1' ? turns : [] })),
  open: vi.fn(async () => ({ id: 'new' })),
  close: vi.fn(async () => undefined),
  decisions: vi.fn(async () => ({ decisions })),
  decide: vi.fn(async () => ({ id: 'dx' })),
  agents: vi.fn(async () => [{ key: 'scout', name: 'Scout' }, { key: 'closer', name: 'Closer' }]),
  ...over,
});
const live = () => {
  let fn: (m: LiveMessage) => void = () => undefined;
  return { onEvents: (f: (m: LiveMessage) => void) => ((fn = f), () => undefined), send: (m: LiveMessage) => fn(m) };
};

describe('the Boardroom page (S6-10)', () => {
  it('lists the discussions, open ones first, with who each is for and how many turns it has', async () => {
    render(<BoardroomView client={client()} onEvents={live().onEvents} />);
    const list = await screen.findByRole('list', { name: /discussions/i });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/Should we pause cold email\?/);
    expect(items[0]!.textContent).toMatch(/Open/);
    expect(items[0]!.textContent).toMatch(/2 turns/);
    expect(items[0]!.textContent).toMatch(/scout, closer/i);
    expect(items[1]!.textContent).toMatch(/Closed/);
    expect(items[1]!.textContent).toMatch(/everyone|any agent/i);
  });

  it('says so when there are no discussions and no decisions', async () => {
    render(<BoardroomView client={client({ discussions: vi.fn(async () => ({ discussions: [] })), decisions: vi.fn(async () => ({ decisions: [] })) })} onEvents={live().onEvents} />);
    expect(await screen.findByText(/no discussions yet/i)).toBeTruthy();
    expect(screen.getByText(/no decisions recorded yet/i)).toBeTruthy();
  });

  it('opens a discussion and shows its turns, each with what it cited, and where the leads disagree', async () => {
    const c = client();
    render(<BoardroomView client={c} onEvents={live().onEvents} />);
    fireEvent.click(await screen.findByRole('button', { name: /Should we pause cold email\?/ }));
    const thread = await screen.findByRole('region', { name: /discussion/i });
    expect(c.discussion).toHaveBeenCalledWith('d1');
    expect(within(thread).getByText(/Twelve tasks are still to do/)).toBeTruthy();
    expect(within(thread).getByText(/12 tasks where status = todo/)).toBeTruthy();
    expect(within(thread).getByText(/leads record/i)).toBeTruthy();
    expect(within(thread).getByText(/Scout wants to pause; Closer wants to carry on/)).toBeTruthy();
    expect(within(thread).getAllByText(/Round 1/).length).toBeGreaterThan(0);
  });

  it('can close an open discussion, and not one that is already closed', async () => {
    const c = client();
    render(<BoardroomView client={c} onEvents={live().onEvents} />);
    fireEvent.click(await screen.findByRole('button', { name: /Should we pause cold email\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: /close discussion/i }));
    await waitFor(() => expect(c.close).toHaveBeenCalledWith('d1'));
    fireEvent.click(await screen.findByRole('button', { name: /Weekly review/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /close discussion/i })).toBeNull());
  });

  it('opens a new discussion for the agents you pick, or for everyone, and clears the form', async () => {
    const c = client();
    render(<BoardroomView client={c} onEvents={live().onEvents} />);
    await screen.findByRole('list', { name: /discussions/i });
    const form = screen.getByRole('form', { name: /open a discussion/i });
    const open = within(form).getByRole('button', { name: /^open$/i }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/question/i), { target: { value: ' Where should we focus? ' } });
    fireEvent.click(await within(form).findByLabelText('Scout'));
    fireEvent.click(open);
    await waitFor(() => expect(c.open).toHaveBeenCalledWith({ kind: 'adhoc', question: 'Where should we focus?', participants: ['scout'] }));
    await waitFor(() => expect((within(form).getByLabelText(/question/i) as HTMLTextAreaElement).value).toBe(''));
    fireEvent.change(within(form).getByLabelText(/question/i), { target: { value: 'For all' } });
    fireEvent.change(within(form).getByLabelText(/kind/i), { target: { value: 'weekly' } });
    fireEvent.click(within(form).getByRole('button', { name: /^open$/i }));
    await waitFor(() => expect(c.open).toHaveBeenLastCalledWith({ kind: 'weekly', question: 'For all' }));
  });

  it('lists the decisions newest first, with owner and date', async () => {
    render(<BoardroomView client={client()} onEvents={live().onEvents} />);
    const log = await screen.findByRole('list', { name: /decision log/i });
    const items = within(log).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/No weekend sends/);
    expect(items[0]!.textContent).toMatch(/Outreach/);
    expect(items[0]!.textContent).toMatch(/2026-12-01/);
    expect(items[1]!.textContent).toMatch(/Keep the sequence/);
  });

  it('records a decision you make, with an owner and a date if you give them', async () => {
    const c = client();
    render(<BoardroomView client={c} onEvents={live().onEvents} />);
    await screen.findByRole('list', { name: /decision log/i });
    const form = screen.getByRole('form', { name: /record a decision/i });
    const save = within(form).getByRole('button', { name: /^record$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText(/title/i), { target: { value: 'Pause Fridays' } });
    fireEvent.change(within(form).getByLabelText(/decision/i, { selector: 'textarea' }), { target: { value: 'No sends on Friday.' } });
    fireEvent.change(within(form).getByLabelText(/owner/i), { target: { value: 'Outreach' } });
    fireEvent.change(within(form).getByLabelText(/due/i), { target: { value: '2026-12-15' } });
    fireEvent.click(save);
    await waitFor(() => expect(c.decide).toHaveBeenCalledWith({ title: 'Pause Fridays', decision: 'No sends on Friday.', owner: 'Outreach', due: '2026-12-15' }));
  });

  it('shows the reason when something cannot be saved', async () => {
    const c = client({ decide: vi.fn(async () => Promise.reject(new Error('That is not a real date.'))) });
    render(<BoardroomView client={c} onEvents={live().onEvents} />);
    await screen.findByRole('list', { name: /decision log/i });
    const form = screen.getByRole('form', { name: /record a decision/i });
    fireEvent.change(within(form).getByLabelText(/title/i), { target: { value: 'T' } });
    fireEvent.change(within(form).getByLabelText(/decision/i, { selector: 'textarea' }), { target: { value: 'D' } });
    fireEvent.click(within(form).getByRole('button', { name: /^record$/i }));
    expect(await within(form).findByText(/not a real date/)).toBeTruthy();
  });

  it('looks again when a discussion changes, and says plainly when the server cannot be reached', async () => {
    const l = live();
    const c = client();
    render(<BoardroomView client={c} onEvents={l.onEvents} />);
    await screen.findByRole('list', { name: /discussions/i });
    const n = (c.discussions as ReturnType<typeof vi.fn>).mock.calls.length;
    l.send({ kind: 'discussion.changed' });
    await waitFor(() => expect((c.discussions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n + 1));
    cleanup();
    render(<BoardroomView client={client({ discussions: vi.fn(async () => Promise.reject(new Error('down'))) })} onEvents={live().onEvents} />);
    expect(await screen.findByText(/cannot load the boardroom/i)).toBeTruthy();
  });
});
