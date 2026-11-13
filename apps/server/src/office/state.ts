import type pg from 'pg';
import { placeAgents, type AgentFacts, type OfficeMap, type Placed } from '@conclave/shared';
import { assignDesks } from './desks';

/**
 * Reads, from runs, approvals and (once the Boardroom exists) discussions, what each active agent is doing, and where that puts it.
 * `discussing` is the set of agents in an open discussion; the Boardroom supplies it (S6-10).
 */
export async function officeState(c: pg.PoolClient, ws: string, map: OfficeMap, discussing: ReadonlySet<string> = new Set()): Promise<(Placed & { key: string })[]> {
  const seats = await assignDesks(c, ws, map);
  const agents = (await c.query<{ id: string; key: string }>("select id, key from agents where status <> 'retired' order by created_at, key")).rows;
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
    return { agentId: a.id, room: seat?.room ?? null, desk: seat?.slot ?? null, running: busy.has(a.id), waitingForYou: waiting.has(a.id), inDiscussion: discussing.has(a.id) };
  });
  const key = new Map(agents.map((a) => [a.id, a.key]));
  return placeAgents(map, facts).map((p) => ({ ...p, key: key.get(p.agentId)! }));
}
