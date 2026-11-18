import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { scrub } from '../company/export';
import { withWorkspace } from '../db/tenant';
import type { RuntimeName } from '../runtimes/names';

/**
 * The verifying step (A4, borrow audit): a tiny probe on an agent's rendered folder, run when the agent is made or changed and before it can
 * run. It checks what a run would depend on, without running a model: the files its runtime reads are there, its configs parse, the `os`
 * address is on this machine, no secret was written into the folder, and the folder it works in exists. An agent whose latest probe failed
 * is not runnable until its folder is rendered again and passes.
 */
export interface ProbeResult {
  ok: boolean;
  problems: string[];
}

/** The files each target writes that a run cannot do without, and which of them are JSON. */
const NEEDS: Record<RuntimeName, { files: string[]; json: string[] }> = {
  'claude-cli': { files: ['CLAUDE.md', '.claude/settings.json', '.mcp.json'], json: ['.claude/settings.json', '.mcp.json'] },
  opencode: { files: ['AGENTS.md', 'opencode.json'], json: ['opencode.json'] },
  'openai-agents': { files: ['INSTRUCTIONS.md', '.runner.json'], json: ['.runner.json'] },
  codex: { files: ['INSTRUCTIONS.md', '.codex-mcp.json'], json: ['.codex-mcp.json'] },
  http: { files: ['INSTRUCTIONS.md'], json: [] },
  'claude-agent': { files: ['INSTRUCTIONS.md'], json: [] },
};

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/;
const exists = (p: string) => stat(p).then(() => true, () => false);

/** The first `os` address named in a rendered config, whichever shape the target uses. */
function osUrlIn(json: unknown): string | null {
  const j = json as { mcpServers?: { os?: { url?: string } }; mcp?: { os?: { url?: string } }; url?: string };
  return j?.mcpServers?.os?.url ?? j?.mcp?.os?.url ?? (typeof j?.url === 'string' ? j.url : null);
}

export async function probeAgentFolder(dir: string, runtime: RuntimeName): Promise<ProbeResult> {
  const problems: string[] = [];
  const need = NEEDS[runtime];
  for (const f of need.files) if (!(await exists(path.join(dir, f)))) problems.push(`${f} is missing`);
  for (const f of need.json) {
    const text = await readFile(path.join(dir, f), 'utf8').catch(() => null);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problems.push(`${f} does not parse`);
      continue;
    }
    const url = osUrlIn(parsed);
    if (url && !LOCAL.test(url)) problems.push(`${f}: the os address (${url}) is not on this machine`);
  }
  // No secret was written into any text file the run reads.
  for (const f of await textFiles(dir)) {
    const found = scrub(await readFile(path.join(dir, f), 'utf8')).found;
    if (found.length) problems.push(`${f} looks like a secret was written into it (${[...new Set(found)].join(', ')})`);
  }
  if (!(await exists(path.join(dir, 'work')))) problems.push('the work folder is missing');
  return { ok: problems.length === 0, problems };
}

/** The top-level text files and the skills, not the work folder (what the agent writes there is its own). */
async function textFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string, depth: number) => {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === 'work' || e.name === '.xdg-config' || e.name === 'node_modules') continue;
      if (e.isDirectory() && depth < 4) await walk(r, depth + 1);
      else if (e.isFile() && /\.(md|json|ya?ml|txt)$/i.test(e.name)) out.push(r);
    }
  };
  await walk('', 0);
  return out;
}

/** Writes down what the probe found for an agent. The latest one decides whether it may run. */
export async function recordProbe(pool: pg.Pool, workspaceId: string, agentKey: string, r: ProbeResult): Promise<void> {
  await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query('insert into agent_probes (workspace_id, agent_id, ok, problems) select $1, a.id, $3, $4 from agents a where a.key = $2', [workspaceId, agentKey, r.ok, JSON.stringify(r.problems)]),
  );
}

/** Why an agent may not run because of its probe, or null if it may (no probe yet counts as fine: older agents were never probed). */
export async function probeBlock(pool: pg.Pool, workspaceId: string, agentId: string): Promise<string | null> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ ok: boolean; problems: string[] }>('select ok, problems from agent_probes where agent_id = $1 order by at desc, id desc limit 1', [agentId]));
  const p = r.rows[0];
  return p && !p.ok ? `its working folder failed its check: ${p.problems.join('; ')}` : null;
}
