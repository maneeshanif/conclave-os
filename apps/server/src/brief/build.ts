import type pg from 'pg';
import { companyTimezone } from '../config';
import { withWorkspace } from '../db/tenant';
import { measureGoals } from '../goals/progress';

const DAY = 86_400_000;
export const STUCK_AFTER_DAYS = 14;
export const QUALIFIED_AT = 70;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface BriefContent {
  leads: { new: number; scored: number; qualified: number; top: { id: string; name: string | null; score: number; reason: string | null }[] };
  approvals: { waiting: number; oldest_hours: number | null; items: { id: string; kind: string; label: string; created_at: string }[] };
  replies: { to_triage: number; items: { task_id: string; title: string }[] };
  deals: { stuck: number; items: { deal_id: string; account: string; stage: string; days: number }[] };
  attention: {
    blocked: { task_id: string; title: string; reason: string | null }[];
    action_items: { id: string; kind: string; title: string }[];
    kill_switch: boolean;
  };
  sent: { emails_24h: number };
  /** Qualified signals a scout found that no person has acted on yet (S4-8). Briefs made before slice 4 have none. */
  signals: { waiting: number; new: number; items: { id: string; kind: string; source: string; url: string; author: string | null; excerpt: string | null; score: number | null }[] };
  goals: { current_rung: string | null; rungs: { key: string; title: string | null; target: number | null; current: number | null; pct: number | null; met: boolean }[]; departments: { department: string | null; metric: string | null; target: number | null; current: number | null; pct: number | null; measured: boolean }[] };
}

export interface BriefRecord {
  day: string;
  quiet: boolean;
  summary: string[];
  narrative: string | null;
  narrative_by: string | null;
  created_at: string;
  updated_at: string;
  content: BriefContent;
}

