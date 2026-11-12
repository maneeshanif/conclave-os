import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { sequencePass } from '../workflows/sequences';

const ACTOR = 'founder';
export const CHANNELS = ['email', 'x_dm', 'ig_dm', 'linkedin'] as const;
const HEALTH = ['ok', 'paused', 'blocked'] as const;

const Text = (max: number) => z.string().trim().min(1).max(max);
const Cap = z.number().int().min(1).max(1000);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written YYYY-MM-DD');

const NewMailbox = z.object({
  channel: z.enum(CHANNELS),
  handle: Text(200).transform((h) => h.toLowerCase()),
  dailyCap: Cap.optional(),
  warmupUntil: Day.optional(),
  warmupCap: Cap.optional(),
});
const PatchMailbox = z
  .object({ dailyCap: Cap, warmupUntil: Day.nullable(), warmupCap: Cap, health: z.enum(HEALTH) })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change.' });

const NewCampaign = z.object({
  name: Text(200),
  market: Text(60).optional(),
  channel: z.enum(CHANNELS).default('email'),
  channelAccountId: z.uuid().optional(),
  audience: z.record(z.string(), z.unknown()).optional(),
});

const Steps = z.object({
  steps: z
    .array(z.object({ step: z.number().int().min(1).max(10), waitDays: z.number().int().min(0).max(90), skill: Text(100).optional(), template: Text(100).optional() }))
    .min(1)
    .max(10),
});

/**
 * Channel accounts and campaigns (SPEC 10). The caps live on the channel account and the executor enforces them; a
 * campaign is approved by the founder before it can run, and once approved its sequence is frozen: what was approved
 * is what runs.
 */
