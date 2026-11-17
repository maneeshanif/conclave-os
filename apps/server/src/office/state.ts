import type pg from 'pg';
import { placeAgents, type AgentFacts, type OfficeMap, type Placed } from '@conclave/shared';
import { assignDesks } from './desks';

/**
 * Reads, from runs, approvals and (once the Boardroom exists) discussions, what each active agent is doing, and where that puts it.
 * `discussing` is the set of agents in an open discussion; the Boardroom supplies it (S6-10).
 */
/** How long an agent that has handed a task on stays beside its colleague's desk. */
export const HANDOFF_SECONDS = 30;

export async function officeState(c: pg.PoolClient, ws: string, map: OfficeMap, discussing: ReadonlySet<string> = new Set()): Promise<(Placed & { key: string })[]> {
  const seats = await assignDesks(c, ws, map);
  const agents = (await c.query<{ id: string; key: string; name: string }>("select id, key, name from agents where status <> 'retired' order by created_at, key")).rows;
  // The newest message from one agent to another within the last half minute is a handoff: the giver visits the receiver.
  const handoffs = new Map<string, { toAgentId: string; toName: string }>();
  const byKey = new Map(agents.map((a) => [`agent:${a.key}`, a]));
  const recent = await c.query<{ from_id: string; to_id: string }>("select distinct on (from_id) from_id, to_id from messages where from_id like 'agent:%' and to_id like 'agent:%' and created_at > now() - make_interval(secs => $1) order by from_id, created_at desc", [HANDOFF_SECONDS]);
  for (const r of recent.rows) {
    const from = byKey.get(r.from_id);
    const to = byKey.get(r.to_id);
    if (from && to && from.id !== to.id) handoffs.set(from.id, { toAgentId: to.id, toName: to.name });
  }
  const busy = new Set((await c.query<{ agent_id: string }>("select distinct agent_id from runs where status in ('running','queued')")).rows.map((r) => r.agent_id));
  const waiting = new Set(
    (
      await c.query<{ agent_id: string }>(
        "select agent_id from approvals where status = 'pending' and agent_id is not null union select agent_id from runs where status = 'waiting_approval'",
      )
    ).rows.map((r) => r.agent_id),
  );
  const facts: AgentFacts[] = agents.map((a) => {
    const seat = seats.find((s) => s.agentId === a.id);
    return { agentId: a.id, room: seat?.room ?? null, desk: seat?.slot ?? null, running: busy.has(a.id), waitingForYou: waiting.has(a.id), inDiscussion: discussing.has(a.id), handoff: handoffs.get(a.id) ?? null };
  });
  const key = new Map(agents.map((a) => [a.id, a.key]));
  return placeAgents(map, facts).map((p) => ({ ...p, key: key.get(p.agentId)! }));
}

export interface TeamCard {
  id: string;
  key: string;
  name: string;
  department: string | null;
  /** working, waiting (for you), blocked, discussion, handoff or idle. */
  state: string;
  /** Since when, for working (the run's start) and waiting (the oldest thing it is waiting on). */
  since: string | null;
  /** The task it is on, or is stuck on. */
  task: string | null;
  /** How many of its proposals are waiting for you. */
  forYou: number;
}

const STATE_OF_PLACE: Record<string, string> = { desk: 'working', approvals: 'waiting', boardroom: 'discussion', handoff: 'handoff', lounge: 'idle' };

/**
 * A card for each active agent beside the world (S6-14b2): its state, how long, what it is on, and how many of its proposals wait for
 * you. The state is the world's own placement (so the card and the world agree), with "blocked" for an idle agent whose task is stuck.
 */
export async function teamCards(c: pg.PoolClient, ws: string, map: OfficeMap, discussing: ReadonlySet<string> = new Set()): Promise<TeamCard[]> {
  const places = await officeState(c, ws, map, discussing);
  const agents = (await c.query<{ id: string; key: string; name: string; department: string | null }>("select a.id, a.key, a.name, d.key as department from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by a.created_at, a.key")).rows;
  const running = new Map((await c.query<{ agent_id: string; started_at: Date | null; task_id: string | null }>("select distinct on (agent_id) agent_id, started_at, task_id from runs where status in ('running','queued') order by agent_id, started_at desc nulls last")).rows.map((r) => [r.agent_id, r]));
  const pending = new Map((await c.query<{ agent_id: string; n: number; first: Date }>("select agent_id, count(*)::int as n, min(created_at) as first from approvals where status = 'pending' and agent_id is not null group by agent_id")).rows.map((r) => [r.agent_id, r]));
  const open = (await c.query<{ assignee_id: string; id: string; title: string; status: string }>("select assignee_id, id, title, status from tasks where assignee_id is not null and status in ('in_progress','blocked') order by created_at desc")).rows;
  const titles = new Map((await c.query<{ id: string; title: string }>('select id, title from tasks where id = any($1::uuid[])', [[...running.values()].flatMap((r) => (r.task_id ? [r.task_id] : []))])).rows.map((r) => [r.id, r.title]));
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return agents.map((a) => {
    const place = places.find((p) => p.agentId === a.id)?.place ?? 'lounge';
    const mine = open.filter((t) => t.assignee_id === a.id);
    let state = STATE_OF_PLACE[place] ?? 'idle';
    if (state === 'idle' && mine.some((t) => t.status === 'blocked')) state = 'blocked';
    const run = running.get(a.id);
    const wait = pending.get(a.id);
    const task = state === 'blocked' ? (mine.find((t) => t.status === 'blocked')?.title ?? null) : ((run?.task_id ? titles.get(run.task_id) : undefined) ?? mine.find((t) => t.status === 'in_progress')?.title ?? null);
    return {
      id: a.id,
      key: a.key,
      name: a.name,
      department: a.department,
      state,
      since: state === 'working' ? iso(run?.started_at) : state === 'waiting' ? iso(wait?.first) : null,
      task: state === 'idle' ? null : task,
      forYou: wait?.n ?? 0,
    };
  });
}
