import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOST, REPO_ROOT, resolvePort } from '../config';
import { loadCompany } from '../company/loader';
import { agentNew, renderAll } from './agent-new';
import { openSystem } from '../system';

type Env = Record<string, string | undefined>;
const AGENT = 'research-researcher';
const TASK = 'List five facts from the company file, each with the line it came from';

interface TaskDetail {
  task: { status: string; blocked_reason: string | null };
  thread: { from_id: string; body: string }[];
  runs: { id: string; status: string; runtime: string; error: string | null }[];
}

/**
 * `pnpm run e2e` (S0-11): the slice 0 end-to-end check, run against a server that is already
 * running. It hires the researcher if needed, runs the task on Claude Code, switches the role file
 * to OpenCode, runs it again, and puts the role file back as it was.
 */
export async function e2e(env: Env = process.env, print: (s: string) => void = console.log): Promise<number> {
  const base = `http://${HOST}:${resolvePort(env)}`;
  const health = await fetch(`${base}/health`).catch(() => null);
  if (!health?.ok) {
    print(`The server is not running at ${base}. Start it with \`pnpm dev\` in another terminal, then run this again.`);
    return 1;
  }
  const sys = await openSystem(env);
  const company = await loadCompany(sys.companyRoot);
  let agent = company.agents.find((a) => a.role.id === AGENT);
  if (!agent) {
    const r = await agentNew(sys, { template: 'researcher', department: 'research', id: AGENT, name: 'Researcher' });
    print(`Hired ${r.id}.`);
    agent = (await loadCompany(sys.companyRoot)).agents.find((a) => a.role.id === AGENT)!;
  }
  const roleFile = path.join(sys.companyRoot, agent.rolePath);
  const original = await readFile(roleFile, 'utf8');
  const repoRules = (await readFile(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8')).split('\n').find((l) => l.startsWith('You are building Conclave OS'))!;
  const companyMd = await readFile(path.join(sys.companyRoot, 'COMPANY.md'), 'utf8');

  const api = async <T>(p: string, init?: RequestInit) => (await (await fetch(`${base}/api${p}`, { ...init, headers: { 'content-type': 'application/json' } })).json()) as T;
  const agentId = async () => (await api<{ id: string; key: string }[]>('/agents')).find((a) => a.key === AGENT)!.id;

  async function runOnce(label: string): Promise<boolean> {
    const { id } = await api<{ id: string }>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: TASK, body: `The company file, COMPANY.md:\n\n${companyMd}`, assigneeId: await agentId() }),
    });
    print(`\n[${label}] task ${id} created. Waiting for the run (up to 10 minutes)...`);
    let d: TaskDetail | undefined;
    for (let i = 0; i < 300; i++) {
      d = await api<TaskDetail>(`/tasks/${id}`);
      const settled = d.task.status === 'done' || d.task.status === 'blocked';
      const runEnded = !!d.runs.length && !['queued', 'running'].includes(d.runs.at(-1)!.status);
      if (settled && runEnded) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const run = d?.runs.at(-1);
    const events = run ? JSON.stringify(await api(`/runs/${run.id}`)) : '';
    const ok = d?.task.status === 'done' && d.thread.some((m) => m.from_id === `agent:${AGENT}`) && !events.includes(repoRules);
    print(`[${label}] task ${d?.task.status}; run ${run?.status ?? 'none'} on ${run?.runtime ?? '?'}${run?.error ? ` (${run.error})` : ''}`);
    print(`[${label}] answer: ${(d?.thread.at(-1)?.body ?? '(none)').slice(0, 400)}`);
    print(`[${label}] run log ${events.includes(repoRules) ? 'CONTAINS' : 'does not contain'} text from this repo's CLAUDE.md`);
    print(`[${label}] see every step at http://127.0.0.1:3000 (task ${id})`);
    return ok;
  }

  try {
    const results: [string, boolean][] = [];
    await writeFile(roleFile, original.replace(/^runtime: .*$/m, 'runtime: claude-cli').replace(/^model: .*$/m, 'model: researcher'));
    await renderAll(sys);
    results.push(['claude-cli', await runOnce('claude-cli')]);

    await writeFile(roleFile, original.replace(/^runtime: .*$/m, 'runtime: opencode').replace(/^model: .*$/m, `model: ${env.E2E_OPENCODE_MODEL ?? 'any-model'}`));
    await renderAll(sys);
    results.push(['opencode', await runOnce('opencode')]);

    print('');
    for (const [name, ok] of results) print(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    return results.every(([, ok]) => ok) ? 0 : 1;
  } finally {
    await writeFile(roleFile, original);
    await renderAll(sys);
    await sys.close();
  }
}
