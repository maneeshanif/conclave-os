import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { loadTemplate, renderRoleFile, renderWorkdir } from '../src/harness/render';
import { REPO_ROOT } from '../src/paths';

const templatesRoot = path.join(REPO_ROOT, 'templates');

/** The http render target (S9-1): the worker is elsewhere, so only the instructions are written. */
describe('rendering an agent for the http runtime (S9-1)', () => {
  it('writes one INSTRUCTIONS.md with the standing rules and the role, and no harness config or secret', async () => {
    const t = await loadTemplate(templatesRoot, 'researcher');
    const text = renderRoleFile(t, { id: 'py-researcher', name: 'Py', department: 'research', department_name: 'Research', company_name: 'Acme', runtime: 'http', model: 'any-model' });
    const role = parseRoleFile(text, 'py/AGENT.md');
    expect(role.role.runtime).toBe('http');
    const dataDir = await mkdtemp(path.join(tmpdir(), 'conclave-hr-'));
    const r = await renderWorkdir(role, { dataDir, workspaceSlug: 'local', companyName: 'Acme', companyMd: '# Acme', departmentName: 'Research', osUrl: 'http://127.0.0.1:3100/mcp', templatesRoot });
    expect(r.runtime).toBe('http');
    expect(r.files).toContain('INSTRUCTIONS.md');
    const instructions = await readFile(path.join(r.dir, 'INSTRUCTIONS.md'), 'utf8');
    expect(instructions).toMatch(/Acme/);
    expect(instructions).toMatch(/Your role/);
    for (const f of r.files) expect(await readFile(path.join(r.dir, f), 'utf8'), f).not.toMatch(/Bearer|sk-[A-Za-z0-9]{10}|CONCLAVE_RUN_TOKEN/);
  });
});
