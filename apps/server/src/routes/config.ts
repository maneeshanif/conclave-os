import path from 'node:path';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { createDelegate, getDelegate, HAND_DECISIONS_NEEDED, revokeDelegate, setDelegateActive, setMandateRule } from '../approvals/delegate';
import { CHOICES, chosen, isChoice } from '../connectors/choice';
import { withWorkspace } from '../db/tenant';
import { readHiring, rosterRoom } from '../talent/hiring';

/**
 * The Settings screen's API (SPEC 12, rule 8: what a person may set is set from the front end, not from code or SQL). One read that gathers what
 * can be changed, and a write for each thing. Secrets are never in it: a connector is shown by name, a key only as set or not set. Writes are
 * the owner's (the roles table in `auth/roles.ts`).
 */
const Agent = z.object({ selfWriting: z.boolean().optional(), autonomy: z.number().int().min(0).max(3).optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
const Spend = z.object({ usd: z.number().min(-1000).max(1000).refine((n) => n !== 0, { message: 'A correction of zero changes nothing.' }), reason: z.string().trim().min(3).max(300) }).strict();
const Connectors = z.object({ git: z.string().max(20).optional(), meeting: z.string().max(20).optional() }).strict().refine((o) => o.git !== undefined || o.meeting !== undefined, { message: 'Nothing to change.' });
const Watchdog = z.object({ on: z.boolean() }).strict();
const Channel = z.object({ channel: z.enum(['stable', 'beta', 'nightly']) }).strict();
const Hours = z.object({ hours: z.number().int().min(1).max(168) }).strict();
const Active = z.object({ active: z.boolean() }).strict();
const Rule = z.object({ kind: z.literal('email.send'), minStep: z.number().int().min(2).max(10), maxStep: z.number().int().min(2).max(10), requireCampaign: z.boolean().optional() }).strict().refine((r) => r.minStep <= r.maxStep, { message: 'minStep is after maxStep.' });

export function configRoutes(deps: { workspaceId: string; pool: Pool; dataDir?: string }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const keyDir = deps.dataDir ? path.join(deps.dataDir, 'delegate') : undefined;

  r.get('/', async (c) => {
    const tx = c.get('tx').client;
    const hiring = await readHiring(deps.pool, ws);
    const room = await rosterRoom(deps.pool, ws);
    const agents = (await tx.query<{ key: string; name: string; status: string; autonomy: number; self_writing: boolean; runtime: string; department: string | null }>(
      'select a.key, a.name, a.status, a.autonomy, a.self_writing, a.runtime, d.key as department from agents a left join departments d on d.id = a.department_id order by d.key, a.key',
    )).rows;
    const d = await getDelegate(deps.pool, ws);
    const hand = Object.fromEntries((await tx.query<{ kind: string; n: number }>("select kind, count(*)::int as n from approvals where decided_by = 'founder' and status in ('approved','executing','executed','failed','rejected') group by kind")).rows.map((x) => [x.kind, x.n]));
    const st = (await tx.query<{ guest_link_hours: number; release_channel: string; task_watchdog: boolean }>('select guest_link_hours, release_channel, task_watchdog from workspace_settings')).rows[0];
    const guest = st?.guest_link_hours ?? 48;
    return c.json({
      hiring: { ...hiring, active: room.active },
      guestLinkHours: guest,
      releaseChannel: st?.release_channel ?? 'stable',
      taskWatchdog: st?.task_watchdog ?? false,
      agents: agents.map((a) => ({ key: a.key, name: a.name, department: a.department, status: a.status, autonomy: a.autonomy, selfWriting: a.self_writing, runtime: a.runtime })),
      delegate: { registered: Boolean(d), active: d?.active ?? false, revoked: Boolean(d?.revokedAt), fingerprint: d?.fingerprint ?? null, mandate: d?.mandate ?? {}, handDecisions: hand, handDecisionsNeeded: HAND_DECISIONS_NEEDED },
      // Which connector is in use is a setting (PUT /connectors, no restart); keys are shown as set or not set, never their value.
      connectors: {
        git: await chosen(deps.pool, ws, 'git', process.env.GIT_CONNECTOR),
        meeting: await chosen(deps.pool, ws, 'meeting', process.env.MEETING_CONNECTOR),
        options: CHOICES,
        claudeAgentKey: process.env.CLAUDE_AGENT_API_KEY ? 'set' : 'not set',
        httpWorkers: (() => {
          try {
            return Object.keys(JSON.parse(process.env.HTTP_WORKERS || '{}') as object).length;
          } catch {
            return 0;
          }
        })(),
      },
    });
  });

  r.put('/agents/:key', async (c) => {
    const parsed = Agent.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const tx = c.get('tx').client;
    const key = c.req.param('key');
    const a = (await tx.query<{ id: string }>('select id from agents where key = $1', [key])).rows[0];
    if (!a) return c.json({ error: 'No such agent.' }, 404);
    if (parsed.data.selfWriting !== undefined) await tx.query('update agents set self_writing = $2 where id = $1', [a.id, parsed.data.selfWriting]);
    if (parsed.data.autonomy !== undefined) await tx.query('update agents set autonomy = $2 where id = $1', [a.id, parsed.data.autonomy]);
    await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values (current_setting('app.workspace_id')::uuid, 'founder', 'config.agent', $1, $2)", [key, JSON.stringify(parsed.data)]);
    return c.json({ ok: true });
  });

  // A correction to an agent's spend this month (A5): adds or takes off an amount, with why. The run rows are never edited.
  r.post('/agents/:key/spend', async (c) => {
    const parsed = Spend.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const tx = c.get('tx').client;
    const a = (await tx.query<{ id: string }>('select id from agents where key = $1', [c.req.param('key')])).rows[0];
    if (!a) return c.json({ error: 'No such agent.' }, 404);
    await tx.query("insert into spend_adjustments (workspace_id, agent_id, usd, reason, created_by) values (current_setting('app.workspace_id')::uuid, $1, $2, $3, 'founder')", [a.id, parsed.data.usd, parsed.data.reason]);
    await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values (current_setting('app.workspace_id')::uuid, 'founder', 'config.spend_adjustment', $1, $2)", [c.req.param('key'), JSON.stringify(parsed.data)]);
    return c.json({ ok: true }, 201);
  });

  // Switch a connector from the screen (no restart). Only names that exist; the sign-ins and keys they need are still yours to add.
  r.put('/connectors', async (c) => {
    const parsed = Connectors.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send { git } or { meeting } with a known name.' }, 400);
    for (const [kind, name] of Object.entries(parsed.data)) if (!isChoice(kind, name as string)) return c.json({ error: `There is no ${kind} connector called "${name as string}". Use one of: ${CHOICES[kind as 'git' | 'meeting'].join(', ')}.` }, 400);
    const tx = c.get('tx').client;
    await tx.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws]);
    await tx.query("update workspace_settings set connectors = connectors || $1::jsonb, updated_at = now()", [JSON.stringify(parsed.data)]);
    await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values (current_setting('app.workspace_id')::uuid, 'founder', 'config.connectors', 'connectors', $1)", [JSON.stringify(parsed.data)]);
    return c.json({ ok: true });
  });

  r.put('/task-watchdog', async (c) => {
    const parsed = Watchdog.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send { on: true or false }.' }, 400);
    const tx = c.get('tx').client;
    await tx.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws]);
    await tx.query('update workspace_settings set task_watchdog = $1, updated_at = now()', [parsed.data.on]);
    return c.json({ taskWatchdog: parsed.data.on });
  });

  r.put('/release-channel', async (c) => {
    const parsed = Channel.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'The channel is stable, beta or nightly.' }, 400);
    const tx = c.get('tx').client;
    await tx.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws]);
    await tx.query('update workspace_settings set release_channel = $1, updated_at = now()', [parsed.data.channel]);
    return c.json({ releaseChannel: parsed.data.channel });
  });

  r.put('/guest-link-hours', async (c) => {
    const parsed = Hours.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'hours is a whole number from 1 to 168' }, 400);
    const tx = c.get('tx').client;
    await tx.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws]);
    await tx.query('update workspace_settings set guest_link_hours = $1, updated_at = now()', [parsed.data.hours]);
    return c.json({ guestLinkHours: parsed.data.hours });
  });

  r.post('/delegate/register', async (c) => {
    if (!keyDir) return c.json({ error: 'This server has nowhere to keep a delegate key.' }, 409);
    if (await getDelegate(deps.pool, ws)) return c.json({ error: 'A delegate is already registered.' }, 409);
    return c.json(await createDelegate(deps.pool, ws, keyDir), 201);
  });
  r.put('/delegate/active', async (c) => {
    const parsed = Active.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send { active: true or false }.' }, 400);
    const d = await getDelegate(deps.pool, ws);
    if (!d) return c.json({ error: 'There is no delegate yet.' }, 409);
    if (d.revokedAt) return c.json({ error: 'The delegate is revoked.' }, 409);
    await setDelegateActive(deps.pool, ws, parsed.data.active);
    return c.json({ active: parsed.data.active });
  });
  r.put('/delegate/mandate', async (c) => {
    const parsed = Rule.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    if (!(await getDelegate(deps.pool, ws))) return c.json({ error: 'There is no delegate yet.' }, 409);
    try {
      await setMandateRule(deps.pool, ws, parsed.data);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
    return c.json({ ok: true });
  });
  r.delete('/delegate/mandate/:kind', async (c) => {
    await withWorkspace(deps.pool, ws, ({ client }) => client.query("update delegates set mandate = mandate - $1 where revoked_at is null", [c.req.param('kind')]));
    return c.json({ ok: true });
  });
  r.post('/delegate/revoke', async (c) => {
    await revokeDelegate(deps.pool, ws);
    return c.json({ ok: true });
  });

  r.get('/tool-calls', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const rows = (await c.get('tx').client.query<{ tool: string; risk: string; decision: string; reason: string | null; at: Date; agent: string | null }>(
      'select t.tool, t.risk, t.decision, t.reason, t.at, a.key as agent from tool_calls t left join agents a on a.id = t.agent_id order by t.at desc, t.id desc limit $1',
      [limit],
    )).rows;
    return c.json({ calls: rows.map((x) => ({ tool: x.tool, risk: x.risk, decision: x.decision, reason: x.reason, at: x.at.toISOString(), agent: x.agent })) });
  });

  return r;
}
