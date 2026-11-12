import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutors } from '../src/actions';
import { executeEmail, recoverApprovals, type ExecutorDeps } from '../src/actions/email';
import { OutboxTransport, type EmailTransport, type OutgoingEmail } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import type { Database } from '../src/db';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const COMPANY_MD = `# Test Co

Our first build is $2,500.

## Cold email footer
Test Co
12 Main Street, Lahore 54000, Pakistan

## People
x
`;

/** Counts sends instead of making them. Can be told to fail. */
class CountingTransport implements EmailTransport {
  name = 'counting';
  sent: OutgoingEmail[] = [];
  failWith?: Error;
  async send(m: OutgoingEmail) {
    if (this.failWith) throw this.failWith;
    this.sent.push(m);
    return { ref: `counting:${m.id}` };
  }
}

let db: Database;
let sys: System;
let companyRoot: string;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));

beforeAll(async () => {
  ({ db, sys } = await testSystem());
  companyRoot = await mkdtemp(path.join(tmpdir(), 'conclave-co-md-'));
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY_MD);
  await agentNew(sys, { template: 'researcher', department: 'research' });
}, 180_000);
afterAll(async () => sys?.close());

beforeEach(async () => {
  await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do update set kill_switch = 0, email_daily_cap = 1000, window_hours = 5, window_cap = 100000', [ws()]);
  await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY_MD);
});

async function newLead(over: { email?: string | null; stage?: string } = {}): Promise<string> {
  const email = over.email === undefined ? `dana-${randomUUID().slice(0, 8)}@clinic.test` : over.email;
  const r = await sql("insert into leads (workspace_id, business_name, email, stage) values ($1, 'Clinic', $2, $3) returning id", [ws(), email, over.stage ?? 'new']);
  return r.rows[0].id;
}
const emailOf = async (leadId: string): Promise<string> => (await sql('select email from leads where id = $1', [leadId])).rows[0].email;

async function newApproval(leadId: string, over: { status?: string; payload?: Record<string, unknown>; edited?: Record<string, unknown>; to?: string } = {}): Promise<string> {
  const to = over.to ?? (await emailOf(leadId));
  const payload = { leadId, to, subject: 'A homepage concept', body: 'Hi Dana, I saw your booking page asks for a phone call first.', step: 1, ...over.payload };
  const r = await sql(
    `insert into approvals (workspace_id, kind, dedupe_key, payload, edited_payload, status, decided_at)
     values ($1, 'email.send', $2, $3, $4, $5, now()) returning id`,
    [ws(), `t:${randomUUID()}`, JSON.stringify(payload), over.edited ? JSON.stringify(over.edited) : null, over.status ?? 'approved'],
  );
  const id = r.rows[0].id as string;
  await sql("insert into outreach_messages (workspace_id, lead_id, approval_id, to_address, subject, body, status) values ($1, $2, $3, $4, 's', 'b', 'queued')", [ws(), leadId, id, to]);
  return id;
}

const approval = async (id: string) => (await sql('select status, result from approvals where id = $1', [id])).rows[0] as { status: string; result: Record<string, unknown> | null };
const message = async (id: string) => (await sql('select status, external_ref from outreach_messages where approval_id = $1', [id])).rows[0] as { status: string; external_ref: string | null };
const items = async (id: string) => (await sql('select kind from action_items where approval_id = $1 order by created_at', [id])).rows.map((r) => r.kind as string);
const stageOf = async (leadId: string) => (await sql('select stage from leads where id = $1', [leadId])).rows[0].stage as string;

function deps(transport: EmailTransport, over: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return { pool: sys.app, workspaceId: ws(), transport, companyRoot, from: 'Anees <hello@example.test>', ...over };
}

