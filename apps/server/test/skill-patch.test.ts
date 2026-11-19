import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { recallMemories } from '../src/memory/memory';
import { reflectOnRun } from '../src/memory/reflect';
import { applySkillPatch, skillVersion } from '../src/memory/skills';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Reflect and skill patches (S8-3): a skill never changes silently, and an agent writes nothing about itself until switched on. */
let sys: System;
let root = '';
let store: DbOsStore;
let executors: Executors;
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const skillFile = () => path.join(root, 'templates', 'agents', 'researcher', 'skills', 'cite-sources', 'SKILL.md');
const NEW_TEXT = `---\nname: cite-sources\ndescription: "Use when reporting any fact: attach the exact source (file and line, or URL) to every claim, and say when you could not find one."\n---\n\n# Cite sources\n\n1. Every claim gets a source.\n2. If there is none, say so in the same sentence.\n`;
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-skill-'));
  await cp(sys.templatesRoot, path.join(root, 'templates'), { recursive: true });
  await cp(path.join(sys.templatesRoot, '..', 'plugins'), path.join(root, 'plugins'), { recursive: true });
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', templatesRoot: path.join(root, 'templates') });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'skill-ra', name: 'Ra' });
  agentId = (await sql("select id from agents where key = 'skill-ra'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'succeeded') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot, () => undefined, () => undefined, path.join(root, 'templates'));
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('skill patches (S8-3)', () => {
  it('are refused while self-writing is off, which is how every agent starts', async () => {
    expect((await sql('select self_writing from agents where id = $1', [agentId])).rows[0].self_writing).toBe(false);
    await expect(callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text: NEW_TEXT, why: 'Clearer.' })).rejects.toThrow(/self-writing is off/i);
  });

  it('change nothing until approved; then the file is patched once, its version goes up and the old text is in the card', async () => {
    await sql('update agents set self_writing = true where id = $1', [agentId]);
    const before = await readFile(skillFile(), 'utf8');
    expect(await callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text: NEW_TEXT, why: 'Say when no source exists.' })).toMatch(/Nothing has changed/);
    expect(await readFile(skillFile(), 'utf8')).toBe(before);
    const a = (await sql("select id, status, payload from approvals where kind = 'skill.patch'")).rows[0];
    expect(a.status).toBe('pending');
    expect(a.payload).toMatchObject({ skill: 'cite-sources', why: 'Say when no source exists.', fromVersion: skillVersion(before), toVersion: skillVersion(before) + 1 });
    expect(a.payload.before).toBe(before);
    expect(a.payload.diff).toMatch(/^\+.*say when you could not find one/m);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    expect(await readFile(skillFile(), 'utf8')).toBe(before);

    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    const after = await readFile(skillFile(), 'utf8');
    expect(after).toMatch(/Every claim gets a source/);
    expect(skillVersion(after)).toBe(skillVersion(before) + 1);
    expect((await executors.run(a.id)).status).toBe('already_claimed');
    // The same text is the same proposal.
    expect(await callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text: NEW_TEXT, why: 'Say when no source exists.' })).toMatch(/Already queued|Queued/);
  });

  it('refuse a skill the agent does not have, a text that renames the skill, and one that is empty', async () => {
    await expect(callOsTool(store, scope(), 'propose_skill_patch', { skill: 'no-such-skill', text: NEW_TEXT, why: 'x' })).rejects.toThrow(/not one of your skills/i);
    await expect(callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text: NEW_TEXT.replace('name: cite-sources', 'name: other'), why: 'x' })).rejects.toThrow(/name/i);
    await expect(callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text: 'no frontmatter', why: 'x' })).rejects.toThrow(/frontmatter|name/i);
  });

  it('fail at execution, changing nothing, if the skill changed after the proposal', async () => {
    const text = NEW_TEXT.replace('Every claim', 'Each claim');
    await callOsTool(store, scope(), 'propose_skill_patch', { skill: 'cite-sources', text, why: 'Wording.' });
    const a = (await sql("select id from approvals where kind = 'skill.patch' and payload->>'why' = 'Wording.'")).rows[0];
    const { writeFile } = await import('node:fs/promises');
    await writeFile(skillFile(), 'edited by hand meanwhile\n');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('failed');
    expect(await readFile(skillFile(), 'utf8')).toBe('edited by hand meanwhile\n');
  });

  it('applySkillPatch keeps the name and description, takes the new body, and adds the version', () => {
    const out = applySkillPatch('---\nname: a\ndescription: "d"\nversion: 3\n---\n\nold\n', '---\nname: a\ndescription: "d2"\n---\n\nnew\n');
    expect(out).toMatch(/version: 4/);
    expect(out).toMatch(/description: "d2"/);
    expect(out).toMatch(/new/);
  });
});

describe('the reflect pass (S8-3)', () => {
  it('saves nothing for an agent that has not switched self-writing on, or for a short run', async () => {
    await sql('update agents set self_writing = false where id = $1', [agentId]);
    for (let i = 0; i < 5; i++) await sql("insert into run_events (workspace_id, run_id, type, data) values ($1, $2, 'tool_call', '{}')", [ws(), runId]);
    expect(await reflectOnRun(sys.app, ws(), runId, 'Found three clinics with phone-only booking.')).toBe(false);
    await sql('update agents set self_writing = true where id = $1', [agentId]);
    const short = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'succeeded') returning id", [ws(), agentId])).rows[0].id as string;
    expect(await reflectOnRun(sys.app, ws(), short, 'Quick.')).toBe(false);
  });

  it('saves a low-confidence company note, with its run as the source, after a long run by an agent that has it on', async () => {
    expect(await reflectOnRun(sys.app, ws(), runId, 'Found three clinics with phone-only booking.')).toBe(true);
    const got = await recallMemories(sys.app, ws(), { query: 'clinics phone booking', agentId });
    expect(got[0]).toMatchObject({ scope: 'company', source: `run:${runId}` });
    expect(got[0]!.confidence).toBeLessThanOrEqual(50);
    expect(await reflectOnRun(sys.app, ws(), runId, 'Found three clinics with phone-only booking.')).toBe(false); // once per run
  });
});
