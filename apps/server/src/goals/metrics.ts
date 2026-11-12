import type { PoolClient } from 'pg';

/** A scored lead at or above this counts as qualified. It matches the line the score-lead skill draws for a clear fit. */
export const QUALIFIED_SCORE = 70;

const DAY = 86_400_000;

export interface MetricDef {
  unit: string;
  /** The period it counts over, for showing next to the number. */
  window: string;
  /** The count itself: always a query over the tables. `stage` is funnel/stage for the stage metrics. */
  compute(c: PoolClient, goal: { stage: string | null }, now: Date): Promise<number>;
}

async function stageExits(c: PoolClient, stage: string | null, since: Date): Promise<number> {
  if (!stage) return 0;
  const [funnel, key] = stage.split('/');
  const r = await c.query<{ n: number }>(
    `select count(distinct e.deal_id)::int as n
       from deal_stage_events e join deals d on d.id = e.deal_id join funnels f on f.id = d.funnel_id
      where f.key = $1 and e.from_stage = $2 and e.at >= $3`,
    [funnel, key, since],
  );
  return r.rows[0]!.n;
}

/**
 * Metrics the Goals screen can measure (S2-9). A goal's progress is one of these and nothing else, so no number on the
 * screen was typed by hand or by an agent. A metric name that is not here is shown as "not measured", not as zero.
 */
export const METRICS: Record<string, MetricDef> = {
  // Revenue is the value of deals won this calendar month. It is a stand-in until payments are recorded (Stripe, slice 7+).
  monthly_revenue_usd: {
    unit: 'usd',
    window: 'this month',
    async compute(c, _g, now) {
      const r = await c.query<{ v: string | null }>(
        `select sum(d.value) as v from deals d join projects p on p.deal_id = d.id where d.status = 'won' and p.created_at >= $1`,
        [new Date(now.getFullYear(), now.getMonth(), 1)],
      );
      return Number(r.rows[0]!.v ?? 0);
    },
  },
  qualified_leads_per_week: {
    unit: 'leads',
    window: '7 days',
    async compute(c, _g, now) {
      const r = await c.query<{ n: number }>('select count(*)::int as n from leads where verified and score >= $1 and created_at >= $2', [QUALIFIED_SCORE, new Date(now.getTime() - 7 * DAY)]);
      return r.rows[0]!.n;
    },
  },
  positive_replies_per_week: {
    unit: 'people',
    window: '7 days',
    async compute(c, _g, now) {
      const r = await c.query<{ n: number }>(
        `select count(distinct t.lead_id)::int as n from thread_messages m join threads t on t.id = m.thread_id
          where m.direction = 'in' and m.classification = 'positive' and m.at >= $1`,
        [new Date(now.getTime() - 7 * DAY)],
      );
      return r.rows[0]!.n;
    },
  },
  stage_exits_per_week: { unit: 'deals', window: '7 days', compute: (c, g, now) => stageExits(c, g.stage, new Date(now.getTime() - 7 * DAY)) },
  stage_exits_per_month: { unit: 'deals', window: '30 days', compute: (c, g, now) => stageExits(c, g.stage, new Date(now.getTime() - 30 * DAY)) },
};