/** Today's date, written YYYY-MM-DD, in the company's time zone. */
export function dayOf(now: Date, tz?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The time of day, as HH:MM, in the company's time zone. */
export function clockOf(now: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/**
 * Counts what happened in the last day and what needs a person, from the tables (SPEC 3, 12). Plain code: every number
 * is a query, and the summary lines are written from those numbers. Nothing here asks a model anything.
 */
export async function buildBrief(c: pg.PoolClient, now: Date): Promise<{ content: BriefContent; summary: string[]; quiet: boolean }> {
  const since = new Date(now.getTime() - DAY);

  const leadRow = (
    await c.query<{ n: number; scored: number; qualified: number }>(
      `select count(*)::int as n, count(score)::int as scored, count(*) filter (where verified and score >= $2)::int as qualified from leads where created_at >= $1`,
      [since, QUALIFIED_AT],
    )
  ).rows[0]!;
  const top = (
    await c.query<{ id: string; business_name: string | null; score: number; score_reason: string | null }>(
      'select id, business_name, score, score_reason from leads where created_at >= $1 and score is not null order by score desc, created_at limit 5',
      [since],
    )
  ).rows;

  const pending = (
    await c.query<{ id: string; kind: string; payload: { to?: string; subject?: string }; created_at: Date }>(
      "select id, kind, payload, created_at from approvals where status = 'pending' order by created_at limit 10",
    )
  ).rows;
  const waiting = (await c.query<{ n: number }>("select count(*)::int as n from approvals where status = 'pending'")).rows[0]!.n;
  const oldest = pending[0] ? Math.floor((now.getTime() - pending[0].created_at.getTime()) / 3_600_000) : null;

  const triage = (
    await c.query<{ id: string; title: string }>("select id, title from tasks where kind = 'triage' and status in ('todo','in_progress','waiting_approval','blocked') order by created_at limit 10")
  ).rows;
  const triageCount = (await c.query<{ n: number }>("select count(*)::int as n from tasks where kind = 'triage' and status in ('todo','in_progress','waiting_approval','blocked')")).rows[0]!.n;

  const stuck = (
    await c.query<{ id: string; account: string; stage: string; stage_changed_at: Date }>(
      `select d.id, a.name as account, d.stage, d.stage_changed_at from deals d join accounts a on a.id = d.account_id
        where d.status = 'open' and d.stage_changed_at < $1 order by d.stage_changed_at limit 10`,
      [new Date(now.getTime() - STUCK_AFTER_DAYS * DAY)],
    )
  ).rows;
  const stuckCount = (await c.query<{ n: number }>("select count(*)::int as n from deals where status = 'open' and stage_changed_at < $1", [new Date(now.getTime() - STUCK_AFTER_DAYS * DAY)])).rows[0]!.n;

  const blocked = (await c.query<{ id: string; title: string; blocked_reason: string | null }>("select id, title, blocked_reason from tasks where status = 'blocked' order by created_at limit 10")).rows;
  const items = (await c.query<{ id: string; kind: string; title: string }>("select id, kind, title from action_items where status = 'open' order by created_at limit 10")).rows;
  const itemCount = (await c.query<{ n: number }>("select count(*)::int as n from action_items where status = 'open'")).rows[0]!.n;
  const killSwitch = ((await c.query<{ kill_switch: number }>('select kill_switch from workspace_settings')).rows[0]?.kill_switch ?? 0) === 1;
  const sent = (await c.query<{ n: number }>("select count(*)::int as n from outreach_messages where status = 'sent' and sent_at >= $1", [since])).rows[0]!.n;

  const sigRows = (
    await c.query<{ id: string; kind: string; source: string; url: string; author: string | null; excerpt: string | null; score: number | null }>(
      "select id, kind, source, url, author, excerpt, score from signals where status = 'qualified' order by score desc nulls last, found_at desc, id limit 5",
    )
  ).rows;
  const sigCounts = (await c.query<{ waiting: number; fresh: number }>("select count(*)::int as waiting, count(*) filter (where updated_at >= $1)::int as fresh from signals where status = 'qualified'", [since])).rows[0]!;

  const g = await measureGoals(c, now);

  const content: BriefContent = {
    leads: { new: leadRow.n, scored: leadRow.scored, qualified: leadRow.qualified, top: top.map((t) => ({ id: t.id, name: t.business_name, score: t.score, reason: t.score_reason })) },
    approvals: {
      waiting,
      oldest_hours: oldest,
      items: pending.map((p) => ({
        id: p.id,
        kind: p.kind,
        label: p.kind === 'email.send' ? `Email to ${p.payload.to ?? 'a lead'}: ${p.payload.subject ?? '(no subject)'}` : p.kind,
        created_at: p.created_at.toISOString(),
      })),
    },
    replies: { to_triage: triageCount, items: triage.map((t) => ({ task_id: t.id, title: t.title })) },
    deals: { stuck: stuckCount, items: stuck.map((d) => ({ deal_id: d.id, account: d.account, stage: d.stage, days: Math.floor((now.getTime() - d.stage_changed_at.getTime()) / DAY) })) },
    attention: {
      blocked: blocked.map((t) => ({ task_id: t.id, title: t.title, reason: t.blocked_reason })),
      action_items: items,
      kill_switch: killSwitch,
    },
    sent: { emails_24h: sent },
    signals: { waiting: sigCounts.waiting, new: sigCounts.fresh, items: sigRows.map((s) => ({ ...s, excerpt: s.excerpt === null ? null : s.excerpt.length > 240 ? `${s.excerpt.slice(0, 237)}...` : s.excerpt })) },
    goals: {
      current_rung: g.current_rung,
      rungs: g.rungs.map((x) => ({ key: x.key, title: x.title, target: x.target, current: x.current, pct: x.pct, met: x.met })),
      departments: g.departments.map((x) => ({ department: x.department, metric: x.metric, target: x.target, current: x.current, pct: x.pct, measured: x.measured })),
    },
  };

  const lines: string[] = [];
  if (killSwitch) lines.push('The kill switch is on: nothing is running and nothing will be sent.');
  if (content.leads.new) lines.push(`${plural(content.leads.new, 'new lead', 'new leads')} (${content.leads.scored} scored, ${content.leads.qualified} qualified).`);
  if (waiting) lines.push(`${plural(waiting, 'approval', 'approvals')} waiting for you${oldest !== null && oldest >= 1 ? `, the oldest ${oldest} hours` : ''}.`);
  if (triageCount) lines.push(`${plural(triageCount, 'reply', 'replies')} to triage.`);
  if (stuckCount) lines.push(`${plural(stuckCount, 'deal', 'deals')} stuck for more than ${STUCK_AFTER_DAYS} days.`);
  if (blocked.length) lines.push(`${plural(blocked.length, 'task', 'tasks')} blocked.`);
  if (itemCount) lines.push(`${plural(itemCount, 'item', 'items')} need you.`);
  if (sigCounts.waiting) lines.push(`${plural(sigCounts.waiting, 'qualified signal', 'qualified signals')} waiting (${sigCounts.fresh} new since yesterday).`);
  if (sent) lines.push(`${plural(sent, 'email', 'emails')} sent in the last day.`);
  const quiet = lines.length === 0;
  return { content, summary: quiet ? ['Nothing happened overnight, and nothing needs you.'] : lines, quiet };
}

const COLUMNS = 'to_char(day, \'YYYY-MM-DD\') as day, quiet, summary, narrative, narrative_by, created_at, updated_at, content';

export function toRecord(row: Record<string, unknown>): BriefRecord {
  return {
    day: row.day as string,
    quiet: row.quiet as boolean,
    summary: row.summary as string[],
    narrative: (row.narrative as string | null) ?? null,
    narrative_by: (row.narrative_by as string | null) ?? null,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    content: row.content as BriefContent,
  };
}

/** Builds today's brief and saves it, replacing the numbers if one is already there. The agent's paragraph is kept. */
export async function rebuildBrief(c: pg.PoolClient, workspaceId: string, now: Date, tz = companyTimezone()): Promise<BriefRecord> {
  const built = await buildBrief(c, now);
  const r = await c.query(
    `insert into briefs (workspace_id, day, quiet, summary, content) values ($1, $2, $3, $4, $5)
     on conflict (workspace_id, day) do update set quiet = excluded.quiet, summary = excluded.summary, content = excluded.content, updated_at = now()
     returning ${COLUMNS}`,
    [workspaceId, dayOf(now, tz), built.quiet, JSON.stringify(built.summary), JSON.stringify(built.content)],
  );
  return toRecord(r.rows[0]!);
}

export async function latestBrief(c: pg.PoolClient): Promise<BriefRecord | null> {
  const r = await c.query(`select ${COLUMNS} from briefs order by day desc limit 1`);
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

export async function briefOn(c: pg.PoolClient, day: string): Promise<BriefRecord | null> {
  const r = await c.query(`select ${COLUMNS} from briefs where day = $1`, [day]);
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

/**
 * The ticker's part: once a day, at or after `after` (HH:MM in the company's time zone), make today's brief if there is
 * none. Several tickers at the same moment make one (the table holds one row per day). Returns the new brief, or null.
 */
export async function ensureDailyBrief(o: { pool: pg.Pool; workspaceId: string; tz?: string | undefined; after?: string; now?: () => Date }): Promise<BriefRecord | null> {
  const now = (o.now ?? (() => new Date()))();
  if (clockOf(now, o.tz) < (o.after ?? '06:30')) return null;
  const day = dayOf(now, o.tz);
  return withWorkspace(o.pool, o.workspaceId, async ({ client: c }) => {
    if ((await c.query('select 1 from briefs where day = $1', [day])).rows.length) return null;
    const built = await buildBrief(c, now);
    const r = await c.query(
      `insert into briefs (workspace_id, day, quiet, summary, content) values ($1, $2, $3, $4, $5)
       on conflict (workspace_id, day) do nothing returning ${COLUMNS}`,
      [o.workspaceId, day, built.quiet, JSON.stringify(built.summary), JSON.stringify(built.content)],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  });
}
