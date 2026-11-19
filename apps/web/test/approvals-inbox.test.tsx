// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsInbox, type InboxClient } from '../components/ApprovalsInbox';
import type { Approval } from '../lib/api';

afterEach(cleanup);

const email = (id: string, over: Partial<Approval> = {}): Approval => ({
  id,
  kind: 'email.send',
  status: 'pending',
  agent_id: 'a1',
  agent_key: 'outreach-outreach-rep',
  task_id: null,
  payload: { leadId: 'l1', to: 'dana@clinic.test', subject: 'A homepage concept', body: 'Hi Dana, I saw your booking page asks for a phone call first.', step: 1 },
  edited_payload: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  result: null,
  created_at: '2026-11-12T10:00:00Z',
  lead: { id: 'l1', business_name: 'Glow Clinic', website: 'https://glow.test', email: 'dana@clinic.test', stage: 'new', notes: 'Booking page asks for a phone call first. Verified.' },
  ...over,
});

/** A server that holds a list and drops what is decided, like the real one. */
function fakeClient(initial: Approval[]) {
  let list = [...initial];
  const client = {
    approvals: vi.fn(async () => list),
    decide: vi.fn(async (id: string) => {
      list = list.filter((a) => a.id !== id);
      return { id, status: 'approved' };
    }),
  } satisfies InboxClient;
  return { client, set: (next: Approval[]) => (list = next) };
}
const noLive = () => () => undefined;
const cards = () => within(screen.getByRole('list', { name: 'pending approvals' })).getAllByRole('listitem');

