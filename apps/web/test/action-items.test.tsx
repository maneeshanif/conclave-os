// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionItems, type ActionItemsClient } from '../components/ActionItems';
import type { ActionItem } from '../lib/api';

afterEach(cleanup);

const item = (id: string, over: Partial<ActionItem> = {}): ActionItem => ({
  id,
  kind: 'question',
  title: 'A question from outreach-rep',
  body: 'Which city should I start with?',
  status: 'open',
  task_id: 't1',
  approval_id: null,
  created_at: '2026-11-12T10:00:00Z',
  ...over,
});

function fakeClient(initial: ActionItem[]) {
  let list = [...initial];
  const client = {
    actionItems: vi.fn(async () => list),
    resolve: vi.fn(async (id: string) => {
      list = list.filter((i) => i.id !== id);
      return { id, status: 'done' };
    }),
  } satisfies ActionItemsClient;
  return { client, set: (n: ActionItem[]) => (list = n) };
}
const noLive = () => () => undefined;
const rows = () => within(screen.getByRole('list', { name: 'action items' })).getAllByRole('listitem');

describe('action items page (S1-9)', () => {
  it('lists what needs you, with the question and what kind of thing it is', async () => {
    render(<ActionItems client={fakeClient([item('a')]).client} onEvents={noLive} />);
    const row = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(row).getByText('A question from outreach-rep')).toBeTruthy();
    expect(within(row).getByText('Which city should I start with?')).toBeTruthy();
    expect(within(row).getByText('question')).toBeTruthy();
  });

  it('says so when there is nothing', async () => {
    render(<ActionItems client={fakeClient([]).client} onEvents={noLive} />);
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
  });

  it('resolves a recorded item with a note, and it leaves the list', async () => {
    const { client } = fakeClient([item('a'), item('b', { title: 'Other' })]);
    render(<ActionItems client={client} onEvents={noLive} />);
    await screen.findAllByRole('listitem');
    fireEvent.change(within(rows()[0]!).getByLabelText('Note (optional)'), { target: { value: 'Lahore.' } });
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(client.resolve).toHaveBeenCalledWith('a', 'Lahore.');
  });

  it('tells you answering does not restart the task', async () => {
    render(<ActionItems client={fakeClient([item('a')]).client} onEvents={noLive} />);
    const row = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(row).getByText(/does not restart/i)).toBeTruthy();
  });

  it('shows a derived item with no button, because it clears itself', async () => {
    const derived = item('kill-switch', { kind: 'kill_switch', title: 'The kill switch is on', body: 'Everything is stopped.', task_id: null, derived: true });
    render(<ActionItems client={fakeClient([derived]).client} onEvents={noLive} />);
    const row = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(row).getByText('The kill switch is on')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('ignores a double click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = fakeClient([item('a')]);
    client.resolve.mockImplementation(async (id: string) => {
      await gate;
      return { id, status: 'done' };
    });
    render(<ActionItems client={client} onEvents={noLive} />);
    const button = within((await screen.findAllByRole('listitem'))[0]!).getByRole('button', { name: 'Mark done' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(client.resolve).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(client.resolve).toHaveBeenCalledTimes(1));
  });

  it('shows the reason and refreshes when it was already resolved', async () => {
    const { client, set } = fakeClient([item('a')]);
    client.resolve.mockImplementation(async () => {
      set([]);
      throw new Error('This item was already resolved.');
    });
    render(<ActionItems client={client} onEvents={noLive} />);
    fireEvent.click(within((await screen.findAllByRole('listitem'))[0]!).getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText(/already resolved/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nothing needs you right now.')).toBeTruthy());
  });

  it('refreshes on action_item.changed, task.changed and settings.changed, and ignores other events', async () => {
    const { client } = fakeClient([]);
    let push: (m: { kind: string }) => void = () => undefined;
    render(<ActionItems client={client} onEvents={(cb) => ((push = cb), () => undefined)} />);
    await screen.findByText('Nothing needs you right now.');
    for (const kind of ['action_item.changed', 'task.changed', 'settings.changed']) {
      const n = client.actionItems.mock.calls.length;
      push({ kind });
      await waitFor(() => expect(client.actionItems.mock.calls.length).toBe(n + 1));
    }
    const n = client.actionItems.mock.calls.length;
    push({ kind: 'run.event' });
    await new Promise((r) => setTimeout(r, 50));
    expect(client.actionItems.mock.calls.length).toBe(n);
  });

  it('tells you when the server cannot be reached', async () => {
    const client = { actionItems: vi.fn(async () => Promise.reject(new Error('fetch failed'))), resolve: vi.fn() } satisfies ActionItemsClient;
    render(<ActionItems client={client} onEvents={noLive} />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
  });
});
