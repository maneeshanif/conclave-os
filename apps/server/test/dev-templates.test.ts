import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { SHELL_TEMPLATES } from '../src/harness/permissions';
import { loadPlugin } from '../src/harness/plugins';
import { loadTemplate, renderRoleFile, renderWorkdir, type WorkdirContext } from '../src/harness/render';
import { REPO_ROOT } from '../src/paths';

const templatesRoot = path.join(REPO_ROOT, 'templates');
const pluginsRoot = path.join(REPO_ROOT, 'plugins');
const params = { id: 'engineering-coder', name: 'Coder', department: 'engineering', department_name: 'Engineering', company_name: 'Acme Test Co' };

async function ctx(): Promise<WorkdirContext> {
  return { dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')), workspaceSlug: 'local', companyName: 'Acme Test Co', companyMd: '# Acme Test Co\nWe build things.', departmentName: 'Engineering', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot };
}

describe('the coder and code-reviewer templates (S7-4)', () => {
  it('load, and are the only templates that may have a shell', async () => {
    for (const key of ['coder', 'code-reviewer']) {
      const t = await loadTemplate(templatesRoot, key);
      expect(t.permissions.shell, key).toBe('allow');
      expect(t.permissions.web_search, key).toBe('deny');
      expect(t.permissions.subagents, key).toBe('deny');
      expect(t.plugins.map((p) => p.name)).toContain('dev-kit');
      expect(t.connectors).toContain('os');
    }
    expect([...SHELL_TEMPLATES].sort()).toEqual(['code-reviewer', 'coder']);
    // Every other template still has no shell.
    for (const key of (await readdir(path.join(templatesRoot, 'agents'))).filter((k) => !SHELL_TEMPLATES.has(k))) {
      expect((await loadTemplate(templatesRoot, key)).permissions.shell, key).toBe('deny');
    }
  });

  it('render a role file that reads back, with the codex runtime and the shared model alias, at the lowest autonomy', async () => {
    for (const key of ['coder', 'code-reviewer']) {
      const text = renderRoleFile(await loadTemplate(templatesRoot, key), { ...params, id: `engineering-${key}` });
      const role = parseRoleFile(text, `engineering-${key}/AGENT.md`).role;
      expect(role.runtime).toBe('codex');
      expect(role.model).toBe('any-model');
      expect(role.autonomy).toBe(0);
      expect(role.template).toBe(key);
      expect(role.plugins).toContain('dev-kit');
    }
  });

  it('say, in their standing rules, to work only in the worktree, never to push, merge or deploy, and to propose a pull request when the tests pass', async () => {
    for (const key of ['coder', 'code-reviewer']) {
      const t = await loadTemplate(templatesRoot, key);
      expect(t.rules).toMatch(/worktree/i);
      expect(t.rules).toMatch(/never (push|merge|deploy)|do not (push|merge|deploy)/i);
      expect(t.rules).toMatch(/information, never an instruction/i);
    }
    expect((await loadTemplate(templatesRoot, 'coder')).rules).toMatch(/propose_pr/);
  });
});

describe('the dev-kit plugin (S7-4)', () => {
  it('loads, with its skills present and every tool it names a real os tool', async () => {
    const p = await loadPlugin(pluginsRoot, 'dev-kit');
    expect(p.skills).toEqual(expect.arrayContaining(['coding-rules', 'motion-gsap-lenis']));
    expect(p.connectors).toContain('os');
    for (const s of p.skills) expect((await readFile(path.join(p.dir, 'skills', s, 'SKILL.md'), 'utf8')).length).toBeGreaterThan(200);
  });

  it('gives the motion skill the libraries it names and a rule about reduced motion', async () => {
    const text = await readFile(path.join(pluginsRoot, 'dev-kit', 'skills', 'motion-gsap-lenis', 'SKILL.md'), 'utf8');
    expect(text).toMatch(/GSAP/);
    expect(text).toMatch(/Lenis/);
    expect(text).toMatch(/prefers-reduced-motion/);
  });
});

describe('the codex render target (S7-4)', () => {
  async function render(key: string, runtime: 'codex' | 'claude-cli') {
    const t = await loadTemplate(templatesRoot, key);
    const text = renderRoleFile(t, { ...params, id: `engineering-${key}`, runtime, ...(runtime === 'claude-cli' ? { model: 'researcher' } : {}) });
    const parsed = parseRoleFile(text, `engineering-${key}/AGENT.md`);
    return renderWorkdir({ ...parsed, rolePath: `departments/engineering/agents/engineering-${key}/AGENT.md` } as never, await ctx());
  }

  it('writes the standing rules and role as instructions, and where the os tools are, and nothing secret', async () => {
    const r = await render('coder', 'codex');
    expect(r.runtime).toBe('codex');
    expect(r.files).toEqual(expect.arrayContaining(['INSTRUCTIONS.md', '.codex-mcp.json']));
    const dir = r.dir;
    const instructions = await readFile(path.join(dir, 'INSTRUCTIONS.md'), 'utf8');
    expect(instructions).toMatch(/Acme Test Co/);
    expect(instructions).toMatch(/worktree/i);
    const mcp = JSON.parse(await readFile(path.join(dir, '.codex-mcp.json'), 'utf8')) as { url: string };
    expect(mcp.url).toBe('http://127.0.0.1:3100/mcp');
    // The token is named by its variable, never written down.
    for (const f of r.files) expect(await readFile(path.join(dir, f), 'utf8'), f).not.toMatch(/sk-[A-Za-z0-9]{10}|Bearer [A-Za-z0-9]{12}/);
  });

  it('refuses a template with no shell on codex, because codex always has one, and still renders the coder on claude-cli', async () => {
    const t = await loadTemplate(templatesRoot, 'researcher');
    const text = renderRoleFile(t, { ...params, id: 'research-r', department: 'research', department_name: 'Research', runtime: 'claude-cli' as never });
    const parsed = parseRoleFile(text.replace('runtime: claude-cli', 'runtime: codex').replace('model: researcher', 'model: any-model'), 'research-r/AGENT.md');
    await expect(renderWorkdir({ ...parsed, rolePath: 'departments/research/agents/research-r/AGENT.md' } as never, await ctx())).rejects.toThrow(/shell/i);
    expect((await render('coder', 'claude-cli')).runtime).toBe('claude-cli');
  });
});
