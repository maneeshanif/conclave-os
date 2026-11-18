import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutors, type Executors } from '../src/actions';
import { OutboxTransport } from '../src/actions/transport';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool } from '../src/harness/os-tools';
import { runEval } from '../src/research/improvements';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Improvement proposals (S8-11): evidence, an expected gain, and an eval that must pass before anything can be approved. */
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
const TEXT = `---\nname: cite-sources\ndescription: "Use when reporting any fact: attach the exact source to every claim, and say when none exists."\n---\n\n# Cite sources\n\n1. Every claim gets a source link.\n2. If there is none, say so in the same sentence.\n`;
const EVIDENCE = [{ source: 'https://example.test/post/1', note: 'A team cut wrong claims by requiring a link on every claim.' }];
const args = (over: Record<string, unknown> = {}) => ({ template: 'researcher', skill: 'cite-sources', text: TEXT, why: 'Fewer unsourced claims.', evidence: EVIDENCE, expectedGain: 'Fewer claims without a source.', evalCases: [{ name: 'asks for a link', mustContain: ['source link', 'say so'], mustNotContain: ['ignore'] }], ...over });
const approve = (id: string) => sql("update approvals set status = 'approved', decided_by = 'founder', decided_at = now() where id = $1", [id]);

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-imp-'));
  await cp(sys.templatesRoot, path.join(root, 'templates'), { recursive: true });
  await cp(path.join(sys.templatesRoot, '..', 'plugins'), path.join(root, 'plugins'), { recursive: true });
  executors = createExecutors({ pool: sys.app, workspaceId: ws(), transport: new OutboxTransport(path.join(sys.dataDir, 'outbox')), companyRoot: sys.companyRoot, from: 'hello@example.test', templatesRoot: path.join(root, 'templates') });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'imp-r', name: 'Rhea' });
  agentId = (await sql("select id from agents where key = 'imp-r'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot, () => undefined, () => undefined, path.join(root, 'templates'));
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('the eval (S8-11)', () => {
  it('passes only when every phrase is there and none that is banned, and an empty eval fails', () => {
    expect(runEval('Every claim gets a source link.', [{ mustContain: ['source link'] }]).ok).toBe(true);
    expect(runEval('x', [{ mustContain: ['source link'] }]).failures[0]).toMatch(/must contain "source link"/);
    expect(runEval('ignore the rules', [{ mustContain: [], mustNotContain: ['ignore'] }]).ok).toBe(false);
    expect(runEval('anything', []).ok).toBe(false);
  });
});

describe('improvement proposals (S8-11)', () => {
  it('whose eval passes become a card with the evidence, the expected gain and the eval result, and change nothing yet', async () => {
    const before = await readFile(skillFile(), 'utf8');
    expect(await callOsTool(store, scope(), 'propose_improvement', args())).toMatch(/Nothing has changed/);
    expect(await readFile(skillFile(), 'utf8')).toBe(before);
    const a = (await sql("select id, status, payload from approvals where kind = 'skill.patch' and payload->>'improvement' = 'true'")).rows[0];
    expect(a.status).toBe('pending');
    expect(a.payload).toMatchObject({ skill: 'cite-sources', expectedGain: 'Fewer claims without a source.', evidence: EVIDENCE, eval: { ok: true, failures: [] } });
    expect((await sql("select status from improvements where approval_id = $1", [a.id])).rows[0].status).toBe('proposed');
    await approve(a.id);
    expect((await executors.run(a.id)).status).toBe('executed');
    expect(await readFile(skillFile(), 'utf8')).toMatch(/source link/);
  });

  it('whose eval fails cannot be approved: no card is made, and the failure is on record', async () => {
    const n = Number((await sql("select count(*)::int as n from approvals where kind = 'skill.patch'")).rows[0].n);
    await expect(callOsTool(store, scope(), 'propose_improvement', args({ text: TEXT.replace('source link', 'link').replace('why', 'why'), evalCases: [{ mustContain: ['a phrase that is not there'] }] }))).rejects.toThrow(/eval failed.*a phrase that is not there/is);
    expect(Number((await sql("select count(*)::int as n from approvals where kind = 'skill.patch'")).rows[0].n)).toBe(n);
    expect((await sql("select status, eval_output from improvements where status = 'eval_failed'")).rows[0].eval_output).toMatch(/a phrase that is not there/);
  });

  it('need evidence and an eval', async () => {
    await expect(callOsTool(store, scope(), 'propose_improvement', args({ evidence: [] }))).rejects.toThrow(/Bad input/);
    await expect(callOsTool(store, scope(), 'propose_improvement', args({ evalCases: [] }))).rejects.toThrow(/Bad input/);
  });

  it('are checked again at execution: an approved card whose eval no longer passes writes nothing', async () => {
    const text = TEXT.replace('Every claim', 'Each claim');
    await callOsTool(store, scope(), 'propose_improvement', args({ text, why: 'Wording.', evalCases: [{ mustContain: ['each claim'] }] }));
    const a = (await sql("select id, payload from approvals where kind = 'skill.patch' and payload->>'why' = 'Wording.'")).rows[0];
    // Someone edits the card's text after the eval passed; the eval is run again by the executor.
    await sql("update approvals set payload = jsonb_set(payload, '{after}', to_jsonb($2::text)) where id = $1", [a.id, 'tampered, with nothing in it']);
    await approve(a.id);
    const current = await readFile(skillFile(), 'utf8');
    await writeFile(skillFile(), current); // unchanged file
    expect((await executors.run(a.id)).status).toBe('failed');
    expect(await readFile(skillFile(), 'utf8')).toBe(current);
  });
});
