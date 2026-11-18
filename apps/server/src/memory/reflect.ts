import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { rememberMemory } from './memory';

const MIN_STEPS = 4;

/**
 * The reflect pass (S8-3): after a run with more than a few steps, by an agent that has switched self-writing on, save one low-confidence
 * company note about what the run produced. Cheap and deterministic: no model call. It never proposes a skill patch by itself; the agent
 * does that with propose_skill_patch, and a person approves it. Returns whether it saved anything. Once per run.
 */
export async function reflectOnRun(pool: pg.Pool, workspaceId: string, runId: string, output: string): Promise<boolean> {
  const text = output.trim();
  if (!text) return false;
  const info = await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const run = (await c.query<{ agent_id: string; self_writing: boolean }>('select r.agent_id, a.self_writing from runs r join agents a on a.id = r.agent_id and a.workspace_id = r.workspace_id where r.id = $1', [runId])).rows[0];
    if (!run?.self_writing) return null;
    const steps = Number((await c.query<{ n: number }>("select count(*)::int as n from run_events where run_id = $1 and type = 'tool_call'", [runId])).rows[0]!.n);
    const done = (await c.query('select 1 from memories where source = $1 and text like $2', [`run:${runId}`, 'Reflection:%'])).rows[0];
    return steps >= MIN_STEPS && !done ? run : null;
  });
  if (!info) return false;
  await rememberMemory(pool, workspaceId, { scope: 'company', agentId: info.agent_id, text: `Reflection: a run of this agent ended with: ${text.slice(0, 600)}`, source: `run:${runId}`, confidence: 40 });
  return true;
}
