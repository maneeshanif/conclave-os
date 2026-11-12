import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompanyLoadError, loadCompany, parseRoleFile } from '../src/company/loader';

const repoCompany = path.resolve(__dirname, '../../../company');

const role = (fm: string) => `---\n${fm}\n---\n\n# Role\nYou research things.\n`;
const goodFm = [
  'id: researcher',
  'name: Researcher',
  'department: research',
  'runtime: claude-cli',
  'model: researcher',
].join('\n');

async function companyCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'conclave-company-'));
  await cp(repoCompany, dir, { recursive: true });
  return dir;
}

describe('company folder loader (S0-3)', () => {
  it('loads the starter company: nineteen departments and three ladder goals', async () => {
    const company = await loadCompany(repoCompany);
    expect(company.departments).toHaveLength(19);
    expect(company.goals.ladder).toHaveLength(3);
    expect(company.companyMd).toContain('Conclave');
  });

  it('rejects a role file with an unknown runtime, with a clear message', () => {
    expect(() => parseRoleFile(role(goodFm.replace('claude-cli', 'gpt-cli')), 'x/AGENT.md')).toThrow(
      /unknown runtime "gpt-cli"/,
    );
  });

  it('rejects a role file whose model alias does not list its runtime', () => {
    expect(() => parseRoleFile(role(goodFm.replace('runtime: claude-cli', 'runtime: opencode')), 'x/AGENT.md')).toThrow(
      /does not list runtime "opencode"/,
    );
  });

  it('rejects unknown front matter keys', () => {
    expect(() => parseRoleFile(role(goodFm + '\ntools: [Bash]'), 'x/AGENT.md')).toThrow(CompanyLoadError);
  });

  it('loads role files and checks folder names, departments and reports_to', async () => {
    const dir = await companyCopy();
    const agentDir = path.join(dir, 'departments', 'research', 'agents', 'researcher');
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, 'AGENT.md'), role(goodFm));
    const company = await loadCompany(dir);
    expect(company.agents.map((a) => a.role.id)).toEqual(['researcher']);
    expect(company.agents[0]?.rolePath).toBe('departments/research/agents/researcher/AGENT.md');

    await writeFile(path.join(agentDir, 'AGENT.md'), role(goodFm + '\nreports_to: nobody'));
    await expect(loadCompany(dir)).rejects.toThrow(/reports_to "nobody"/);

    await writeFile(path.join(agentDir, 'AGENT.md'), role(goodFm.replace('id: researcher', 'id: other')));
    await expect(loadCompany(dir)).rejects.toThrow(/does not match its folder/);
  });

  it('rejects a goals file whose current rung is not on the ladder', async () => {
    const dir = await companyCopy();
    await writeFile(
      path.join(dir, 'goals.yaml'),
      'ladder:\n  - { id: rung-1, target_usd: 1000 }\ncurrent_rung: rung-9\n',
    );
    await expect(loadCompany(dir)).rejects.toThrow(/current_rung "rung-9"/);
  });
});
