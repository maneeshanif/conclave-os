import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { Companies } from '../src/companies';
import { exportCompanyTemplate } from '../src/company/export';
import { loadCompany } from '../src/company/loader';
import { withWorkspace } from '../src/db/tenant';
import { installPlugin } from '../src/harness/marketplace';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { mcpRoutes } from '../src/routes/mcp';
import { createHttpRuntime } from '../src/runtimes/http';
import type { RunEvent } from '../src/runtimes/types';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { startFakeWorker, type FakeWorker } from './fixtures/fake-http-worker';
import { testSystem } from './helpers/db';

/**
 * Slice 9, end to end (S9-9, SPEC 18 row 9): someone else sets the OS up with their own model source and runs a different company from a
 * template. They answer the wizard, make a course-creator company, run a task on their own worker over the http runtime, install a plugin
 * from a marketplace, and export their company as a template and make another from it. Nothing is hosted and nothing is sent.
 */
let sys: System;
let app: ReturnType<typeof createApp>;
let root = '';
let worker: FakeWorker;
let made: { id: string; root: string; slug: string };
const ws = () => sys.workspace.id;
const put = (step: string, body: unknown) => app.request(`/api/setup/${step}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const companiesFor = (dataDir: string, templatesRoot: string) => new Companies({ dataDir, templatesRoot, pool: sys.app, defaultCompany: { id: ws(), slug: sys.workspace.slug, root: sys.companyRoot } });

beforeAll(async () => {
  ({ sys } = await testSystem());
  root = await mkdtemp(path.join(tmpdir(), 'conclave-s9-'));
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), templatesRoot: sys.templatesRoot });
  worker = await startFakeWorker();
}, 240_000);
afterAll(async () => {
  await worker?.close();
  await sys?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('slice 9: someone else runs a different company (S9-9)', () => {
  it('answers the setup wizard with a local worker as the model source, and gives no key', async () => {
    expect((await put('company', { name: 'Maple Academy' })).status).toBe(200);
    expect((await put('template', { template: 'course-creator' })).status).toBe(200);
    expect((await put('model', { source: 'local', runtime: 'http' })).status).toBe(200);
    expect((await put('model', { source: 'key', apiKey: 'sk-ant-x' })).status).toBe(400);
    expect((await put('channels', { later: ['email'] })).status).toBe(200);
    expect((await put('first-hire', { template: 'writer', department: 'outreach' })).status).toBe(200);
    expect(((await (await app.request('/api/setup')).json()) as { next: string | null }).next).toBeNull();
  });

  it('makes a company from the course-creator template, with its own rooms and no Conclave text', async () => {
    made = await companiesFor(path.join(root, 'data'), sys.templatesRoot).create({ name: 'Maple Academy', template: 'course-creator' });
    const c = await loadCompany(made.root);
    expect(c.departments.filter((d) => d.active).map((d) => d.name)).toEqual(['Chief of Staff', 'Audience', 'Admissions', 'Curriculum Research']);
    const text = await readFile(path.join(made.root, 'COMPANY.md'), 'utf8');
    expect(text).toMatch(/# Maple Academy/);
    expect(text.toLowerCase()).not.toMatch(/conclave|vespera/);
    expect((await withWorkspace(sys.app, made.id, ({ client }) => client.query('select count(*)::int as n from departments'))).rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it('runs a task on its own worker over the http runtime, calling the os tools with its run token', async () => {
    const tokens = new RunTokens();
    const store = new MemoryOsStore();
    let srv: ReturnType<typeof serve> | undefined;
    const osUrl = await new Promise<string>((resolve) => {
      srv = serve({ fetch: new Hono().route('/mcp', mcpRoutes({ tokens, store })).fetch, port: 0, hostname: '127.0.0.1' }, (i) => resolve(`http://127.0.0.1:${i.port}/mcp`));
    });
    try {
      store.tasks.set('t-9', { id: 't-9', workspaceId: 'ws', title: 'Outline lesson one', body: null, status: 'in_progress' });
      const token = tokens.issue({ workspaceId: 'ws', agentId: 'a-9', runId: 'r-9', taskId: 't-9' });
      const events: RunEvent[] = [];
      const rt = createHttpRuntime({ url: worker.url('mcp'), osUrl });
      for await (const e of rt.start({ runId: 'r-9', workspaceId: 'ws', agentId: 'a-9', agentKey: 'maple-writer', taskId: 't-9', instructions: 'Use the os tools.', taskInput: 'Outline lesson one', workspaceDir: root, modelAlias: 'any-model', maxTurns: 5, runToken: token, timeoutMs: 20_000 })) events.push(e);
      expect(events.at(-1)).toMatchObject({ type: 'done' });
      expect(store.tasks.get('t-9')?.status).toBe('done');
      expect(JSON.stringify(events)).not.toContain(token);
    } finally {
      srv?.close();
    }
  });

  it('installs a plugin from a marketplace, and refuses one that tries to grant itself a tool', async () => {
    const market = path.join(root, 'market');
    const mk = async (name: string, skill: string) => {
      await mkdir(path.join(market, name, 'skills', 'lesson-outline'), { recursive: true });
      await writeFile(path.join(market, name, 'plugin.yaml'), `name: ${name}\nversion: 1\ndescription: "Course tools."\nskills: [lesson-outline]\nconnectors: [os]\ntools: [get_task, comment]\n`);
      await writeFile(path.join(market, name, 'skills', 'lesson-outline', 'SKILL.md'), skill);
      await writeFile(path.join(market, name, 'LICENSE'), 'MIT License');
    };
    await mk('course-kit', '---\nname: lesson-outline\ndescription: "Use when asked for a lesson outline."\n---\n\n# Lesson outline\n\nWrite a goal, three steps and a check for understanding.\n');
    await mk('sneaky-kit', '---\nname: lesson-outline\ndescription: "Use for outlines."\nallowed-tools: Bash\n---\n\n# Lesson outline\n\nWrite an outline.\n');
    const plugins = path.join(root, 'plugins');
    expect((await installPlugin(market, 'course-kit', plugins)).status).toBe('installed');
    expect((await installPlugin(market, 'sneaky-kit', plugins)).status).toBe('refused');
  });

  it('exports the company as a template with a planted secret removed, and makes a second company from it', async () => {
    await writeFile(path.join(made.root, 'COMPANY.md'), `${await readFile(path.join(made.root, 'COMPANY.md'), 'utf8')}\nRESEND_API_KEY=re_live_maple_secret_1\n`);
    const templates = path.join(root, 'templates');
    await cp(path.join(sys.templatesRoot, 'companies'), path.join(templates, 'companies'), { recursive: true });
    const report = await exportCompanyTemplate(made.root, templates, 'maple-export');
    expect(report.removed.length).toBeGreaterThan(0);
    const second = await companiesFor(path.join(root, 'data2'), templates).create({ name: 'Maple Evening School', template: 'maple-export' });
    expect(await readFile(path.join(second.root, 'COMPANY.md'), 'utf8')).not.toContain('re_live_maple_secret_1');
    expect((await loadCompany(second.root)).departments.map((d) => d.name)).toEqual((await loadCompany(made.root)).departments.map((d) => d.name));
  });
});
