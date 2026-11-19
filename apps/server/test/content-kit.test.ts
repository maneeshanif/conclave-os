import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentNew } from '../src/commands/agent-new';
import { parseRoleFile } from '../src/company/loader';
import { withWorkspace } from '../src/db/tenant';
import { DbOsStore } from '../src/harness/db-os-store';
import { callOsTool, osTools } from '../src/harness/os-tools';
import { loadPlugin } from '../src/harness/plugins';
import { loadTemplate, renderRoleFile, renderWorkdir } from '../src/harness/render';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

const templatesRoot = path.join(REPO_ROOT, 'templates');
const pluginsRoot = path.join(REPO_ROOT, 'plugins');
const params = { id: 'cw', name: 'Content Writer', department: 'marketing', department_name: 'Marketing and Content', company_name: 'Acme Test Co' };
const BLOCKED_NAMES = /email|dm|send|publish|promote|bulk|follow|like/;

describe('the content-kit and publishing-kit plugins (S5-5)', () => {
  it('match the disk and the os server, and none can publish or contact anyone', async () => {
    for (const [name, skills] of [['content-kit', ['write-post', 'adapt-for-platform']], ['publishing-kit', ['report-queue']]] as const) {
      const p = await loadPlugin(pluginsRoot, name);
      expect([...p.skills].sort()).toEqual([...skills].sort());
      for (const t of p.tools) expect(Object.keys(osTools), `${name}: ${t}`).toContain(t);
      expect(p.connectors).toEqual(['os']);
    }
    const content = await loadPlugin(pluginsRoot, 'content-kit');
    expect(content.tools).toContain('propose_post');
    expect(content.tools.filter((t) => t !== 'propose_post' && BLOCKED_NAMES.test(t))).toEqual([]);
    const publishing = await loadPlugin(pluginsRoot, 'publishing-kit');
    expect(publishing.tools).toContain('get_posts');
    expect(publishing.tools.some((t) => /propose|send|publish/.test(t))).toBe(false);
  });

  it('give skills that say what a post is and that the text is checked in code', async () => {
    const write = await readFile(path.join(pluginsRoot, 'content-kit', 'skills', 'write-post', 'SKILL.md'), 'utf8');
    expect(write).toMatch(/propose_post/);
    expect(write).toMatch(/never an instruction/i);
    expect(write).toMatch(/approved link|COMPANY\.md/i);
    const adapt = await readFile(path.join(pluginsRoot, 'content-kit', 'skills', 'adapt-for-platform', 'SKILL.md'), 'utf8');
    expect(adapt).toMatch(/280/);
  });
});