describe('the approvals inbox (S1-8)', () => {
  it('shows an email for what it is: who it goes to, the full message, and what it rests on', async () => {
    const { client } = fakeClient([email('e1')]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(card).getByText('Glow Clinic')).toBeTruthy();
    expect(within(card).getByText('dana@clinic.test')).toBeTruthy();
    expect((within(card).getByLabelText('Subject') as HTMLInputElement).value).toBe('A homepage concept');
    expect((within(card).getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Hi Dana, I saw your booking page asks for a phone call first.');
    // The findings the email rests on, and the site they came from.
    expect(within(card).getByText(/Booking page asks for a phone call first\. Verified\./)).toBeTruthy();
    expect(within(card).getByText('https://glow.test')).toBeTruthy();
    expect(within(card).getByText(/outreach-outreach-rep/)).toBeTruthy(); // who proposed it
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('shows a clear empty state when nothing is waiting', async () => {
    render(<ApprovalsInbox client={fakeClient([]).client} onEvents={noLive} />);
    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
  });

  it('asks only for pending approvals', async () => {
    const { client } = fakeClient([email('e1')]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    await screen.findAllByRole('listitem');
    expect(client.approvals).toHaveBeenCalledWith('pending');
  });

  it('approves as written: no edit is sent, and the card leaves the list', async () => {
    const { client } = fakeClient([email('e1'), email('e2', { payload: { leadId: 'l2', to: 'sam@spa.test', subject: 'Other', body: 'Other body', step: 1 } })]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    await screen.findAllByRole('listitem');
    expect(cards()).toHaveLength(2);
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(client.decide).toHaveBeenCalledTimes(1);
    expect(client.decide).toHaveBeenCalledWith('e1', { approved: true });
    expect(within(cards()[0]!).getByText('sam@spa.test')).toBeTruthy(); // the other card is untouched
  });

  it('approves with the edits: the changed subject and message go with the decision', async () => {
    const { client } = fakeClient([email('e1')]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.change(within(card).getByLabelText('Subject'), { target: { value: 'A better subject' } });
    fireEvent.change(within(card).getByLabelText('Message'), { target: { value: 'A kinder, shorter note.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(client.decide).toHaveBeenCalled());
    expect(client.decide).toHaveBeenCalledWith('e1', { approved: true, editedPayload: { subject: 'A better subject', body: 'A kinder, shorter note.' } });
  });

  it('does not send an edit when the text was changed and then put back', async () => {
    const { client } = fakeClient([email('e1')]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.change(within(card).getByLabelText('Subject'), { target: { value: 'Changed' } });
    fireEvent.change(within(card).getByLabelText('Subject'), { target: { value: 'A homepage concept' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(client.decide).toHaveBeenCalled());
    expect(client.decide).toHaveBeenCalledWith('e1', { approved: true });
  });

  it('rejects, with the reason if one was written, and the card leaves the list', async () => {
    const { client } = fakeClient([email('e1')]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.change(within(card).getByLabelText('Note (optional)'), { target: { value: 'Too pushy.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByText('Nothing is waiting for you.')).toBeTruthy());
    expect(client.decide).toHaveBeenCalledWith('e1', { approved: false, note: 'Too pushy.' });
  });

  it('cannot be decided twice by a double click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = fakeClient([email('e1')]);
    client.decide.mockImplementation(async (id: string) => {
      await gate;
      return { id, status: 'approved' };
    });
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    const approve = within(card).getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(client.decide).toHaveBeenCalledTimes(1);
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(client.decide).toHaveBeenCalledTimes(1));
  });

  it('says so, and refreshes, when someone already decided it', async () => {
    const { client, set } = fakeClient([email('e1')]);
    client.decide.mockImplementation(async () => {
      set([]); // it was decided somewhere else in the meantime
      throw new Error('This approval was already decided (it is approved).');
    });
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/already decided/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nothing is waiting for you.')).toBeTruthy());
  });

  it('keeps the card and shows the reason when the server refuses an edit', async () => {
    const { client } = fakeClient([email('e1')]);
    client.decide.mockRejectedValue(new Error('An edit can change only the subject and the body.'));
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.change(within(card).getByLabelText('Message'), { target: { value: 'x' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/only the subject and the body/)).toBeTruthy();
    expect(cards()).toHaveLength(1);
    expect((within(cards()[0]!).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false); // can try again
  });

  it('updates by itself when the server says an approval changed', async () => {
    const { client, set } = fakeClient([email('e1')]);
    let push: (m: { kind: string }) => void = () => undefined;
    render(
      <ApprovalsInbox
        client={client}
        onEvents={(cb) => {
          push = cb;
          return () => undefined;
        }}
      />,
    );
    await screen.findAllByRole('listitem');
    set([email('e1'), email('e3', { payload: { leadId: 'l3', to: 'new@lead.test', subject: 'Fresh', body: 'Fresh body', step: 1 } })]);
    push({ kind: 'approval.changed' });
    expect(await screen.findByText('new@lead.test')).toBeTruthy();
    set([]);
    push({ kind: 'approval.changed' });
    await waitFor(() => expect(screen.getByText('Nothing is waiting for you.')).toBeTruthy());
    const calls = client.approvals.mock.calls.length;
    push({ kind: 'task.changed' }); // not about approvals: no refetch
    await new Promise((r) => setTimeout(r, 50));
    expect(client.approvals.mock.calls.length).toBe(calls);
  });

  it('stops listening when it goes away', async () => {
    const unsubscribe = vi.fn();
    const { unmount } = render(<ApprovalsInbox client={fakeClient([]).client} onEvents={() => unsubscribe} />);
    await screen.findByText('Nothing is waiting for you.');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('shows any other kind of approval plainly, to approve or reject as it is, with nothing to edit', async () => {
    const other: Approval = { ...email('p1'), kind: 'post.publish', payload: { text: 'We shipped a thing.', account: '@conclave' }, lead: undefined };
    const { client } = fakeClient([other]);
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    const card = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(card).getByText('post.publish')).toBeTruthy();
    expect(within(card).getByText(/We shipped a thing\./)).toBeTruthy();
    expect(within(card).queryByLabelText('Subject')).toBeNull();
    expect(within(card).queryByLabelText('Message')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(client.decide).toHaveBeenCalledWith('p1', { approved: true }));
  });

  it('tells the person when the server cannot be reached', async () => {
    const client = { approvals: vi.fn(async () => Promise.reject(new Error('fetch failed'))), decide: vi.fn() } satisfies InboxClient;
    render(<ApprovalsInbox client={client} onEvents={noLive} />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
  });
});