describe('the email executor (SPEC 6)', () => {
  it('sends an approved email once, to the lead on record, with the footer and an unsubscribe header', async () => {
    const t = new CountingTransport();
    const lead = await newLead();
    const id = await newApproval(lead);
    const out = await executeEmail(deps(t), id);
    expect(out).toEqual({ status: 'executed', ref: `counting:${id}` });
    expect(t.sent).toHaveLength(1);
    const m = t.sent[0]!;
    expect(m.to).toBe(await emailOf(lead));
    expect(m.text).toContain('Hi Dana');
    expect(m.text).toContain('12 Main Street, Lahore 54000, Pakistan'); // the footer
    expect(m.headers['List-Unsubscribe']).toBe('<mailto:hello@example.test?subject=unsubscribe>');
    expect(m.headers['X-Conclave-Approval']).toBe(id);
    expect((await approval(id)).status).toBe('executed');
    expect(await message(id)).toMatchObject({ status: 'sent', external_ref: `counting:${id}` });
    expect(await stageOf(lead)).toBe('contacted');
    const audit = await sql("select action from audit_log where subject = $1 and actor = 'executor:email'", [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['approval.executed']);
  });

  it('writes to the outbox and nowhere else when the outbox is the transport', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'conclave-ob-')), 'outbox');
    const id = await newApproval(await newLead());
    expect((await executeEmail(deps(new OutboxTransport(dir)), id)).status).toBe('executed');
    expect(await readdir(dir)).toEqual([`${id}.eml`]);
    expect(await readFile(path.join(dir, `${id}.eml`), 'utf8')).toContain('Hi Dana');
  });

  it('claims the approval once: a second call finds nothing to claim and sends nothing', async () => {
    const t = new CountingTransport();
    const id = await newApproval(await newLead());
    expect((await executeEmail(deps(t), id)).status).toBe('executed');
    expect(await executeEmail(deps(t), id)).toEqual({ status: 'already_claimed' });
    expect(t.sent).toHaveLength(1);
  });

  it('two executors racing for one approval send exactly once', async () => {
    const t = new CountingTransport();
    const id = await newApproval(await newLead());
    const results = await Promise.all([executeEmail(deps(t), id), executeEmail(deps(t), id), executeEmail(deps(t), id)]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_claimed', 'already_claimed', 'executed']);
    expect(t.sent).toHaveLength(1);
  });

  it('createExecutors serialises calls for one approval and they share one result', async () => {
    const t = new CountingTransport();
    const id = await newApproval(await newLead());
    const ex = createExecutors(deps(t));
    const [a, b] = await Promise.all([ex.run(id), ex.run(id)]);
    expect(a).toEqual(b);
    expect(a.status).toBe('executed');
    expect(t.sent).toHaveLength(1);
  });

  it('does not touch an approval that is not approved, or is not an email', async () => {
    const t = new CountingTransport();
    for (const status of ['pending', 'rejected', 'expired', 'executed', 'failed', 'executing']) {
      const id = await newApproval(await newLead(), { status });
      expect(await executeEmail(deps(t), id), status).toEqual({ status: 'already_claimed' });
      expect((await approval(id)).status).toBe(status);
    }
    const other = await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'post.publish', 'x', '{}', 'approved') returning id", [ws()]);
    expect(await executeEmail(deps(t), other.rows[0].id)).toEqual({ status: 'already_claimed' });
    expect(t.sent).toHaveLength(0);
  });

  it('sends the text as edited on the card, not the original', async () => {
    const t = new CountingTransport();
    const lead = await newLead();
    const id = await newApproval(lead, { edited: { leadId: lead, to: await emailOf(lead), subject: 'Edited subject', body: 'Edited body.', step: 1 } });
    await executeEmail(deps(t), id);
    expect(t.sent[0]).toMatchObject({ subject: 'Edited subject' });
    expect(t.sent[0]!.text).toContain('Edited body.');
    expect(t.sent[0]!.text).not.toContain('Hi Dana');
  });

  describe('every check runs again at send time, because the world changes between proposal and approval', () => {
    const cases: [string, () => Promise<string>, RegExp][] = [
      ['the lead no longer exists', async () => newApproval(await newLead(), { payload: { leadId: randomUUID() } }), /lead no longer exists/],
      ['the address is not the lead on record (prompt injection or a bad edit)', async () => newApproval(await newLead(), { to: 'attacker@evil.test' }), /does not match the lead/],
      ['the lead was marked do not contact after the proposal', async () => newApproval(await newLead({ stage: 'do_not_contact' })), /do not contact/],
      ['the address was suppressed after the proposal', async () => {
        const lead = await newLead();
        await sql("insert into suppression (workspace_id, value) values ($1, $2)", [ws(), (await emailOf(lead)).toUpperCase()]);
        return newApproval(lead);
      }, /suppression list/],
      ['the whole domain was suppressed', async () => {
        const lead = await newLead({ email: 'owner@blocked-domain.test' });
        await sql("insert into suppression (workspace_id, value) values ($1, '@blocked-domain.test')", [ws()]);
        return newApproval(lead);
      }, /suppression list/],
      ['the text makes a medical claim', async () => newApproval(await newLead(), { payload: { body: 'We offer guaranteed results.' } }), /blocked claims.*medical/],
      ['the text quotes a price that is not in COMPANY.md', async () => newApproval(await newLead(), { payload: { body: 'Only $99 this week.' } }), /price not in COMPANY\.md/],
      ['the payload is malformed', async () => newApproval(await newLead(), { payload: { to: 'not-an-email' } }), /bad payload/],
    ];
    for (const [name, make, reason] of cases) {
      it(`refuses, and sends nothing, when ${name}`, async () => {
        const t = new CountingTransport();
        const id = await make();
        const out = await executeEmail(deps(t), id);
        expect(out.status).toBe('refused');
        expect((out as { reason: string }).reason).toMatch(reason);
        expect(t.sent).toHaveLength(0);
        expect((await approval(id)).status).toBe('failed');
        expect(await message(id)).toMatchObject({ status: 'refused' });
        // A person is told, once.
        if (name !== 'the payload is malformed') expect(await items(id)).toEqual(['executor_failed']);
      });
    }

    it('refuses while the footer in COMPANY.md still has a placeholder address', async () => {
      await writeFile(path.join(companyRoot, 'COMPANY.md'), COMPANY_MD.replace('12 Main Street, Lahore 54000, Pakistan', 'TODO fill in the address'));
      const t = new CountingTransport();
      const id = await newApproval(await newLead());
      const out = await executeEmail(deps(t), id);
      expect(out).toMatchObject({ status: 'refused', reason: expect.stringMatching(/footer.*placeholder/) });
      expect(t.sent).toHaveLength(0);
    });

  });

  describe('the send caps hold an email, they do not fail it (S1-5)', () => {
    const resetCaps = async (windowHours = 5, windowCap = 1000, daily = 1000) => {
      // An email left mid-send by an earlier test would count against the cap, as it should; start clean.
      await sql("update approvals set status = 'failed' where kind = 'email.send' and status = 'executing'");
      await sql('update workspace_settings set window_hours = $1, window_cap = $2, email_daily_cap = $3, kill_switch = 0', [windowHours, windowCap, daily]);
    };
    /** Records n emails as already sent, `hoursAgo` hours back, for follow-ups too (step > 1). */
    async function alreadySent(n: number, hoursAgo: number, step = 1) {
      const lead = await newLead();
      for (let i = 0; i < n; i++) {
        await sql("insert into outreach_messages (workspace_id, lead_id, channel, step, status, sent_at) values ($1, $2, 'email', $3, 'sent', now() - ($4 || ' minutes')::interval)", [ws(), lead, step, String(Math.round(hoursAgo * 60))]);
      }
    }
    const clearSent = () => sql("delete from outreach_messages where status = 'sent'");

    it('holds the 31st email inside five hours, leaves it approved and unclaimed, and sends it once the window has moved', async () => {
      await clearSent();
      await resetCaps(5, 30, 1000);
      await alreadySent(30, 1);
      const t = new CountingTransport();
      const id = await newApproval(await newLead());
      const held = await executeEmail(deps(t), id);
      expect(held).toMatchObject({ status: 'held', reason: expect.stringMatching(/30 emails in 5 hours/) });
      expect(t.sent).toHaveLength(0);
      expect((await approval(id)).status).toBe('approved'); // not claimed, not failed
      expect(await items(id)).toEqual([]); // nothing for a person to do: it will go by itself
      // It opens when the oldest of the 30 leaves the five-hour window, 4 hours from now.
      const until = (held as { until: Date }).until.getTime();
      expect(until - Date.now()).toBeGreaterThan(3.9 * 3600_000);
      expect(until - Date.now()).toBeLessThan(4.1 * 3600_000);

      // The window moves: the 30 were sent six hours ago instead.
      await sql("update outreach_messages set sent_at = now() - interval '6 hours' where status = 'sent'");
      expect((await executeEmail(deps(t), id)).status).toBe('executed');
      expect(t.sent).toHaveLength(1);
    });

    it('counts follow-ups in the same window as first emails', async () => {
      await clearSent();
      await resetCaps(5, 3, 1000);
      await alreadySent(2, 1, 1);
      await alreadySent(1, 1, 3); // a third follow-up
      const t = new CountingTransport();
      expect((await executeEmail(deps(t), await newApproval(await newLead()))).status).toBe('held');
      expect(t.sent).toHaveLength(0);
    });

    it('does not count what failed or was refused', async () => {
      await clearSent();
      await resetCaps(5, 2, 1000);
      const lead = await newLead();
      await sql("insert into outreach_messages (workspace_id, lead_id, status, sent_at) values ($1, $2, 'failed', now()), ($1, $2, 'refused', now()), ($1, $2, 'queued', now())", [ws(), lead]);
      const t = new CountingTransport();
      expect((await executeEmail(deps(t), await newApproval(await newLead()))).status).toBe('executed');
    });

    it("holds until tomorrow when today's limit is reached, whatever the window says", async () => {
      await clearSent();
      await resetCaps(5, 1000, 2);
      await alreadySent(2, 8); // sent this morning, long before the five hours
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const t = new CountingTransport();
      const out = await executeEmail(deps(t, { now: () => new Date(Date.now()) }), await newApproval(await newLead()));
      // "Eight hours ago" may fall on yesterday if it is early in the day; the cap only bites for today's sends.
      if (out.status === 'held') {
        expect((out as { reason: string }).reason).toMatch(/today's limit of 2/);
        expect((out as { until: Date }).until.getTime()).toBe(midnight.getTime());
        expect(t.sent).toHaveLength(0);
      } else {
        expect(new Date().getHours()).toBeLessThan(8);
      }
    });

    it('lets a burst of parallel sends through only as far as the cap, because the check and the claim are one step', async () => {
      await clearSent();
      await resetCaps(5, 2, 1000);
      const t = new CountingTransport();
      const ids = await Promise.all(Array.from({ length: 6 }, async () => newApproval(await newLead())));
      const results = await Promise.all(ids.map((id) => executeEmail(deps(t), id)));
      expect(results.filter((r) => r.status === 'executed')).toHaveLength(2);
      expect(results.filter((r) => r.status === 'held')).toHaveLength(4);
      expect(t.sent).toHaveLength(2);
      // The four held ones are still approved, in the order they were decided, ready to go when there is room.
      const stillApproved = (await sql("select count(*)::int as n from approvals where id = any($1) and status = 'approved'", [ids])).rows[0].n;
      expect(stillApproved).toBe(4);
    });

    it('counts an email that is mid-send, so it cannot be overtaken', async () => {
      await clearSent();
      await resetCaps(5, 1, 1000);
      await newApproval(await newLead(), { status: 'executing' });
      const t = new CountingTransport();
      const out = await executeEmail(deps(t), await newApproval(await newLead()));
      expect(out.status).toBe('held');
      expect(t.sent).toHaveLength(0);
    });

    it('puts the kill switch ahead of the caps: it is stopped, not held', async () => {
      await clearSent();
      await resetCaps(5, 1, 1000);
      await alreadySent(1, 1);
      await sql('update workspace_settings set kill_switch = 1');
      const out = await executeEmail(deps(new CountingTransport()), await newApproval(await newLead()));
      expect(out).toEqual({ status: 'kill_switch' });
    });

    it('does not hold an approval that is not approved: a cap is no reason to touch it', async () => {
      await clearSent();
      await resetCaps(5, 1, 1000);
      await alreadySent(1, 1);
      const id = await newApproval(await newLead(), { status: 'rejected' });
      expect(await executeEmail(deps(new CountingTransport()), id)).toEqual({ status: 'already_claimed' });
    });

    it('recovery reports what it had to hold, and sends the rest', async () => {
      await clearSent();
      await resetCaps(5, 2, 1000);
      // Emails that earlier tests left held are still approved, and recovery rightly sends the oldest decisions
      // first, so they would take the room. Start from none.
      await sql("update approvals set status = 'failed' where kind = 'email.send' and status = 'approved'");
      const t = new CountingTransport();
      const ids = [await newApproval(await newLead(), { status: 'approved' }), await newApproval(await newLead(), { status: 'approved' }), await newApproval(await newLead(), { status: 'approved' })];
      const out = await recoverApprovals(deps(t));
      expect(t.sent.filter((m) => ids.includes(m.id))).toHaveLength(2);
      expect(out.held.filter((h) => ids.includes(h.id))).toHaveLength(1);
      expect(out.held[0]!.until).toBeInstanceOf(Date);
    });
  });

  describe('the kill switch', () => {
    it('stops an approved email from being claimed or sent, and it goes out once the switch is off', async () => {
      const t = new CountingTransport();
      const id = await newApproval(await newLead());
      await sql('update workspace_settings set kill_switch = 1');
      expect(await executeEmail(deps(t), id)).toEqual({ status: 'kill_switch' });
      expect(t.sent).toHaveLength(0);
      expect((await approval(id)).status).toBe('approved'); // not claimed, so nothing is lost

      await sql('update workspace_settings set kill_switch = 0');
      expect((await executeEmail(deps(t), id)).status).toBe('executed');
      expect(t.sent).toHaveLength(1);
    });
  });

  describe('a send is never retried', () => {
    it('records a transport failure, raises it to a person, and does not try again', async () => {
      const t = new CountingTransport();
      t.failWith = new Error('connection reset');
      const id = await newApproval(await newLead());
      const out = await executeEmail(deps(t), id);
      expect(out).toEqual({ status: 'failed', reason: 'connection reset' });
      expect(await approval(id)).toMatchObject({ status: 'failed', result: { reason: 'connection reset', transport: 'counting' } });
      expect(await message(id)).toMatchObject({ status: 'failed' });
      expect(await items(id)).toEqual(['send_unknown']);

      t.failWith = undefined;
      expect(await executeEmail(deps(t), id)).toEqual({ status: 'already_claimed' });
      expect(t.sent).toHaveLength(0);
    });
  });
});

