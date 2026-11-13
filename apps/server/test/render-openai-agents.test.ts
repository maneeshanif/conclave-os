import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { assertRunnerCanEnforce, PermissionsSchema } from '../src/harness/permissions';
import { loadTemplate, renderRoleFile, renderWorkdir, type WorkdirContext } from '../src/harness/render';
import { REPO_ROOT, isInside } from '../src/paths';

const templatesRoot = path.join(REPO_ROOT, 'templates');
const params = { id: 'oa-researcher', name: 'Local Researcher', department: 'research', department_name: 'Research', company_name: 'Acme Test Co' };

async function ctx(): Promise<WorkdirContext> {
  return { dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')), workspaceSlug: 'local', companyName: 'Acme Test Co', companyMd: '# Acme Test Co\nWe test things.', departmentName: 'Research', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot };
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
const onLocal = { ...params, runtime: 'openai-agents' as const, model: 'local-worker' };

describe('the openai-agents render target (S4-4)', () => {
  it('renders the researcher for the in-process runner (snapshot): instructions, skills, no CLI files', async () => {
    const c = await ctx();
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'researcher'), onLocal), 'x/AGENT.md');
    const out = await renderWorkdir(agent, c);
    expect(out.runtime).toBe('openai-agents');
    expect(isInside(out.dir, REPO_ROOT)).toBe(false);
    const files = await listFiles(out.dir);
    expect(files).toMatchSnapshot();
    expect(files.filter((f) => /CLAUDE|AGENTS|opencode|\.mcp|\.claude/.test(f))).toEqual([]);
    const instructions = await readFile(path.join(out.dir, 'INSTRUCTIONS.md'), 'utf8');
    expect(instructions).toContain('Acme Test Co');
    expect(instructions).toContain('# Your role');
    expect(instructions).not.toContain('{{'); // every placeholder was filled
    expect(instructions).toMatchSnapshot();
    expect(await readFile(path.join(out.dir, '.skills/cite-sources/SKILL.md'), 'utf8')).toContain('name: cite-sources');
    const runner = JSON.parse(await readFile(path.join(out.dir, '.runner.json'), 'utf8'));
    expect(runner).toMatchSnapshot();
  });

  it('leaves the same template rendered for Claude Code unchanged', async () => {
    const c = await ctx();
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'researcher'), { ...params, id: 'cc-researcher' }), 'x/AGENT.md');
    const out = await renderWorkdir(agent, c);
    const files = await listFiles(out.dir);
    expect(files).toContain('CLAUDE.md');
    expect(files).not.toContain('INSTRUCTIONS.md');
    expect(files.some((f) => f.startsWith('.skills'))).toBe(false);
  });

  it('changing an agent from the in-process runner back to the CLI leaves no files of the other target', async () => {
    const c = await ctx();
    const t = await loadTemplate(templatesRoot, 'researcher');
    const a = await renderWorkdir(parseRoleFile(renderRoleFile(t, onLocal), 'x'), c);
    expect(await listFiles(a.dir)).toContain('INSTRUCTIONS.md');
    const b = await renderWorkdir(parseRoleFile(renderRoleFile(t, { ...params }), 'x'), c);
    const files = await listFiles(b.dir);
    expect(files).toContain('CLAUDE.md');
    expect(files).not.toContain('INSTRUCTIONS.md');
    expect(files.some((f) => f.startsWith('.skills') || f === '.runner.json')).toBe(false);
  });

  it('assertRunnerCanEnforce refuses a shell or subagents, and lists the other grants it cannot provide', () => {
    const base = PermissionsSchema.parse({});
    expect(() => assertRunnerCanEnforce({ ...base, shell: 'allow' })).toThrow(/shell/);
    expect(() => assertRunnerCanEnforce({ ...base, subagents: 'allow' })).toThrow(/subagents/);
    expect(assertRunnerCanEnforce({ ...base, read: 'allow', write: 'allow', web_search: 'allow', web_fetch: 'allow' })).toEqual(['read', 'write', 'web_search', 'web_fetch']);
    expect(assertRunnerCanEnforce(base)).toEqual(['read', 'write']);
    expect(assertRunnerCanEnforce({ ...base, read: 'deny', write: 'deny' })).toEqual([]);
  });
});
