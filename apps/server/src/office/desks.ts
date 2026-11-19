import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { readOfficeMap, type OfficeMap, type OfficeMapJson } from '@conclave/shared';
import { loadCompany } from '../company/loader';

/** Reads and checks the company's office map (company/office.tmj). Throws OfficeMapError, naming the file and the thing that is wrong. */
export async function loadOffice(companyRoot: string): Promise<{ map: OfficeMap; json: OfficeMapJson }> {
  const company = await loadCompany(companyRoot);
  const json = JSON.parse(await readFile(path.join(companyRoot, 'office.tmj'), 'utf8')) as OfficeMapJson;
  return { map: readOfficeMap(json, { file: 'company/office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) }), json };
}

export interface Seat {
  agentId: string;
  room: string;
  /** The desk number in that room; null for the lounge, which has no numbered desks. */
  slot: number | null;
}

/**
 * Seats every agent (SPEC 12: a new hire gets the next free desk by itself). An agent keeps its desk for as long as it stays in its
 * department, so nobody moves when someone else is hired or leaves. A retired agent's desk is freed. Desks go in hire order, the
 * lowest free number first. An agent whose department has no room, or whose room is full, sits in the lounge until a desk frees.
 * Safe to run at the same moment from several places: one lock, and the table will not hold a desk twice.
 */
export async function assignDesks(c: pg.PoolClient, ws: string, map: OfficeMap): Promise<Seat[]> {
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`office-desks:${ws}`]);
  const agents = (
    await c.query<{ id: string; department: string | null }>(
      "select a.id, d.key as department from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by a.created_at, a.key",
    )
  ).rows;
  await c.query('delete from office_desks where agent_id <> all($1::uuid[])', [agents.map((a) => a.id)]);
  const lounge = map.rooms.find((r) => r.kind === 'lounge');
  const roomOf = (dept: string | null) => map.rooms.find((r) => r.kind === 'department' && r.department === dept);

  const have = new Map((await c.query<{ agent_id: string; room: string; slot: number | null }>('select agent_id, room, slot from office_desks')).rows.map((r) => [r.agent_id, r]));
  for (const a of agents) {
    const cur = have.get(a.id);
    if (!cur) continue;
    const target = roomOf(a.department);
    // Kept: still in its department's room. An agent in the lounge keeps looking for a desk, so it is let go here and seated below.
    const keep = target ? cur.room === target.name && cur.slot !== null : cur.room === lounge?.name;
    if (!keep) {
      await c.query('delete from office_desks where agent_id = $1', [a.id]);
      have.delete(a.id);
    }
  }
  const taken = new Set([...have.values()].filter((h) => h.slot !== null).map((h) => `${h.room}:${h.slot}`));

  for (const a of agents) {
    if (have.has(a.id)) continue;
    const target = roomOf(a.department);
    const free = target ? map.desks.filter((d) => d.room === target.name && !taken.has(`${d.room}:${d.slot}`)).sort((x, y) => x.slot - y.slot)[0] : undefined;
    const seat = free ? { room: free.room, slot: free.slot } : { room: lounge?.name ?? 'Lounge', slot: null };
    if (free) taken.add(`${seat.room}:${seat.slot}`);
    await c.query('insert into office_desks (workspace_id, agent_id, room, slot) values ($1, $2, $3, $4)', [ws, a.id, seat.room, seat.slot]);
    have.set(a.id, { agent_id: a.id, ...seat });
  }
  return agents.map((a) => ({ agentId: a.id, room: have.get(a.id)!.room, slot: have.get(a.id)!.slot }));
}