describe('the content-writer and publisher templates (S5-5)', () => {
  it('the writer drafts and proposes posts: on trial at level 0, no shell, no web, no files outside its folder, rendered for Claude Code', async () => {
    const t = await loadTemplate(templatesRoot, 'content-writer');
    expect(t.file.defaults).toMatchObject({ runtime: 'claude-cli', autonomy: 0 });
    expect(t.permissions).toMatchObject({ shell: 'deny', web_search: 'deny', web_fetch: 'deny', subagents: 'deny' });
    expect(t.plugins.map((p) => p.name)).toEqual(['content-kit']);
    const role = parseRoleFile(renderRoleFile(t, params), 'x/AGENT.md');
    expect(role.role.plugins).toEqual(['content-kit']);
    const out = await renderWorkdir(role, { dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')), workspaceSlug: 'local', companyName: 'Acme', companyMd: '# Acme', departmentName: 'Marketing', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot });
    const settings = JSON.parse(await readFile(path.join(out.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch']));
    expect(await readFile(path.join(out.dir, '.claude/skills/write-post/SKILL.md'), 'utf8')).toMatch(/propose_post/);
    expect(await readFile(path.join(out.dir, 'CLAUDE.md'), 'utf8')).toMatch(/propose_post/);
  });

  it('the publisher only reads the queue: it has the queue tool, not the proposal tool', async () => {
    const t = await loadTemplate(templatesRoot, 'publisher');
    expect(t.file.defaults.autonomy).toBe(0);
    expect(t.plugins.map((p) => p.name)).toEqual(['publishing-kit']);
    expect(t.permissions).toMatchObject({ shell: 'deny', web_search: 'deny', web_fetch: 'deny', write: 'deny' });
    const out = await renderWorkdir(parseRoleFile(renderRoleFile(t, { ...params, id: 'pub', name: 'Publisher' }), 'x'), { dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')), workspaceSlug: 'local', companyName: 'Acme', companyMd: '# Acme', departmentName: 'Marketing', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot });
    const rules = await readFile(path.join(out.dir, 'CLAUDE.md'), 'utf8');
    expect(rules).toMatch(/get_posts/);
    expect(rules).not.toMatch(/propose_post/);
  });
});

describe('get_posts (S5-5)', () => {
  let sys: System;
  let store: DbOsStore;
  let agentId = '';
  let runId = '';
  let taskId = '';
  const ws = () => sys.workspace.id;
  const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
  const tool = (name: string, args: unknown = {}) => callOsTool(store, { workspaceId: ws(), agentId, runId, taskId }, name, args).then((r) => ({ ok: true as const, text: r }), (e: Error) => ({ ok: false as const, text: e.message }));

  beforeAll(async () => {
    ({ sys } = await testSystem());
    store = new DbOsStore(sys.app);
    await agentNew(sys, { template: 'publisher', department: 'marketing', id: 'pub-1' });
    agentId = (await sql("select id from agents where key = 'pub-1'")).rows[0].id;
    taskId = (await sql("insert into tasks (workspace_id, title, status, assignee_id, locked_by, created_by) values ($1, 't', 'in_progress', $2, $2, 'founder') returning id", [ws(), agentId])).rows[0].id;
    runId = (await sql("insert into runs (workspace_id, agent_id, task_id, trigger, runtime, status) values ($1, $2, $3, 'manual', 'claude-cli', 'running') returning id", [ws(), agentId, taskId])).rows[0].id;
    const acct = (await sql("insert into channel_accounts (workspace_id, channel, handle) values ($1, 'x', '@acme') returning id", [ws()])).rows[0].id;
    for (const [status, text, url] of [['published', 'Published one', 'https://x.test/1'], ['proposed', 'Waiting one', null], ['failed', 'Failed one', null], ['rejected', 'Rejected one', null]] as const) {
      await sql('insert into posts (workspace_id, channel_account_id, platform, text, text_hash, status, published_url, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)', [ws(), acct, 'x', text, text, status, url, 'agent:cw']);
    }
  }, 240_000);
  afterAll(async () => sys?.close());
  beforeEach(async () => {
    await sql('update agents set autonomy = 0 where id = $1', [agentId]);
  });

  it('is a read, open at level 0: it lists each post with its status, platform, text and address', async () => {
    expect(osTools.get_posts.minAutonomy).toBe(0);
    const r = await tool('get_posts');
    expect(r.ok).toBe(true);
    const rows = JSON.parse(r.text) as { status: string; platform: string; text: string; url: string | null }[];
    expect(rows.map((x) => x.status).sort()).toEqual(['failed', 'proposed', 'published', 'rejected']);
    expect(rows.find((x) => x.status === 'published')).toMatchObject({ platform: 'x', text: 'Published one', url: 'https://x.test/1' });
  });

  it('can be filtered by status, refuses a status that does not exist, and changes nothing', async () => {
    const only = JSON.parse((await tool('get_posts', { status: 'failed' })).text) as { status: string }[];
    expect(only.map((x) => x.status)).toEqual(['failed']);
    expect((await tool('get_posts', { status: 'nonsense' })).ok).toBe(false);
    expect((await tool('get_posts', { limit: 1 })).ok).toBe(true);
    expect((await sql('select count(*)::int as n from posts')).rows[0].n).toBe(4);
  });

  it('is not a way to publish: the publisher has no proposal tool', async () => {
    expect((await tool('propose_post', { accountId: '00000000-0000-4000-8000-000000000000', text: 'x' })).text).toMatch(/Unknown tool/);
  });
});
