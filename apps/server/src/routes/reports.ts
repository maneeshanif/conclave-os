import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';

const DAY = 86_400_000;
const days = (ms: number) => ms / DAY;
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

const PipelineQuery = z.object({
  funnel: z.string().trim().min(1).max(60).optional(),
  stuckDays: z.coerce.number().min(0).max(3650).default(14),
});

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Numbers, never typed by an agent (SPEC 10): every figure here is a query over the tables. Where the tables cannot
 * know something (an email's delivery or opening, a meeting booked), the answer is null, not a made-up zero.
 */
export function reportRoutes() {
  const r = new Hono<AppEnv>();
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;

  r.get('/campaigns/:id/results', async (c) => {
    const id = c.req.param('id') as string;
    const [camp] = await q<{ id: string; name: string; status: string }>(c, 'select id, name, status from campaigns where id = $1', [id]);
    if (!camp) return c.json({ error: 'Not found' }, 404);

    const [counts] = await q<{ enrolled: number; active: number; paused: number; unsubscribed: number; done: number; sent: number; contacted: number; replied: number; positive_replies: number; won: number; cost_usd: string | null }>(
      c,
      // A reply counts for this campaign only if it came after the first thing the campaign sent that person.
      `with first_sent as (
         select lead_id, min(sent_at) as at from outreach_messages where campaign_id = $1 and status = 'sent' group by lead_id
       ), replies as (
         select e.lead_id, bool_or(m.classification = 'positive') as positive
           from sequence_enrollments e
           join first_sent f on f.lead_id = e.lead_id
           join threads t on t.lead_id = e.lead_id
           join thread_messages m on m.thread_id = t.id and m.direction = 'in' and m.at >= f.at
          where e.campaign_id = $1 group by e.lead_id
       )
       select
         (select count(*)::int from sequence_enrollments where campaign_id = $1) as enrolled,
         (select count(*)::int from sequence_enrollments where campaign_id = $1 and status = 'active') as active,
         (select count(*)::int from sequence_enrollments where campaign_id = $1 and status = 'paused') as paused,
         (select count(*)::int from sequence_enrollments where campaign_id = $1 and status = 'unsubscribed') as unsubscribed,
         (select count(*)::int from sequence_enrollments where campaign_id = $1 and status = 'done') as done,
         (select count(*)::int from outreach_messages where campaign_id = $1 and status = 'sent') as sent,
         (select count(*)::int from first_sent) as contacted,
         (select count(*)::int from replies) as replied,
         (select count(*)::int from replies where positive) as positive_replies,
         (select count(distinct d.id)::int from deals d join leads l on l.account_id = d.account_id
            join sequence_enrollments e on e.lead_id = l.id and e.campaign_id = $1 where d.status = 'won') as won,
         (select sum(r.cost_usd) from runs r join tasks t on t.id = r.task_id
           where t.kind = 'sequence_step' and t.body like '%campaign ' || $1::text || '%') as cost_usd`,
      [id],
    );
    const k = counts!;
    return c.json({
      campaign: camp.id,
      name: camp.name,
      status: camp.status,
      enrolled: k.enrolled,
      enrollment: { active: k.active, paused: k.paused, unsubscribed: k.unsubscribed, done: k.done },
      sent: k.sent,
      delivered: null,
      opened: null,
      replied: k.replied,
      positive_replies: k.positive_replies,
      reply_rate: k.contacted ? k.replied / k.contacted : null,
      meetings: null,
      won: k.won,
      cost_usd: k.cost_usd === null ? 0 : Number(k.cost_usd),
    });
  });

  /** Conversion, days in stage and stuck deals for one funnel, or a summary of every funnel. */
  r.get('/pipeline', async (c) => {
    const parsed = PipelineQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const { funnel, stuckDays } = parsed.data;
    const funnels = await q<{ id: string; key: string; name: string }>(c, 'select id, key, name from funnels where ($1::text is null or key = $1) order by key', [funnel ?? null]);
    if (funnel && !funnels.length) return c.json({ error: `No such funnel "${funnel}".` }, 404);

    const now = Date.now();
    const out = [];
    for (const f of funnels) {
      const stages = await q<{ key: string; name: string; position: number; owner: string | null; exit_requires: string[] }>(
        c,
        'select key, name, position, owner, exit_requires from funnel_stages where funnel_id = $1 and not retired order by position',
        [f.id],
      );
      const posOf = new Map(stages.map((s) => [s.key, s.position]));
      const first = stages[0]?.key;
      const deals = await q<{ id: string; stage: string; status: string; created_at: Date; stage_changed_at: Date; decision_maker: string | null; due: Date | null; account: string }>(
        c,
        `select d.id, d.stage, d.status, d.created_at, d.stage_changed_at, d.decision_maker, d.due, a.name as account
           from deals d join accounts a on a.id = d.account_id where d.funnel_id = $1`,
        [f.id],
      );
      const events = await q<{ deal_id: string; to_stage: string; at: Date }>(
        c,
        'select e.deal_id, e.to_stage, e.at from deal_stage_events e join deals d on d.id = e.deal_id where d.funnel_id = $1 order by e.at, e.id',
        [f.id],
      );
      const byDeal = new Map<string, { stage: string; at: number }[]>();
      for (const d of deals) byDeal.set(d.id, first ? [{ stage: first, at: d.created_at.getTime() }] : []);
      for (const e of events) byDeal.get(e.deal_id)?.push({ stage: e.to_stage, at: e.at.getTime() });

      const reached = new Map(stages.map((s) => [s.key, 0]));
      const durations = new Map<string, number[]>(stages.map((s) => [s.key, []]));
      for (const d of deals) {
        const path = byDeal.get(d.id)!;
        const maxPos = Math.max(0, ...path.map((p) => posOf.get(p.stage) ?? 0));
        for (const s of stages) if (maxPos >= s.position) reached.set(s.key, reached.get(s.key)! + 1);
        path.forEach((p, i) => {
          const next = path[i + 1];
          // A lost deal's last stretch has no known end, so it is left out rather than guessed.
          if (!next && d.status === 'lost') return;
          if (durations.has(p.stage)) durations.get(p.stage)!.push(days((next ? next.at : now) - p.at));
        });
      }

      const rows = stages.map((s, i) => {
        const nextKey = stages[i + 1]?.key;
        const here = reached.get(s.key)!;
        const d = durations.get(s.key)!;
        return {
          key: s.key,
          name: s.name,
          position: s.position,
          owner: s.owner,
          current: deals.filter((x) => x.stage === s.key && x.status !== 'lost').length,
          reached: here,
          conversion: nextKey && here > 0 ? reached.get(nextKey)! / here : null,
          avg_days: d.length ? round(d.reduce((a, b) => a + b, 0) / d.length) : null,
          median_days: d.length ? round(median(d)!) : null,
        };
      });

      const stuck = deals
        .filter((d) => d.status === 'open' && days(now - d.stage_changed_at.getTime()) > stuckDays)
        .map((d) => {
          const st = stages.find((s) => s.key === d.stage);
          const have: Record<string, boolean> = { decision_maker: !!d.decision_maker?.trim(), due: d.due !== null };
          return {
            deal_id: d.id,
            account: d.account,
            stage: d.stage,
            days_in_stage: round(days(now - d.stage_changed_at.getTime())),
            missing: (st?.exit_requires ?? []).filter((need) => !have[need]),
          };
        })
        .sort((a, b) => b.days_in_stage - a.days_in_stage);

      out.push({
        funnel: f.key,
        name: f.name,
        stages: rows,
        totals: { open: deals.filter((d) => d.status === 'open').length, won: deals.filter((d) => d.status === 'won').length, lost: deals.filter((d) => d.status === 'lost').length },
        stuck,
        stuck_after_days: stuckDays,
      });
    }
    return c.json(funnel ? out[0] : out);
  });

  return r;
}
