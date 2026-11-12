import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { loadTemplate, renderRoleFile, renderWorkdir, type WorkdirContext } from '../src/harness/render';
import { REPO_ROOT, isInside } from '../src/paths';

const templatesRoot = path.join(REPO_ROOT, 'templates');
const params = {
  id: 'outreach-writer',
  name: 'Copywriter',
  department: 'outreach',
  department_name: 'Outreach',
  company_name: 'Acme Test Co',
};

async function ctx(): Promise<WorkdirContext> {
  return {
    dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')),
    workspaceSlug: 'local',
    companyName: 'Acme Test Co',
    companyMd: '# Acme Test Co\nWe test things.',
    departmentName: 'Outreach',
    osUrl: 'http://127.0.0.1:3100/mcp',
    templatesRoot,
  };
}

async function listFiles(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

describe('template renderer (S0-4)', () => {
  it('loads all three slice 0 templates', async () => {
    for (const key of ['lead', 'researcher', 'writer']) {
      const t = await loadTemplate(templatesRoot, key);
      expect(t.permissions.shell).toBe('deny');
      expect(t.connectors).toContain('os');
    }
  });

  it('renders the writer role file (snapshot)', async () => {
    const text = renderRoleFile(await loadTemplate(templatesRoot, 'writer'), params);
    expect(text).toMatchSnapshot();
    const parsed = parseRoleFile(text, 'x/AGENT.md');
    expect(parsed.role).toMatchObject({ runtime: 'claude-cli', autonomy: 0, template: 'writer' });
  });

  it('fails when a required parameter is missing', async () => {
    const t = await loadTemplate(templatesRoot, 'writer');
    const missing: Partial<typeof params> = { ...params };
    delete missing.company_name;
    expect(() => renderRoleFile(t, missing as typeof params)).toThrow(/needs parameter "company_name"/);
  });

  it('renders the writer working folder for Claude Code (snapshot), outside the repo, with no shell', async () => {
    const c = await ctx();
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'writer'), params), 'x/AGENT.md');
    const out = await renderWorkdir(agent, c);
    expect(isInside(out.dir, REPO_ROOT)).toBe(false);
    expect(await listFiles(out.dir)).toMatchSnapshot();
    const settings = JSON.parse(await readFile(path.join(out.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.deny).toContain('Bash');
    expect(settings.permissions.allow).not.toContain('Bash');
    // File tools are scoped to the working folder; unscoped search tools are denied (checked with the real CLI).
    expect(settings.permissions.allow).toEqual(['Read(./**)', 'Write(./**)', 'Edit(./**)', 'mcp__os']);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Glob', 'Grep', 'WebFetch']));
    expect(await readFile(path.join(out.dir, 'CLAUDE.md'), 'utf8')).toMatchSnapshot();
    const mcp = JSON.parse(await readFile(path.join(out.dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.os.url).toBe('http://127.0.0.1:3100/mcp');
  });

  it('renders the same writer for OpenCode after a runtime change (snapshot), with no shell', async () => {
    const c = await ctx();
    const t = await loadTemplate(templatesRoot, 'writer');
    const claude = parseRoleFile(renderRoleFile(t, params), 'x/AGENT.md');
    await renderWorkdir(claude, c);
    const oc = parseRoleFile(renderRoleFile(t, { ...params, runtime: 'opencode', model: 'any-model' }), 'x/AGENT.md');
    const out = await renderWorkdir(oc, c);
    const files = await listFiles(out.dir);
    expect(files).toMatchSnapshot();
    expect(files).not.toContain('CLAUDE.md'); // the old target is cleared
    const config = JSON.parse(await readFile(path.join(out.dir, 'opencode.json'), 'utf8'));
    expect(config.permission.bash).toBe('deny');
    expect(config.mcp.os).toMatchObject({ type: 'remote', url: 'http://127.0.0.1:3100/mcp' });
    expect(config.default_agent).toBe('outreach-writer');
  });

  it('refuses a working folder inside the repo', async () => {
    const c = { ...(await ctx()), dataDir: path.join(REPO_ROOT, '.conclave-os') };
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'writer'), params), 'x/AGENT.md');
    await expect(renderWorkdir(agent, c)).rejects.toThrow(/inside the repo/);
  });
});
