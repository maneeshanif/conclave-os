import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createOpenAIAgentsRuntime } from '../src/runtimes/openai-agents';
import { listSkills, loadSkill, skillInstructions } from '../src/runtimes/skills';
import type { RunEvent, RunRequest } from '../src/runtimes/types';
import { startFakeOpenAI, type FakeOpenAI } from './fixtures/fake-openai';

const CITE = '---\nname: cite-sources\ndescription: "Use when reporting any fact: attach the exact source."\n---\n\n1. Find the fact.\n2. Quote the source.\n';
const OTHER = '---\nname: other-skill\ndescription: Does the other thing.\n---\nOther body.\n';
const SECRET = 'TOP-SECRET-OUTSIDE-THE-FOLDER';

let root = '';
let dir = '';
let outside = '';
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'conclave-skills-'));
  dir = path.join(root, 'agent', '.skills');
  outside = path.join(root, 'outside');
  await mkdir(path.join(dir, 'cite-sources'), { recursive: true });
  await mkdir(path.join(dir, 'other-skill'), { recursive: true });
  await mkdir(path.join(dir, 'no-file'), { recursive: true }); // a folder with no SKILL.md is not a skill
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(dir, 'cite-sources', 'SKILL.md'), CITE);
  await writeFile(path.join(dir, 'other-skill', 'SKILL.md'), OTHER);
  await writeFile(path.join(outside, 'SKILL.md'), SECRET);
  await writeFile(path.join(root, 'secret.txt'), SECRET);
  try {
    await symlink(outside, path.join(dir, 'linked'), 'junction'); // a link that points out of the folder
  } catch {
    // some machines cannot make links; the test for it is skipped below
  }
});
afterAll(async () => rm(root, { recursive: true, force: true }));

describe('the skill loader (S4-3)', () => {
  it('lists each skill with its own description, and nothing without a SKILL.md', async () => {
    const skills = await listSkills(dir);
    expect(skills.map((s) => s.name)).toEqual(['cite-sources', 'other-skill']);
    expect(skills[0]!.description).toBe('Use when reporting any fact: attach the exact source.');
  });

  it('puts names and descriptions in the instructions, never the bodies', async () => {
    const text = skillInstructions(await listSkills(dir));
    expect(text).toContain('- cite-sources: Use when reporting any fact');
    expect(text).toContain('load_skill');
    expect(text).not.toContain('Quote the source');
    expect(skillInstructions([])).toBe('');
  });

  it('returns a skill it has', async () => {
    expect(await loadSkill(dir, 'cite-sources')).toBe(CITE);
  });

  it('refuses a skill it does not have, a path, an absolute path, a link out of the folder, and a name that is not a name', async () => {
    for (const bad of ['missing', '../outside', '..', '../secret.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'cite-sources/../other-skill', 'cite-sources/SKILL.md', '', 'Cite-Sources', 'linked', 'no-file']) {
      await expect(loadSkill(dir, bad), bad).rejects.toThrow(/do not have a skill|not a skill name/);
    }
  });
});

describe('load_skill through the runner (S4-3)', () => {
  let fake: FakeOpenAI;
  let osServer: ReturnType<typeof serve>;
  let osUrl = '';
  const tokens = new RunTokens();
  beforeAll(async () => {
    fake = await startFakeOpenAI();
    const app = new Hono().route('/mcp', mcpRoutes({ tokens, store: new MemoryOsStore() }));
    await new Promise<void>((r) => {
      osServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => r());
    });
    osUrl = `http://127.0.0.1:${(osServer.address() as AddressInfo).port}/mcp`;
  });
  afterAll(async () => {
    osServer?.close();
    await fake?.close();
  });

  const run = async (mode: string, over: Partial<RunRequest> = {}) => {
    const req: RunRequest = { runId: `run-sk-${Math.random()}`, workspaceId: 'ws', agentId: 'a', agentKey: 'scout', instructions: 'Per-run context.', taskInput: 'go', workspaceDir: path.join(root, 'agent'), modelAlias: 'local-worker', maxTurns: 6, runToken: tokens.issue({ workspaceId: 'ws', agentId: 'a', runId: 'r', taskId: 't' }), timeoutMs: 20_000, ...over };
    const out: RunEvent[] = [];
    for await (const e of createOpenAIAgentsRuntime({ osUrl, baseUrl: fake.url(encodeURIComponent(mode)) }).start(req)) out.push(e);
    return out;
  };
  const done = (events: RunEvent[]) => (events.at(-1) as { output?: string }).output ?? JSON.stringify(events.at(-1));

  it('tells the model the skills in its instructions and gives it load_skill', async () => {
    const before = fake.seen.length;
    await run('ok');
    const body = JSON.parse(fake.seen[before]!.body) as { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    const system = body.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Per-run context.');
    expect(system).toContain('- cite-sources:');
    expect(system).not.toContain('Quote the source');
    expect(body.tools.map((t) => t.function.name)).toContain('load_skill');
  });

  it('returns the skill text to the model when it asks for a granted skill', async () => {
    const events = await run('skill:cite-sources');
    expect(done(events)).toContain('Quote the source');
    expect(events.some((e) => e.type === 'tool_result' && e.ok)).toBe(true);
  });

  it('answers the model with a plain refusal, not a crash, for a skill it was not granted or a path', async () => {
    for (const name of ['made-up', '../outside', '../secret.txt']) {
      const events = await run(`skill:${name}`);
      expect(events.at(-1)!.type, name).toBe('done');
      expect(done(events), name).toMatch(/do not have a skill|not a skill name/);
      expect(done(events), name).not.toContain(SECRET);
    }
  });

  it('gives no load_skill tool to an agent that has no skills', async () => {
    const before = fake.seen.length;
    await run('ok', { workspaceDir: path.join(root, 'empty-agent') });
    const body = JSON.parse(fake.seen[before]!.body) as { tools?: { function: { name: string } }[] };
    expect((body.tools ?? []).map((t) => t.function.name)).not.toContain('load_skill');
  });
});
