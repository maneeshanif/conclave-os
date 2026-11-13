import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, osTools } from '../src/harness/os-tools';
import { loadPlugin } from '../src/harness/plugins';
import { loadTemplate } from '../src/harness/render';
import { allowedToolsFor } from '../src/harness/trust';
import { checkHook } from '../src/hooks';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';
import path from 'node:path';

const good = { pattern: 'Opens with a number and a promise, then one concrete example in the first line', exampleUrl: 'https://x.test/acme/status/99', platform: 'x', format: 'single post', notes: 'Held attention: replies and bookmarks were high.' };

describe('what counts as a hook (S5-6)', () => {
  it('accepts a description of a pattern with a link to the example', () => {
    expect(checkHook(good).ok).toBe(true);
  });
  it('refuses a missing or non-web example link', () => {
    for (const exampleUrl of ['', 'not a url', 'javascript:alert(1)', 'file:///x']) expect(checkHook({ ...good, exampleUrl }).ok, exampleUrl).toBe(false);
  });
  it('refuses a copy of the example: a long verbatim quote in the pattern or notes', () => {
    const quote = 'This is the exact sentence somebody else wrote word for word and posted on their account last week for their audience to read';
    expect(checkHook({ ...good, pattern: `Opens with "${quote}"` }).reasons.join(' ')).toMatch(/quote|copy/i);
    expect(checkHook({ ...good, notes: `“${quote}”` }).ok).toBe(false);
    expect(checkHook({ ...good, pattern: 'Opens with "Stop doing this" then a list' }).ok).toBe(true); // a short quoted phrase is fine
  });
  it('refuses a pattern that is a whole post rather than a pattern', () => {
    expect(checkHook({ ...good, pattern: 'word '.repeat(60) }).reasons.join(' ')).toMatch(/too long/i);
  });
});

describe('add_hook (S5-6)', () => {
  let sys: System;
  let store: DbOsStore;
  let agentId = '';
  let runId = '';
  let taskId = '';
  const ws = () => sys.workspace.id;
  const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
  const tool = (name: string, args: unknown) => callOsTool(store, { workspaceId: ws(), agentId, runId, taskId }, name, args).then((r) => ({ ok: true as const, text: r }), (e: Error) => ({ ok: false as const, text: e.message }));

  beforeAll(async () => {
    ({ sys } = await testSystem());
    store = new DbOsStore(sys.app);
    await agentNew(sys, { template: 'hook-scout', department: 'marketing', id: 'hook-scout-1' });
    agentId = (await sql("select id from agents where key = 'hook-scout-1'")).rows[0].id;
    taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 'hooks', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
    runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'openai-agents', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
  }, 240_000);
  afterAll(async () => sys?.close());
  beforeEach(async () => {
    await sql('update agents set autonomy = 1 where id = $1', [agentId]);
    await sql('delete from hooks');
  });

  it('needs autonomy 1', async () => {
    expect(osTools.add_hook.minAutonomy).toBe(1);
    await sql('update agents set autonomy = 0 where id = $1', [agentId]);
    expect((await tool('add_hook', good)).text).toMatch(/Unknown tool/);
  });

  it('files the pattern with the link to its example and who found it', async () => {
    const r = await tool('add_hook', good);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Filed hook/);
    expect((await sql('select pattern, example_url, platform, format, found_by from hooks')).rows[0]).toMatchObject({ pattern: good.pattern, example_url: good.exampleUrl, platform: 'x', format: 'single post', found_by: 'agent:hook-scout-1' });
  });

  it('keeps one hook per example, however the address is written', async () => {
    await tool('add_hook', good);
    const again = await tool('add_hook', { ...good, exampleUrl: `${good.exampleUrl}/?utm_source=a#b`, pattern: 'A different description of it' });
    expect(again.text).toMatch(/already filed/i);
    expect((await sql('select count(*)::int as n from hooks')).rows[0].n).toBe(1);
  });

  it('refuses a hook with no example link, a copied quote, an unknown field, and a score set by the scout', async () => {
    expect((await tool('add_hook', { ...good, exampleUrl: undefined })).ok).toBe(false);
    expect((await tool('add_hook', { ...good, pattern: 'Opens with "this is the exact sentence somebody else wrote word for word and posted last week for everyone to read"' })).text).toMatch(/quote|copy/i);
    expect((await tool('add_hook', { ...good, score: 99 })).ok).toBe(false);
    expect((await tool('add_hook', { ...good, platform: 'x'.repeat(50) })).ok).toBe(false);
    expect((await sql('select count(*)::int as n from hooks')).rows[0].n).toBe(0);
  });

  it('is audited against the agent', async () => {
    await tool('add_hook', good);
    expect((await sql("select actor from audit_log where action = 'hook.filed'")).rows[0]).toMatchObject({ actor: 'agent:hook-scout-1' });
  });

  it('cannot reach any tool that proposes or publishes: the low-trust list for the hook scout has none', async () => {
    const t = await loadTemplate(path.join(REPO_ROOT, 'templates'), 'hook-scout');
    expect(t.file.defaults).toMatchObject({ trust: 'low', runtime: 'openai-agents', model: 'local-worker', autonomy: 1 });
    const allowed = allowedToolsFor('low', t.plugins.map((p) => p.tools))!;
    expect(allowed).toContain('add_hook');
    expect(allowed.filter((n) => /propose|publish|send|add_lead/.test(n))).toEqual([]);
    expect((await loadPlugin(path.join(REPO_ROOT, 'plugins'), 'hooks-kit')).tools.some((n) => /propose|publish|send/.test(n))).toBe(false);
  });
});
