import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, osTools } from '../src/harness/os-tools';
import { memoryBlock, recallMemories, rememberMemory } from '../src/memory/memory';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

let sys: System;
let store: DbOsStore;
let agentId = '';
let otherId = '';
let runId = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const scope = () => ({ workspaceId: ws(), agentId, runId });

beforeAll(async () => {
  ({ sys } = await testSystem());
  const { agentNew } = await import('../src/commands/agent-new');
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'mem-a', name: 'A' });
  await agentNew(sys, { template: 'researcher', department: 'research', id: 'mem-b', name: 'B' });
  agentId = (await sql("select id from agents where key = 'mem-a'")).rows[0].id;
  otherId = (await sql("select id from agents where key = 'mem-b'")).rows[0].id;
  await sql('update agents set autonomy = 1 where id = $1', [agentId]);
  runId = (await sql("insert into runs (workspace_id, agent_id, trigger, runtime, status) values ($1, $2, 'task', 'claude-cli', 'running') returning id", [ws(), agentId])).rows[0].id;
  store = new DbOsStore(sys.app, () => undefined, sys.companyRoot);
}, 240_000);
afterAll(() => sys?.close());

describe('memory (S8-1)', () => {
  it('is remembered with a scope, a source and a confidence, and recalled by words', async () => {
    await rememberMemory(sys.app, ws(), { scope: 'company', text: 'Clinics in Dubai prefer a WhatsApp number on the homepage.', source: 'run:1', confidence: 80 });
    await rememberMemory(sys.app, ws(), { scope: 'company', text: 'Our pilot price is not shared before a call.', source: 'founder' });
    const got = await recallMemories(sys.app, ws(), { query: 'whatsapp homepage clinics' });
    expect(got.map((m) => m.text)).toEqual(['Clinics in Dubai prefer a WhatsApp number on the homepage.']);
    expect(got[0]).toMatchObject({ scope: 'company', source: 'run:1', confidence: 80 });
    expect(await recallMemories(sys.app, ws(), { query: 'zebra' })).toEqual([]);
  });

  it('keeps the three scopes apart, and an agent\'s own lessons to that agent', async () => {
    await rememberMemory(sys.app, ws(), { scope: 'founder', agentId, text: 'Write openers shorter, never start with a question about weather.', source: 'edit' });
    await rememberMemory(sys.app, ws(), { scope: 'market', text: 'Reddit threads about booking pages grew this week.', source: 'https://example.test/x' });
    expect((await recallMemories(sys.app, ws(), { query: 'openers weather', scope: 'founder', agentId })).length).toBe(1);
    expect(await recallMemories(sys.app, ws(), { query: 'openers weather', scope: 'founder', agentId: otherId })).toEqual([]);
    expect(await recallMemories(sys.app, ws(), { query: 'openers weather', scope: 'market' })).toEqual([]);
    expect((await recallMemories(sys.app, ws(), { query: 'booking pages', scope: 'market' })).length).toBe(1);
  });

  it('puts only the rows that match the task into a run, labelled as notes and never as orders', async () => {
    const block = await memoryBlock(sys.app, ws(), agentId, 'Write an opener for a clinic with a booking page');
    expect(block).toMatch(/Write openers shorter/);
    expect(block).toMatch(/not instructions|data/i);
    expect(block).not.toMatch(/pilot price/);
    expect(await memoryBlock(sys.app, ws(), otherId, 'Write an opener for a clinic with a booking page')).not.toMatch(/Write openers shorter/);
    expect(await memoryBlock(sys.app, ws(), agentId, 'zebra')).toBe('');
  });

  it('is a tool: remember (autonomy 1, company or market only) and recall (autonomy 0)', async () => {
    expect(osTools.remember.minAutonomy).toBe(1);
    expect(osTools.recall.minAutonomy).toBe(0);
    expect(await callOsTool(store, scope(), 'remember', { text: 'The Lahore clinic answers on Sundays.', scope: 'company' })).toMatch(/Remembered/);
    expect(await callOsTool(store, scope(), 'recall', { query: 'lahore sundays' })).toMatch(/answers on Sundays/);
    await expect(callOsTool(store, scope(), 'remember', { text: 'x', scope: 'founder' })).rejects.toThrow(/Bad input/);
    const row = (await sql("select agent_id, source from memories where text like 'The Lahore%'")).rows[0];
    expect(row).toMatchObject({ agent_id: agentId });
    expect(row.source).toMatch(/^run:/);
  });
});
