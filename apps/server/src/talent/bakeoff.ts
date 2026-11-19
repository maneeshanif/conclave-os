import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { searchCatalog } from './catalog';

/** One candidate's trial: what it produced, what it tried that it must not, and what it cost. */
export interface TrialResult {
  output: string;
  /** How many times it tried something that should have gone to a person (an outside action, a send, a post). */
  boundaryAttempts: number;
  costUsd: number;
}
export interface TrialInput {
  role: { id: string; source: string; key: string; name: string; text: string };
  template: string;
  task: string;
}
/** Runs one candidate on the trial task, framed by the template, with no outside actions. Tests give a scripted one; a real one runs the runtime in a scratch folder. */
export type Trial = (i: TrialInput) => Promise<TrialResult>;

export interface Scored {
  roleId: string;
  source: string;
  key: string;
  name: string;
  boundaryAttempts: number;
  rating: number;
  costUsd: number;
  output: string;
}

/** How the work reads, 0 to 100: distinct words in it, a stand-in until a reviewer's rating is wired in. Deterministic, so the same output scores the same. */
export function rate(output: string): number {
  return Math.min(100, new Set(output.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).size * 10);
}

/** Boundaries first (fewest attempts wins), then the better rating, then the lower cost, then name for a stable order. */
export function rank(a: Scored, b: Scored): number {
  return a.boundaryAttempts - b.boundaryAttempts || b.rating - a.rating || a.costUsd - b.costUsd || a.name.localeCompare(b.name);
}

export interface BakeOff {
  id: string;
  candidates: Scored[];
  winner: Scored;
}

/**
 * The interview (S8-5, SPEC 9): search the catalog, take up to three candidates, run the same trial task for each, and score. A candidate that
 * tried to cross a boundary ranks below every candidate that did not, however good its work. Nothing is hired here.
 */
export async function runBakeOff(
  pool: pg.Pool,
  workspaceId: string,
  o: { department: string; query: string; template: string; trialTask: string; trial: Trial; limit?: number },
): Promise<BakeOff> {
  const hits = await searchCatalog(pool, workspaceId, o.query, { limit: Math.min(3, o.limit ?? 3) });
  if (!hits.length) throw new Error(`The catalog has no candidates for "${o.query}".`);
  const scored: Scored[] = [];
  for (const h of hits) {
    const text = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ text: string }>('select text from catalog_roles where id = $1 and not flagged', [h.id]))).rows[0]?.text;
    if (!text) continue;
    const r = await o.trial({ role: { id: h.id, source: h.source, key: h.key, name: h.name, text }, template: o.template, task: o.trialTask });
    scored.push({ roleId: h.id, source: h.source, key: h.key, name: h.name, boundaryAttempts: r.boundaryAttempts, rating: rate(r.output), costUsd: r.costUsd, output: r.output.slice(0, 2000) });
  }
  if (!scored.length) throw new Error(`The catalog has no candidates for "${o.query}".`);
  scored.sort(rank);
  const row = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{ id: string }>("insert into bakeoffs (workspace_id, department, query, template, trial_task, status, candidates) values ($1, $2, $3, $4, $5, 'scored', $6) returning id", [workspaceId, o.department, o.query, o.template, o.trialTask, JSON.stringify(scored)]),
  );
  return { id: row.rows[0]!.id, candidates: scored, winner: scored[0]! };
}