describe('recovery after a restart (SPEC 6: the approvals row is the source of truth)', () => {
  it('sends approved emails that never ran, once, and never resends one that was mid-send', async () => {
    const t = new CountingTransport();
    const waiting = await newApproval(await newLead(), { status: 'approved' });
    const midSend = await newApproval(await newLead(), { status: 'executing' });
    const already = await newApproval(await newLead(), { status: 'executed' });

    const out = await recoverApprovals(deps(t));
    expect(out.resumed).toContain(waiting);
    expect(out.unknown).toContain(midSend);
    expect(out.resumed).not.toContain(already);

    expect(t.sent.map((m) => m.id)).toContain(waiting);
    expect(t.sent.map((m) => m.id)).not.toContain(midSend);
    expect(t.sent.map((m) => m.id)).not.toContain(already);
    expect((await approval(waiting)).status).toBe('executed');
    expect(await approval(midSend)).toMatchObject({ status: 'failed', result: { reason: expect.stringMatching(/interrupted.*unknown/) } });
    expect(await items(midSend)).toEqual(['send_unknown']);
  });

  it('running recovery twice sends nothing the second time', async () => {
    const t = new CountingTransport();
    const id = await newApproval(await newLead(), { status: 'approved' });
    await recoverApprovals(deps(t));
    const afterFirst = t.sent.filter((m) => m.id === id).length;
    await recoverApprovals(deps(t));
    expect(afterFirst).toBe(1);
    expect(t.sent.filter((m) => m.id === id)).toHaveLength(1);
  });

  it('does not send anything while the kill switch is on', async () => {
    const t = new CountingTransport();
    const id = await newApproval(await newLead(), { status: 'approved' });
    await sql('update workspace_settings set kill_switch = 1');
    await recoverApprovals(deps(t));
    expect(t.sent.filter((m) => m.id === id)).toHaveLength(0);
    expect((await approval(id)).status).toBe('approved');
  });
});

