import { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { withWorkspace } from '../db/tenant';
import { readHiring, rosterRoom, setHiring } from '../talent/hiring';

const Policy = z.object({ level: z.enum(['H0', 'H1']).optional(), rosterCap: z.number().int().min(1).max(500).optional(), trialBudgetCapUsd: z.number().min(0).max(1000).optional() }).strict();

/** The Talent room (S8-8): the hiring policy and roster, the bake-offs, and what is in the catalog. Setting the policy is the only write. */
export function talentRoutes(deps: { workspaceId: string; pool: Pool }) {
  const r = new Hono<AppEnv>();
  const view = async () => {
    const ws = deps.workspaceId;
    const policy = await readHiring(deps.pool, ws);
    const room = await rosterRoom(deps.pool, ws);
    const data = await withWorkspace(deps.pool, ws, async ({ client: c }) => ({
      bakeoffs: (await c.query<{ id: string; department: string; query: string; status: string; candidates: unknown[]; created_at: string }>('select id, department, query, status, candidates, created_at from bakeoffs order by created_at desc limit 20')).rows,
      catalog: (await c.query<{ source: string; roles: number; flagged: number }>('select source, count(*)::int as roles, count(*) filter (where flagged)::int as flagged from catalog_roles group by source order by source')).rows,
      hires: (await c.query<{ id: string; status: string; payload: { winner?: { name?: string }; department?: string } }>("select id, status, payload from approvals where kind = 'hire' order by created_at desc limit 20")).rows,
    }));
    return {
      policy: { ...policy, active: room.active },
      bakeoffs: data.bakeoffs.map((b) => ({ id: b.id, department: b.department, query: b.query, status: b.status, candidates: b.candidates, createdAt: b.created_at })),
      catalog: data.catalog,
      hires: data.hires.map((h) => ({ approvalId: h.id, status: h.status, name: h.payload.winner?.name ?? null, department: h.payload.department ?? null })),
    };
  };
  r.get('/', async (c) => c.json(await view()));
  r.put('/policy', async (c) => {
    const parsed = Policy.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    await setHiring(deps.pool, deps.workspaceId, parsed.data);
    return c.json(await view());
  });
  return r;
}
