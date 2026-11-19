import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeEmail } from '../src/actions/email';
import type { EmailTransport, OutgoingEmail } from '../src/actions/transport';
import { createApp } from '../src/app';
import { Bus, type BusMessage } from '../src/bus';
import type { Database } from '../src/db';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

class CountingTransport implements EmailTransport {
  name = 'counting';
  sent: OutgoingEmail[] = [];
  async send(m: OutgoingEmail) {
    this.sent.push(m);
    return { ref: `counting:${m.id}` };
  }
}

const COMPANY_MD = '# Co\n\n## Cold email footer\nCo, 12 Main Street, Lahore 54000\n';
let db: Database;
let sys: System;
let app: ReturnType<typeof createApp>;
let companyRoot: string;
const bus = new Bus();
const messages: BusMessage[] = [];
const decided: { workspaceId: string; approvalId: string; approved: boolean }[] = [];
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ db, sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-appr-co-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY_MD);
  bus.subscribe((m) => messages.push(m));
  app = createApp({
    pool: sys.app,
    workspaceId: ws(),
    tokens: new RunTokens(),
    store: new MemoryOsStore(),
    bus,
    dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })),
    onApprovalDecided: async (e) => void decided.push(e),
  });
}, 180_000);
afterAll(async () => sys?.close());

const json = { 'content-type': 'application/json' };
const get = (p: string) => app.request(p);
const decide = (id: string, body: unknown) => app.request(`/api/approvals/${id}/decide`, { method: 'POST', headers: json, body: JSON.stringify(body) });

async function newEmailApproval(over: { status?: string; payload?: Record<string, unknown>; kind?: string } = {}) {
  const email = `dana-${randomUUID().slice(0, 8)}@clinic.test`;
  const lead = (await sql("insert into leads (workspace_id, business_name, website, email, notes) values ($1, 'Glow Clinic', 'https://glow.test', $2, 'Booking page asks for a phone call first.') returning id", [ws(), email])).rows[0].id as string;
  const payload = { leadId: lead, to: email, subject: 'A homepage concept', body: 'Hi Dana, I saw your booking page.', step: 1, ...over.payload };
  const id = (
    await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, $2, $3, $4, $5) returning id", [
      ws(),
      over.kind ?? 'email.send',
      `t:${randomUUID()}`,
      JSON.stringify(payload),
      over.status ?? 'pending',
    ])
  ).rows[0].id as string;
  await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status) values ($1, $2, $3, $4, 's', 'b', 'queued')", [ws(), lead, id, email]);
  return { id, lead, email, payload };
}
const row = async (id: string) =>
  (await sql('select status, payload, edited_payload, decided_by, decided_at, decision_note from approvals where id = $1', [id])).rows[0] as {
    status: string;
    payload: Record<string, unknown>;
    edited_payload: Record<string, unknown> | null;
    decided_by: string | null;
    decided_at: Date | null;
    decision_note: string | null;
  };