describe('propose_email and get_lead, the only door an agent has (CLAUDE.md rule 1)', () => {
  let agentId = '';
  let runId = '';
  const store = () => new DbOsStore(sys.app, undefined, companyRoot);
  const scope = () => ({ workspaceId: ws(), agentId, runId });
  const propose = (leadId: string, over: Record<string, unknown> = {}) =>
    callOsTool(store(), scope(), 'propose_email', { leadId, subject: 'A homepage concept', body: 'Hi Dana, I saw your booking page.', step: 1, ...over });

  beforeAll(async () => {
    agentId = (await sql("select id from agents where key = 'research-researcher'")).rows[0].id;
    const r = await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId]);
    runId = r.rows[0].id;
  });
  const setAutonomy = (n: number) => sql("update agents set autonomy = $2, status = 'active' where id = $1", [agentId, n]);

  it('is not even offered to an agent below autonomy 2', async () => {
    const lead = await newLead();
    for (const level of [0, 1]) {
      await setAutonomy(level);
      await expect(propose(lead), `autonomy ${level}`).rejects.toThrow(/Unknown tool "propose_email"/);
    }
    expect((await sql("select 1 from approvals where kind = 'email.send' and dedupe_key like $1", [`email:${lead}:%`])).rowCount).toBe(0);
  });

  it('is not offered to an agent that is not active, whatever its level', async () => {
    await sql("update agents set autonomy = 2, status = 'paused' where id = $1", [agentId]);
    await expect(propose(await newLead())).rejects.toThrow(/Unknown tool/);
  });

  it('queues a pending approval and a queued message, and says nothing was sent', async () => {
    await setAutonomy(2);
    const lead = await newLead();
    const text = await propose(lead);
    expect(text).toMatch(/Queued for approval as .*Nothing has been sent/);
    const a = (await sql("select id, status, kind, agent_id, run_id, payload from approvals where dedupe_key = $1", [`email:${lead}:1`])).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ status: 'pending', kind: 'email.send', agent_id: agentId, run_id: runId });
    expect(a[0].payload).toMatchObject({ leadId: lead, to: await emailOf(lead), step: 1 });
    expect(await message(a[0].id)).toMatchObject({ status: 'queued' });
  });

  it('returns the first proposal when the same email is proposed again', async () => {
    await setAutonomy(2);
    const lead = await newLead();
    await propose(lead);
    expect(await propose(lead, { body: 'A rewritten body that must not queue a second email.' })).toMatch(/Already queued/);
    expect((await sql('select 1 from approvals where dedupe_key = $1', [`email:${lead}:1`])).rowCount).toBe(1);
    expect((await sql('select 1 from outreach_messages where lead_id = $1', [lead])).rowCount).toBe(1);
    await propose(lead, { step: 2 });
    expect((await sql('select 1 from approvals where dedupe_key like $1', [`email:${lead}:%`])).rowCount).toBe(2);
  });

  it('refuses, in code, a lead that does not exist, has no address, is do-not-contact, or is suppressed', async () => {
    await setAutonomy(2);
    await expect(propose(randomUUID())).rejects.toThrow(/No such lead/);
    await expect(propose(await newLead({ email: null }))).rejects.toThrow(/no email address/);
    await expect(propose(await newLead({ stage: 'do_not_contact' }))).rejects.toThrow(/do not contact/);
    const blocked = await newLead();
    await sql('insert into suppression (workspace_id, value) values ($1, $2)', [ws(), await emailOf(blocked)]);
    await expect(propose(blocked)).rejects.toThrow(/suppression list/);
    const domain = await newLead({ email: 'x@whole-domain.test' });
    await sql("insert into suppression (workspace_id, value) values ($1, '@whole-domain.test')", [ws()]);
    await expect(propose(domain)).rejects.toThrow(/suppression list/);
  });

  it('refuses a medical or legal claim and an unknown price before anything is queued', async () => {
    await setAutonomy(2);
    const lead = await newLead();
    await expect(propose(lead, { body: 'We cure acne with guaranteed results.' })).rejects.toThrow(/Refused:.*medical claim/);
    await expect(propose(lead, { body: 'Our chatbot is HIPAA-compliant.' })).rejects.toThrow(/legal claim/);
    await expect(propose(lead, { subject: 'Only $49 today' })).rejects.toThrow(/price not in COMPANY\.md/);
    expect((await sql('select 1 from approvals where dedupe_key like $1', [`email:${lead}:%`])).rowCount).toBe(0);
  });

  it("cannot see, read or propose to another workspace's lead", async () => {
    await setAutonomy(2);
    const other = await db.withOwner(async (c) => {
      const w = await c.query("insert into workspaces (name, slug) values ('Other', $1) returning id", [`other-${randomUUID().slice(0, 8)}`]);
      const l = await c.query("insert into leads (workspace_id, business_name, email) values ($1, 'Theirs', 'theirs@other.test') returning id", [w.rows[0].id]);
      return l.rows[0].id as string;
    });
    await expect(propose(other)).rejects.toThrow(/No such lead/);
    await expect(callOsTool(store(), scope(), 'get_lead', { leadId: other })).rejects.toThrow(/No such lead/);
  });

  it('get_lead returns the lead for its own workspace', async () => {
    await setAutonomy(0); // reading a lead needs no outside authority
    const lead = await newLead();
    const out = JSON.parse(await callOsTool(store(), scope(), 'get_lead', { leadId: lead }));
    expect(out).toMatchObject({ id: lead, businessName: 'Clinic', stage: 'new' });
  });

  it('there is no tool that sends: an agent cannot reach the executor by any route', async () => {
    await setAutonomy(2);
    for (const name of ['send_email', 'send', 'execute_approval', 'approve', 'decide']) {
      await expect(callOsTool(store(), scope(), name, { to: 'x@y.test' }), name).rejects.toThrow(/Unknown tool/);
    }
  });
});
