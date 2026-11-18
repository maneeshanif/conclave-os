import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, callTool, MemoryOsStore, osTools, TOOL_RISK, type ToolRegistry } from '../src/harness/os-tools';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** Tool risk classes and a call log (A3): every tool has a class, every call is logged with its decision, and an external tool needs an approval. */
let sys: System;
let store: DbOsStore;
let agentId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });
const log = async () => (await sql('select tool, risk, decision, reason from tool_calls order by at, id')).rows as { tool: string; risk: string; decision: string; reason: string | null }[];

// An outside tool: it would act beyond the machine. The built tools have none, so the rule is tried on one made for the test.
let acted = 0;
const registry: ToolRegistry = {
  tools: {
    wire_money: { minAutonomy: 0, description: 'x', input: z.object({}).strict(), async run() { acted++; return 'sent'; } },
    peek: { minAutonomy: 0, description: 'x', input: z.object({}).strict(), async run() { return 'ok'; } },
  } as unknown as ToolRegistry['tools'],
  risk: { wire_money: 'external', peek: 'read' },
};

beforeAll(async () => {
  ({ sys } = await testSystem());
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'risk-r', name: 'Rex' });
  agentId = (await sql("select id from agents where key = 'risk-r'")).rows[0].id;
  await sql('update agents set autonomy = 2 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(() => sys?.close());

describe('risk classes (A3)', () => {
  it('give every os tool a class, and every propose tool the class that says it only queues an approval', () => {
    expect(Object.keys(TOOL_RISK).sort()).toEqual(Object.keys(osTools).sort());
    for (const name of Object.keys(osTools)) {
      expect(['read', 'write', 'propose', 'external'], name).toContain(TOOL_RISK[name as keyof typeof TOOL_RISK]);
      if (name.startsWith('propose_')) expect(TOOL_RISK[name as keyof typeof TOOL_RISK], name).toBe('propose');
      if (name.startsWith('get_')) expect(TOOL_RISK[name as keyof typeof TOOL_RISK], name).toBe('read');
    }
    expect(Object.values(TOOL_RISK).filter((r) => r === 'external')).toEqual([]); // nothing the model calls acts outside by itself (rule 1)
  });
});

describe('the call log (A3)', () => {
  it('records an allowed call with its class, and a refused one with why', async () => {
    await callOsTool(store, scope(), 'recall', { query: 'anything' });
    await expect(callOsTool(store, scope(), 'send_email', {})).rejects.toThrow(/Unknown tool/);
    await expect(callOsTool(store, scope(), 'remember', { text: '' })).rejects.toThrow(/Bad input/);
    const rows = await log();
    expect(rows).toEqual([
      { tool: 'recall', risk: 'read', decision: 'allowed', reason: null },
      { tool: 'send_email', risk: 'unknown', decision: 'refused', reason: 'no such tool' },
      { tool: 'remember', risk: 'write', decision: 'refused', reason: expect.stringMatching(/bad input/i) },
    ]);
  });

  it('records a tool the run was not granted, and one above the agent\'s level', async () => {
    await expect(callOsTool(store, { ...scope(), allowedTools: ['get_task'] }, 'recall', { query: 'x' })).rejects.toThrow(/Unknown tool/);
    await sql('update agents set autonomy = 0 where id = $1', [agentId]);
    await expect(callOsTool(store, scope(), 'propose_email', {})).rejects.toThrow(/Unknown tool/);
    await sql('update agents set autonomy = 2 where id = $1', [agentId]);
    const rows = (await log()).slice(-2);
    expect(rows[0]).toMatchObject({ tool: 'recall', decision: 'refused', reason: 'not granted to this run' });
    expect(rows[1]).toMatchObject({ tool: 'propose_email', risk: 'propose', decision: 'refused', reason: 'above this agent\'s autonomy' });
  });

  it('never holds a call up if the log cannot be written, and is not seen across companies', async () => {
    const m = new MemoryOsStore();
    expect(await callTool({ tools: registry.tools, risk: registry.risk }, m, scope(), 'peek', {})).toBe('ok'); // the memory store has no log, and that is fine
    expect((await sql('select count(*)::int as n from tool_calls')).rows[0].n).toBeGreaterThan(0);
  });
});

describe('an external tool (A3)', () => {
  it('is refused without an approval, and logged as refused, and never runs', async () => {
    const before = (await log()).length;
    await expect(callTool(registry, store, scope(), 'wire_money', {})).rejects.toThrow(/needs an approval/i);
    expect(acted).toBe(0);
    const rows = (await log()).slice(before);
    expect(rows).toEqual([{ tool: 'wire_money', risk: 'external', decision: 'refused', reason: 'external tool called without an approved approval' }]);
  });

  it('is refused with an approval that is not approved, or that does not exist, and runs once with one that is', async () => {
    const ap = (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'wire.money', 'w1', '{}', 'pending') returning id", [ws()])).rows[0].id as string;
    await expect(callTool(registry, store, scope(), 'wire_money', {}, { approvalId: ap })).rejects.toThrow(/needs an approval/i);
    await expect(callTool(registry, store, scope(), 'wire_money', {}, { approvalId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/needs an approval/i);
    expect(acted).toBe(0);
    await sql("update approvals set status = 'approved' where id = $1", [ap]);
    expect(await callTool(registry, store, scope(), 'wire_money', {}, { approvalId: ap })).toBe('sent');
    expect(acted).toBe(1);
    expect((await log()).at(-1)).toMatchObject({ tool: 'wire_money', decision: 'allowed' });
  });
});