describe('listing and reading approvals (S1-2)', () => {
  it('lists newest first, filters by status, and shows the lead an email rests on', async () => {
    const older = await newEmailApproval();
    const newer = await newEmailApproval();
    await newEmailApproval({ status: 'rejected' });
    const res = await get('/api/approvals?status=pending');
    expect(res.status).toBe(200);
    const list = (await res.json()) as { id: string; status: string; kind: string; lead?: { business_name: string; notes: string; email: string } }[];
    expect(list.every((a) => a.status === 'pending')).toBe(true);
    const ids = list.map((a) => a.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const card = list.find((a) => a.id === newer.id)!;
    expect(card.kind).toBe('email.send');
    expect(card.lead).toMatchObject({ business_name: 'Glow Clinic', notes: 'Booking page asks for a phone call first.', email: newer.email });
  });

  it('accepts several statuses and refuses one that does not exist', async () => {
    const both = (await (await get('/api/approvals?status=pending,rejected')).json()) as { status: string }[];
    expect(new Set(both.map((a) => a.status))).toEqual(new Set(['pending', 'rejected']));
    expect((await get('/api/approvals?status=bogus')).status).toBe(400);
  });

  it('reads one approval, with its payload', async () => {
    const a = await newEmailApproval();
    const one = (await (await get(`/api/approvals/${a.id}`)).json()) as { id: string; payload: { subject: string } };
    expect(one).toMatchObject({ id: a.id, payload: { subject: 'A homepage concept' } });
  });

  it('answers 404 for an id that does not exist, a malformed id, and another workspace\'s approval', async () => {
    expect((await get(`/api/approvals/${randomUUID()}`)).status).toBe(404);
    expect((await get('/api/approvals/not-a-uuid')).status).toBe(404);
    const theirs = await db.withOwner(async (c) => {
      const w = await c.query("insert into workspaces (name, slug) values ('Other', $1) returning id", [`other-${randomUUID().slice(0, 8)}`]);
      const r = await c.query("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, 'email.send', 'x', '{}') returning id", [w.rows[0].id]);
      return r.rows[0].id as string;
    });
    expect((await get(`/api/approvals/${theirs}`)).status).toBe(404);
    expect((await decide(theirs, { approved: true })).status).toBe(404);
    expect(((await (await get('/api/approvals')).json()) as { id: string }[]).map((a) => a.id)).not.toContain(theirs);
  });
});

describe('deciding (S1-2)', () => {
  it('approving moves it to approved, records who and when and why, tells the inbox, and calls the gate once, after the commit', async () => {
    const a = await newEmailApproval();
    messages.length = 0;
    decided.length = 0;
    const res = await decide(a.id, { approved: true, note: 'Looks right.' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: a.id, status: 'approved' });
    const r = await row(a.id);
    expect(r).toMatchObject({ status: 'approved', decided_by: 'founder', decision_note: 'Looks right.' });
    expect(r.decided_at).toBeInstanceOf(Date);
    expect(messages).toContainEqual({ kind: 'approval.changed', workspaceId: ws(), approvalId: a.id, status: 'approved' });
    expect(decided).toEqual([{ workspaceId: ws(), approvalId: a.id, approved: true }]);
    const audit = await sql("select actor, action from audit_log where subject = $1 and action = 'approval.decided'", [a.id]);
    expect(audit.rows).toEqual([{ actor: 'founder', action: 'approval.decided' }]);
  });

  it('approving does not send anything by itself: only the gate runs the executor', async () => {
    const a = await newEmailApproval();
    const t = new CountingTransport();
    await decide(a.id, { approved: true });
    expect(t.sent).toHaveLength(0);
    expect((await row(a.id)).status).toBe('approved'); // waiting for the gate, not executed
  });

  it('rejecting moves it to rejected, closes its queued message, and the executor can never claim it', async () => {
    const a = await newEmailApproval();
    decided.length = 0;
    expect((await decide(a.id, { approved: false, note: 'Too pushy.' })).status).toBe(200);
    expect(await row(a.id)).toMatchObject({ status: 'rejected', decision_note: 'Too pushy.' });
    const m = await sql('select status from outreach_messages where approval_id = $1', [a.id]);
    expect(m.rows[0].status).toBe('rejected');
    expect(decided).toEqual([{ workspaceId: ws(), approvalId: a.id, approved: false }]);

    const t = new CountingTransport();
    const out = await executeEmail({ pool: sys.app, workspaceId: ws(), transport: t, companyRoot, from: 'x <x@example.test>' }, a.id);
    expect(out).toEqual({ status: 'already_claimed' });
    expect(t.sent).toHaveLength(0);
  });

  it('refuses to decide twice, and never flips a decision either way', async () => {
    const a = await newEmailApproval();
    expect((await decide(a.id, { approved: true })).status).toBe(200);
    decided.length = 0;
    const again = await decide(a.id, { approved: true });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ status: 'approved' });
    expect((await decide(a.id, { approved: false })).status).toBe(409);
    expect((await row(a.id)).status).toBe('approved');

    const b = await newEmailApproval();
    await decide(b.id, { approved: false });
    expect((await decide(b.id, { approved: true })).status).toBe(409);
    expect((await row(b.id)).status).toBe('rejected');
    // The gate heard only the one real decision (b's rejection), and nothing from the refused calls.
    expect(decided).toEqual([{ workspaceId: ws(), approvalId: b.id, approved: false }]);
  });

  it('two decisions at the same moment: one wins, the other is refused, and the gate hears once', async () => {
    const a = await newEmailApproval();
    decided.length = 0;
    const results = await Promise.all([decide(a.id, { approved: true }), decide(a.id, { approved: false }), decide(a.id, { approved: true })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(decided).toHaveLength(1);
    expect(['approved', 'rejected']).toContain((await row(a.id)).status);
  });

  it('refuses an approval that has expired, failed or been executed', async () => {
    for (const status of ['expired', 'failed', 'executed', 'executing']) {
      const a = await newEmailApproval({ status });
      expect((await decide(a.id, { approved: true })).status, status).toBe(409);
      expect((await row(a.id)).status).toBe(status);
    }
  });

  it('validates the request', async () => {
    const a = await newEmailApproval();
    expect((await decide(a.id, {})).status).toBe(400);
    expect((await decide(a.id, { approved: 'yes' })).status).toBe(400);
    expect((await decide(a.id, { approved: true, note: 'x'.repeat(2001) })).status).toBe(400);
    const wrongType = await app.request(`/api/approvals/${a.id}/decide`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ approved: true }) });
    expect(wrongType.status).toBe(415);
    expect((await row(a.id)).status).toBe('pending');
  });
});

