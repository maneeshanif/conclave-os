import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { assignDesks, loadOffice } from '../office/desks';

/** The office (SPEC 12): the map's facts and where each agent sits. The drawing reads the map file itself from /office/map. */
export function officeRoutes(deps: { workspaceId: string; companyRoot: string }) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    let office;
    try {
      office = await loadOffice(deps.companyRoot);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    const tx = c.get('tx').client;
    const seats = await assignDesks(tx, deps.workspaceId, office.map);
    const agents = await tx.query<{ id: string; key: string; name: string; department: string | null; status: string }>(
      "select a.id, a.key, a.name, d.key as department, a.status from agents a left join departments d on d.id = a.department_id where a.status <> 'retired' order by a.created_at, a.key",
    );
    const { walls, ...facts } = office.map;
    return c.json({
      map: { ...facts, walls: walls.map((row) => row.map((w) => (w ? '#' : '.')).join('')) },
      agents: agents.rows.map((a) => {
        const seat = seats.find((s) => s.agentId === a.id);
        return { id: a.id, key: a.key, name: a.name, department: a.department, status: a.status, room: seat?.room ?? null, desk: seat?.slot ?? null };
      }),
    });
  });

  r.get('/map', async (c) => {
    try {
      await loadOffice(deps.companyRoot); // refuse to serve a map the OS cannot read
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    return c.body(await readFile(path.join(deps.companyRoot, 'office.tmj'), 'utf8'), 200, { 'content-type': 'application/json' });
  });

  return r;
}
