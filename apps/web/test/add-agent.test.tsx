// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddAgent, type AgentClient } from '../components/AddAgent';
import { ApprovalsInbox, type InboxClient } from '../components/ApprovalsInbox';
import { OfficeBar } from '../components/OfficeBar';
import type { Approval } from '../lib/api';

afterEach(cleanup);

const departments = [
  { key: 'outreach', name: 'Outreach' },
  { key: 'research', name: 'Research' },
];
const client = (over: Partial<AgentClient> = {}): AgentClient => ({
  templates: vi.fn(async () => ['researcher', 'writer']),
  propose: vi.fn(async () => ({ approvalId: 'ap1', id: 'outreach-researcher' })),
  ...over,
});

describe('adding an agent from the world (S6-13c)', () => {
  it('offers the departments and the templates, with the first of each chosen, and an optional name', async () => {
    render(<AddAgent client={client()} departments={departments} onOpenApprovals={() => undefined} onCancel={() => undefined} />);
    const d = screen.getByRole('dialog', { name: /add an agent/i });
    await within(d).findByRole('option', { name: 'researcher' });
    expect(within(d).getAllByRole('option').map((o) => o.textContent)).toEqual(['Outreach', 'Research', 'researcher', 'writer']);
    expect((within(d).getByRole('button', { name: /^propose$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(d).getByLabelText(/name/i)).toBeTruthy();
  });

  it('proposes it, says it is waiting for approval, and does not add anything itself', async () => {
    const c = client();
    const open = vi.fn();
    render(<AddAgent client={c} departments={departments} onOpenApprovals={open} onCancel={() => undefined} />);
    await screen.findByRole('option', { name: 'writer' });
    fireEvent.change(screen.getByLabelText(/department/i), { target: { value: 'research' } });
    fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 'writer' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: ' Scribe ' } });
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    await waitFor(() => expect(c.propose).toHaveBeenCalledWith({ department: 'research', template: 'writer', name: 'Scribe' }));
    expect(await screen.findByText(/waiting for your approval/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /open approvals/i }));
    expect(open).toHaveBeenCalled();
  });

  it('leaves the name out when it is empty', async () => {
    const c = client();
    render(<AddAgent client={c} departments={departments} onOpenApprovals={() => undefined} onCancel={() => undefined} />);
    await screen.findByRole('option', { name: 'writer' });
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    await waitFor(() => expect(c.propose).toHaveBeenCalledWith({ department: 'outreach', template: 'researcher' }));
  });

  it('shows the reason when it cannot be proposed, and can be tried again', async () => {
    const c = client({ propose: vi.fn(async () => Promise.reject(new Error('There is no agent template "x".'))) });
    render(<AddAgent client={c} departments={departments} onOpenApprovals={() => undefined} onCancel={() => undefined} />);
    await screen.findByRole('option', { name: 'writer' });
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    expect(await screen.findByText(/no agent template/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^propose$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('proposes once if pressed twice, and says plainly when the templates cannot be loaded', async () => {
    let finish: () => void = () => undefined;
    const c = client({ propose: vi.fn(() => new Promise<{ approvalId: string; id: string }>((r) => (finish = () => r({ approvalId: 'a', id: 'b' })))) });
    render(<AddAgent client={c} departments={departments} onOpenApprovals={() => undefined} onCancel={() => undefined} />);
    await screen.findByRole('option', { name: 'writer' });
    const go = screen.getByRole('button', { name: /^propose$/i });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(c.propose).toHaveBeenCalledTimes(1);
    finish();
    cleanup();
    render(<AddAgent client={client({ templates: vi.fn(async () => Promise.reject(new Error('down'))) })} departments={departments} onOpenApprovals={() => undefined} onCancel={() => undefined} />);
    expect(await screen.findByText(/cannot load the templates/i)).toBeTruthy();
  });

  it('is reached from the Tools menu', () => {
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onAddAgent={open} />);
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /add an agent/i }));
    expect(open).toHaveBeenCalled();
  });
});

const proposal = (over: Partial<Approval> = {}): Approval => ({
  id: 'p1',
  kind: 'agent.create',
  status: 'pending',
  agent_id: null,
  agent_key: null,
  task_id: null,
  payload: { department: 'outreach', template: 'researcher', name: 'Scout', id: 'outreach-researcher' },
  edited_payload: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  result: null,
  created_at: '2026-11-15T10:00:00Z',
  ...over,
});

describe('the approval card for a new agent (S6-13c)', () => {
  it('says in plain words which agent would be added where, and can be approved or rejected', async () => {
    const decide = vi.fn(async (id: string) => ({ id, status: 'approved' }));
    const inbox = { approvals: vi.fn(async () => [proposal()]), decide } satisfies InboxClient;
    render(<ApprovalsInbox client={inbox} onEvents={() => () => undefined} />);
    const card = await screen.findByRole('listitem');
    expect(within(card).getByRole('heading', { name: /add an agent/i })).toBeTruthy();
    expect(card.textContent).toMatch(/Scout/);
    expect(card.textContent).toMatch(/outreach/i);
    expect(card.textContent).toMatch(/researcher/);
    expect(card.textContent).not.toMatch(/"template"/); // not raw JSON
    fireEvent.click(within(card).getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('p1', { approved: true }));
  });

  it('names the agent from its id when no name was given', async () => {
    const inbox = { approvals: vi.fn(async () => [proposal({ payload: { department: 'research', template: 'writer', id: 'research-writer' } })]), decide: vi.fn() } satisfies InboxClient;
    render(<ApprovalsInbox client={inbox} onEvents={() => () => undefined} />);
    expect((await screen.findByRole('listitem')).textContent).toMatch(/research-writer/);
  });
});
