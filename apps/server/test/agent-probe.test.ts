import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { executeRun } from '../src/harness/loop';
import { probeAgentFolder } from '../src/harness/probe';
import { agentWorkDir } from '../src/paths';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The verifying step (A4): a new or changed agent runs a tiny probe on its rendered folder before it can run. */
let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const dirOf = (key: string) => agentWorkDir(sys.dataDir, sys.workspace.slug, key);
const probes = async (key: string) => (await sql('select p.ok, p.problems from agent_probes p join agents a on a.id = p.agent_id where a.key = $1 order by p.at desc, p.id desc', [key])).rows as { ok: boolean; problems: string[] }[];

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 240_000);
afterAll(() => sys?.close());

describe('probing a rendered folder (A4)', () => {
  it('passes the folders every runtime target renders, and says what is missing from one that is not there', async () => {
    for (const [template, runtime, model] of [['researcher', 'claude-cli', 'researcher'], ['researcher', 'opencode', 'any-model'], ['writer', 'http', 'any-model']] as const) {
      const id = `probe-${runtime}`;
      await agentNew(sys, { template, department: 'research', id, name: 'P', runtime, model });
      const r = await probeAgentFolder(dirOf(id), runtime);
      expect(r, runtime).toEqual({ ok: true, problems: [] });
    }
    const empty = await mkdtemp(path.join(tmpdir(), 'conclave-probe-'));
    const r = await probeAgentFolder(empty, 'claude-cli');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/CLAUDE\.md.*missing/);
    expect(r.problems.join(' ')).toMatch(/\.mcp\.json.*missing/);
    await rm(empty, { recursive: true, force: true });
  });

  it('fails a folder with a config that does not parse, an os address that is not on this machine, a secret in it, or no work folder', async () => {
    const dir = dirOf('probe-claude-cli');
    const mcp = JSON.parse(await readFile(path.join(dir, '.mcp.json'), 'utf8')) as { mcpServers: { os: { url: string } } };
    await writeFile(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { os: { ...mcp.mcpServers.os, url: 'https://evil.example.test/mcp' } } }));
    expect((await probeAgentFolder(dir, 'claude-cli')).problems.join(' ')).toMatch(/os address.*not on this machine/);
    await writeFile(path.join(dir, '.mcp.json'), '{ not json');
    expect((await probeAgentFolder(dir, 'claude-cli')).problems.join(' ')).toMatch(/\.mcp\.json.*does not parse/);
    await agentNew(sys, { template: 'researcher', department: 'research', id: 'probe-claude-cli', name: 'P' }).catch(() => undefined);
    const again = dirOf('probe-opencode');
    await writeFile(path.join(again, 'AGENTS.md'), `${await readFile(path.join(again, 'AGENTS.md'), 'utf8')}\nkey is sk-abcdefghijklmnop1234567890\n`);
    expect((await probeAgentFolder(again, 'opencode')).problems.join(' ')).toMatch(/looks like a secret/);
    await rm(path.join(again, 'work'), { recursive: true, force: true });
    expect((await probeAgentFolder(again, 'opencode')).problems.join(' ')).toMatch(/work folder.*missing/);
  });

  it('is recorded when an agent is made, and an agent whose folder fails never runs', async () => {
    await agentNew(sys, { template: 'researcher', department: 'research', id: 'probe-good', name: 'Good' });
    expect(await probes('probe-good')).toEqual([{ ok: true, problems: [] }]);
    // Break its folder, record the probe the way a render would, and ask it to run.
    const dir = dirOf('probe-good');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '.mcp.json'), '{ nope');
    const { recordProbe } = await import('../src/harness/probe');
    await recordProbe(sys.app, ws(), 'probe-good', await probeAgentFolder(dir, 'claude-cli'));
    expect((await probes('probe-good'))[0]).toMatchObject({ ok: false });
    await sql("update agents set status = 'active' where key = 'probe-good'");
    const agentId = (await sql("select id from agents where key = 'probe-good'")).rows[0].id as string;
    const out = await executeRun({ pool: sys.app } as never, ws(), agentId, 'manual');
    expect(out).toEqual({ status: 'not_runnable', reason: 'its working folder failed its check: .mcp.json does not parse' });
  });
});