describe('editing the email on the card (S1-2)', () => {
  it('stores the edit, leaves the original, and the executor sends the edited text', async () => {
    const a = await newEmailApproval();
    const res = await decide(a.id, { approved: true, editedPayload: { subject: 'A better subject', body: 'A kinder, shorter note.' } });
    expect(res.status).toBe(200);
    const r = await row(a.id);
    expect(r.payload).toMatchObject({ subject: 'A homepage concept' }); // the proposal is kept as proposed
    expect(r.edited_payload).toMatchObject({ leadId: a.lead, to: a.email, subject: 'A better subject', body: 'A kinder, shorter note.', step: 1 });

    const t = new CountingTransport();
    await executeEmail({ pool: sys.app, workspaceId: ws(), transport: t, companyRoot, from: 'x <x@example.test>' }, a.id);
    expect(t.sent[0]).toMatchObject({ subject: 'A better subject' });
    expect(t.sent[0]!.text).toContain('A kinder, shorter note.');
  });

  it('cannot change who the email goes to, which lead it is for, or which step it is', async () => {
    const a = await newEmailApproval();
    for (const change of [{ to: 'attacker@evil.test' }, { leadId: randomUUID() }, { step: 2 }]) {
      const res = await decide(a.id, { approved: true, editedPayload: { subject: 's', body: 'b', ...change } });
      expect(res.status, JSON.stringify(change)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/recipient|lead|step|only the subject and the body/i);
    }
    expect((await row(a.id)).status).toBe('pending'); // a refused edit decides nothing
    expect((await row(a.id)).edited_payload).toBeNull();
  });

  it('refuses an edit that is empty or too long', async () => {
    const a = await newEmailApproval();
    expect((await decide(a.id, { approved: true, editedPayload: { subject: '', body: 'b' } })).status).toBe(400);
    expect((await decide(a.id, { approved: true, editedPayload: { subject: 's', body: 'x'.repeat(5001) } })).status).toBe(400);
    expect((await row(a.id)).status).toBe('pending');
  });

  it('refuses an edit to a kind of approval that has no editable card, but approves it without one', async () => {
    const other = await newEmailApproval({ kind: 'post.publish' });
    expect((await decide(other.id, { approved: true, editedPayload: { text: 'x' } })).status).toBe(400);
    expect((await row(other.id)).status).toBe('pending');
    expect((await decide(other.id, { approved: true })).status).toBe(200);
  });

  it('an edit on a rejection is ignored, not stored', async () => {
    const a = await newEmailApproval();
    expect((await decide(a.id, { approved: false, editedPayload: { subject: 's', body: 'b' } })).status).toBe(200);
    expect((await row(a.id)).edited_payload).toBeNull();
  });
});