export function campaignRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;
  const bad = (c: Context<AppEnv>, error: z.ZodError) => c.json({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
  const body = (c: Context<AppEnv>) => c.req.json().catch(() => null);
  const audit = (c: Context<AppEnv>, action: string, subject: string, data: unknown = {}) =>
    q(c, 'insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, $3, $4, $5)', [ws, ACTOR, action, subject, JSON.stringify(data)]);

  // ---- channel accounts
  r.get('/channel-accounts', async (c) =>
    c.json(await q(c, 'select id, channel, handle, daily_cap, warmup_until, warmup_cap, health from channel_accounts order by channel, handle')),
  );

  r.post('/channel-accounts', async (c) => {
    const p = NewMailbox.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const m = p.data;
    const dup = await q(c, 'select 1 from channel_accounts where channel = $1 and lower(handle) = $2', [m.channel, m.handle]);
    if (dup.length) return c.json({ error: `${m.handle} is already registered for ${m.channel}.` }, 409);
    const [row] = await q<{ id: string }>(
      c,
      'insert into channel_accounts (workspace_id, channel, handle, daily_cap, warmup_until, warmup_cap) values ($1, $2, $3, coalesce($4, 10), $5, coalesce($6, 5)) returning id',
      [ws, m.channel, m.handle, m.dailyCap ?? null, m.warmupUntil ?? null, m.warmupCap ?? null],
    );
    await audit(c, 'channel_account.created', row!.id, { channel: m.channel, handle: m.handle });
    return c.json({ id: row!.id }, 201);
  });

  r.patch('/channel-accounts/:id', async (c) => {
    const p = PatchMailbox.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const cols: Record<string, string> = { dailyCap: 'daily_cap', warmupUntil: 'warmup_until', warmupCap: 'warmup_cap', health: 'health' };
    const sets: string[] = [];
    const params: unknown[] = [c.req.param('id')];
    for (const [k, v] of Object.entries(p.data)) {
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${cols[k]} = $${params.length}`);
    }
    const rows = await q(c, `update channel_accounts set ${sets.join(', ')} where id = $1 returning id`, params);
    if (!rows[0]) return c.json({ error: 'Not found' }, 404);
    await audit(c, 'channel_account.updated', c.req.param('id'), p.data);
    return c.json({ id: c.req.param('id') });
  });

  // ---- campaigns
  r.get('/campaigns', async (c) =>
    c.json(
      await q(
        c,
        `select k.id, k.name, k.market, k.channel, k.status, k.channel_account_id, a.handle as channel_handle, k.approved_at, k.created_at,
                (select count(*)::int from sequence_steps s where s.campaign_id = k.id) as steps
           from campaigns k left join channel_accounts a on a.id = k.channel_account_id order by k.created_at desc, k.id desc limit 200`,
      ),
    ),
  );

  // Asks the sequence runner now, instead of waiting for its next pass. It only decides who is due; drafting and approval are as usual.
  r.post('/run-sequences', async (c) => {
    const made: string[] = [];
    const campaigns = await sequencePass(c.get('tx').client, ws, new Date(), made);
    c.get('after').push(async () => made.forEach((taskId) => deps.bus.publish({ kind: 'task.changed', workspaceId: ws, taskId })));
    return c.json({ created: made.length, campaigns });
  });

  r.get('/campaigns/:id', async (c) => {
    const [k] = await q(c, 'select id, name, market, channel, audience, status, channel_account_id, approved_at, created_at from campaigns where id = $1', [c.req.param('id')]);
    if (!k) return c.json({ error: 'Not found' }, 404);
    const steps = await q(c, 'select step, wait_days, skill, template from sequence_steps where campaign_id = $1 order by step', [c.req.param('id')]);
    return c.json({ ...k, steps });
  });

  r.post('/campaigns', async (c) => {
    const p = NewCampaign.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const k = p.data;
    if (k.channelAccountId) {
      const [a] = await q<{ channel: string }>(c, 'select channel from channel_accounts where id = $1', [k.channelAccountId]);
      if (!a) return c.json({ error: 'No such channel account.' }, 404);
      if (a.channel !== k.channel) return c.json({ error: `That account is for ${a.channel}, but the campaign is for ${k.channel}.` }, 400);
    }
    const [row] = await q<{ id: string }>(
      c,
      'insert into campaigns (workspace_id, name, market, channel, audience, channel_account_id) values ($1, $2, $3, $4, $5, $6) returning id',
      [ws, k.name, k.market ?? null, k.channel, JSON.stringify(k.audience ?? {}), k.channelAccountId ?? null],
    );
    await audit(c, 'campaign.created', row!.id, { name: k.name });
    return c.json({ id: row!.id }, 201);
  });

  r.put('/campaigns/:id/steps', async (c) => {
    const p = Steps.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const id = c.req.param('id') as string;
    const [k] = await q<{ status: string }>(c, 'select status from campaigns where id = $1 for update', [id]);
    if (!k) return c.json({ error: 'Not found' }, 404);
    if (k.status !== 'draft') return c.json({ error: `The sequence is frozen once a campaign is approved (this one is ${k.status}). Make a new campaign to change it.` }, 409);
    const steps = [...p.data.steps].sort((a, b) => a.step - b.step);
    if (steps.some((s, i) => s.step !== i + 1)) return c.json({ error: 'Steps must be numbered 1, 2, 3 with no gaps or repeats.' }, 400);
    if (steps[0]!.waitDays !== 0) return c.json({ error: 'The first step goes out at once, so its wait must be 0 days.' }, 400);
    await q(c, 'delete from sequence_steps where campaign_id = $1', [id]);
    for (const s of steps) {
      await q(c, 'insert into sequence_steps (workspace_id, campaign_id, step, wait_days, skill, template) values ($1, $2, $3, $4, $5, $6)', [ws, id, s.step, s.waitDays, s.skill ?? null, s.template ?? null]);
    }
    return c.json({ id, steps: steps.length });
  });

  /** One lifecycle move: from one of these statuses to another, logged. */
  async function move(c: Context<AppEnv>, action: string, from: string[], to: string, extra?: (k: { id: string; channel_account_id: string | null }) => Promise<string | null>) {
    const id = c.req.param('id') as string;
    const [k] = await q<{ id: string; status: string; channel_account_id: string | null; approved_at: string | null }>(c, 'select id, status, channel_account_id, approved_at from campaigns where id = $1 for update', [id]);
    if (!k) return c.json({ error: 'Not found' }, 404);
    if (!from.includes(k.status)) return c.json({ error: `A campaign that is ${k.status} cannot be ${action === 'start' ? 'started' : action === 'finish' ? 'finished' : action + 'd'}.` }, 409);
    if (action === 'start' && !k.approved_at) return c.json({ error: 'The founder has not approved this campaign, so it cannot run.' }, 409);
    const problem = extra ? await extra(k) : null;
    if (problem) return c.json({ error: problem }, 409);
    await q(c, `update campaigns set status = $2${action === 'approve' ? ', approved_at = now()' : ''} where id = $1`, [id, to]);
    await audit(c, `campaign.${to === 'approved' ? 'approved' : to === 'running' ? 'started' : to}`, id);
    return c.json({ id, status: to });
  }

  r.get('/campaigns/:id/enrollments', async (c) =>
    c.json(
      await q(
        c,
        `select e.lead_id, l.business_name, l.email, e.status, e.paused_reason, e.steps_sent, e.last_sent_at
           from sequence_enrollments e join leads l on l.id = e.lead_id where e.campaign_id = $1 order by e.created_at, e.id`,
        [c.req.param('id')],
      ),
    ),
  );

  r.post('/campaigns/:id/enroll', async (c) => {
    const p = z.object({ leadIds: z.array(z.uuid()).min(1).max(500) }).safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const id = c.req.param('id') as string;
    const [k] = await q<{ status: string }>(c, 'select status from campaigns where id = $1 for update', [id]);
    if (!k) return c.json({ error: 'Not found' }, 404);
    if (k.status === 'done') return c.json({ error: 'This campaign is finished, so no one can be added.' }, 409);
    const skipped: { leadId: string; reason: string }[] = [];
    let enrolled = 0;
    for (const leadId of [...new Set(p.data.leadIds)]) {
      const [l] = await q<{ email: string | null; stage: string; verified: boolean; suppressed: boolean }>(
        c,
        `select l.email, l.stage, l.verified, exists (select 1 from suppression s where lower(s.value) = lower(l.email) or lower(s.value) = '@' || split_part(lower(l.email), '@', 2)) as suppressed
           from leads l where l.id = $1`,
        [leadId],
      );
      if (!l) skipped.push({ leadId, reason: 'no such lead' });
      else if (!l.email) skipped.push({ leadId, reason: 'no email address' });
      else if (!l.verified) skipped.push({ leadId, reason: 'not verified: it has no source, so a person has to verify it first' });
      else if (l.stage === 'do_not_contact') skipped.push({ leadId, reason: 'marked do not contact' });
      else if (l.suppressed) skipped.push({ leadId, reason: 'on the suppression list' });
      else {
        const ins = await q(c, 'insert into sequence_enrollments (workspace_id, campaign_id, lead_id) values ($1, $2, $3) on conflict do nothing returning id', [ws, id, leadId]);
        if (ins.length) enrolled++;
        else skipped.push({ leadId, reason: 'already enrolled' });
      }
    }
    await audit(c, 'campaign.enrolled', id, { enrolled, skipped: skipped.length });
    return c.json({ enrolled, skipped });
  });

  r.post('/campaigns/:id/approve', (c) =>
    move(c, 'approve', ['draft'], 'approved', async (k) => {
      const steps = await q(c, 'select 1 from sequence_steps where campaign_id = $1', [k.id]);
      if (!steps.length) return 'Add at least one step to the sequence before approving.';
      if (!k.channel_account_id) return 'Choose the mailbox this campaign sends from before approving.';
      const [a] = await q<{ health: string; handle: string }>(c, 'select health, handle from channel_accounts where id = $1', [k.channel_account_id]);
      if (!a || a.health !== 'ok') return `The mailbox ${a?.handle ?? ''} is ${a?.health ?? 'missing'}, so the campaign cannot be approved.`;
      return null;
    }),
  );
  r.post('/campaigns/:id/start', (c) => move(c, 'start', ['approved', 'paused'], 'running'));
  r.post('/campaigns/:id/pause', (c) => move(c, 'pause', ['running'], 'paused'));
  r.post('/campaigns/:id/finish', (c) => move(c, 'finish', ['approved', 'running', 'paused'], 'done'));

  return r;
}
