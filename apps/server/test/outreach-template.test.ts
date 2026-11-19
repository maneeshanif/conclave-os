import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoleFile } from '../src/company/loader';
import { osTools } from '../src/harness/os-tools';
import { loadPlugin } from '../src/harness/plugins';
import { loadTemplate, renderRoleFile, renderWorkdir, type WorkdirContext } from '../src/harness/render';
import { REPO_ROOT, isInside } from '../src/paths';

const templatesRoot = path.join(REPO_ROOT, 'templates');
const pluginsRoot = path.join(REPO_ROOT, 'plugins');
const params = { id: 'outreach-rep', name: 'Outreach Rep', department: 'outreach', department_name: 'Outreach', company_name: 'Acme Test Co' };

async function ctx(over: Partial<WorkdirContext> = {}): Promise<WorkdirContext> {
  return {
    dataDir: await mkdtemp(path.join(tmpdir(), 'conclave-data-')),
    workspaceSlug: 'local',
    companyName: 'Acme Test Co',
    companyMd: '# Acme Test Co\nWe build homepages for clinics.',
    departmentName: 'Outreach',
    osUrl: 'http://127.0.0.1:3100/mcp',
    templatesRoot,
    ...over,
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

describe('the outreach-kit plugin (S1-6)', () => {
  it('has a manifest that matches what is on disk and what the os server really offers', async () => {
    const p = await loadPlugin(pluginsRoot, 'outreach-kit');
    expect(p).toMatchObject({ name: 'outreach-kit', version: 1, skills: ['first-touch-email'], connectors: ['os'] });
    // The tools it says it needs must exist, so the manifest cannot drift from the server.
    for (const tool of p.tools) expect(Object.keys(osTools), tool).toContain(tool);
    expect(p.tools).toEqual(expect.arrayContaining(['get_lead', 'propose_email']));
  });

  it('refuses a manifest that lies, or a plugin that is not there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-plugins-'));
    const make = async (dir: string, manifest: string, skill?: string) => {
      await mkdir(path.join(root, dir, 'skills', 'a-skill'), { recursive: true });
      await writeFile(path.join(root, dir, 'plugin.yaml'), manifest);
      if (skill !== undefined) await writeFile(path.join(root, dir, 'skills', 'a-skill', 'SKILL.md'), skill);
    };
    await make('ok-kit', 'name: ok-kit\nversion: 1\ndescription: fine\nskills: [a-skill]\nconnectors: [os]\ntools: [get_task]\n', '---\nname: a-skill\ndescription: x\n---\nDo it.');
    await expect(loadPlugin(root, 'ok-kit')).resolves.toMatchObject({ name: 'ok-kit' });

    await make('wrong-name', 'name: other-kit\nversion: 1\ndescription: x\nskills: [a-skill]\nconnectors: [os]\ntools: []\n', 'x');
    await expect(loadPlugin(root, 'wrong-name')).rejects.toThrow(/name "other-kit" does not match its folder "wrong-name"/);

    await make('no-skill', 'name: no-skill\nversion: 1\ndescription: x\nskills: [a-skill]\nconnectors: [os]\ntools: []\n'); // lists a skill with no SKILL.md
    await expect(loadPlugin(root, 'no-skill')).rejects.toThrow(/skill "a-skill".*SKILL\.md/);

    await make('bad-tool', 'name: bad-tool\nversion: 1\ndescription: x\nskills: []\nconnectors: [os]\ntools: [send_email]\n');
    await expect(loadPlugin(root, 'bad-tool')).rejects.toThrow(/tool "send_email".*not an os tool/);

    await make('extra', 'name: extra\nversion: 1\ndescription: x\nskills: []\nconnectors: [os]\ntools: []\nshell: true\n');
    await expect(loadPlugin(root, 'extra')).rejects.toThrow(/shell/); // unknown keys are errors, not ignored

    await expect(loadPlugin(root, 'not-here')).rejects.toThrow(/Unknown plugin "not-here"/);
    await expect(loadPlugin(root, '../escape')).rejects.toThrow(/plugin name/i); // a name is a folder name and nothing else
  });

  it('teaches the first email without any way to send it', async () => {
    const skill = await readFile(path.join(pluginsRoot, 'outreach-kit', 'skills', 'first-touch-email', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\r?\nname: first-touch-email\r?\ndescription:/);
    for (const must of ['propose_email', 'get_lead', 'complete_task', 'block_task', '170 words', 'verified']) expect(skill, must).toContain(must);
    for (const never of [/smtp/i, /sendmail/i, /\bcurl\b/i, /gmail/i, /resend/i, /\bsend it yourself\b/i]) expect(skill, String(never)).not.toMatch(never);
  });
});

describe('the outreach-rep template (S1-6)', () => {
  it('is a neutral template with no shell, no web, no subagents, the os connector and the outreach-kit plugin', async () => {
    const t = await loadTemplate(templatesRoot, 'outreach-rep');
    expect(t.permissions).toMatchObject({ shell: 'deny', web_search: 'deny', web_fetch: 'deny', subagents: 'deny' });
    expect(t.connectors).toEqual(['os']);
    expect(t.plugins.map((p) => p.name)).toEqual(['outreach-kit']);
    expect(t.file.defaults).toMatchObject({ autonomy: 0, runtime: 'claude-cli' }); // every new hire starts on trial (SPEC 5)
  });

  it('renders the role file (snapshot), naming its plugin and the skill the plugin brings', async () => {
    const text = renderRoleFile(await loadTemplate(templatesRoot, 'outreach-rep'), params);
    expect(text).toMatchSnapshot();
    expect(parseRoleFile(text, 'x/AGENT.md').role).toMatchObject({
      template: 'outreach-rep',
      autonomy: 0,
      plugins: ['outreach-kit'],
      skills: ['first-touch-email'],
      connectors: ['os'],
    });
  });

  it('can be hired straight at autonomy 2, and refuses a level that does not exist', async () => {
    const t = await loadTemplate(templatesRoot, 'outreach-rep');
    expect(parseRoleFile(renderRoleFile(t, { ...params, autonomy: 2 }), 'x/AGENT.md').role.autonomy).toBe(2);
    expect(() => renderRoleFile(t, { ...params, autonomy: 5 })).toThrow();
    expect(() => renderRoleFile(t, { ...params, autonomy: -1 })).toThrow();
  });

  it('fails without a required parameter', async () => {
    const t = await loadTemplate(templatesRoot, 'outreach-rep');
    const missing: Partial<typeof params> = { ...params };
    delete missing.department_name;
    expect(() => renderRoleFile(t, missing as typeof params)).toThrow(/needs parameter "department_name"/);
  });

  it('renders the Claude Code folder (snapshot): the plugin skill is there, there is no shell, and nothing but the os tools reaches out', async () => {
    const c = await ctx();
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'outreach-rep'), params), 'x/AGENT.md');
    const out = await renderWorkdir(agent, c);
    expect(isInside(out.dir, REPO_ROOT)).toBe(false);
    expect(await listFiles(out.dir)).toMatchSnapshot();
    expect(await readFile(path.join(out.dir, '.claude/skills/first-touch-email/SKILL.md'), 'utf8')).toContain('propose_email');
    const settings = JSON.parse(await readFile(path.join(out.dir, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.allow).toEqual(['Read(./**)', 'Write(./**)', 'Edit(./**)', 'mcp__os']);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Glob', 'Grep']));
    const mcp = JSON.parse(await readFile(path.join(out.dir, '.mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers)).toEqual(['os']);
    const rules = await readFile(path.join(out.dir, 'CLAUDE.md'), 'utf8');
    expect(rules).toMatchSnapshot();
    expect(rules).toContain('propose_email');
  });

  it('renders the same agent for OpenCode (snapshot) with the same limits', async () => {
    const c = await ctx();
    const agent = parseRoleFile(renderRoleFile(await loadTemplate(templatesRoot, 'outreach-rep'), { ...params, runtime: 'opencode', model: 'any-model' }), 'x/AGENT.md');
    const out = await renderWorkdir(agent, c);
    expect(await listFiles(out.dir)).toMatchSnapshot();
    expect(await readFile(path.join(out.dir, '.opencode/skills/first-touch-email/SKILL.md'), 'utf8')).toContain('propose_email');
    const cfg = JSON.parse(await readFile(path.join(out.dir, 'opencode.json'), 'utf8'));
    expect(cfg.permission).toMatchObject({ bash: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny', external_directory: 'deny' });
    expect(cfg.agent['outreach-rep'].permission).toMatchObject({ bash: 'deny', webfetch: 'deny' });
    expect(Object.keys(cfg.mcp)).toEqual(['os']);
  });

  it('puts the same skill in both folders, byte for byte', async () => {
    const c = await ctx();
    const t = await loadTemplate(templatesRoot, 'outreach-rep');
    const claude = await renderWorkdir(parseRoleFile(renderRoleFile(t, params), 'x/AGENT.md'), c);
    const open = await renderWorkdir(parseRoleFile(renderRoleFile(t, { ...params, id: 'outreach-rep-2', runtime: 'opencode', model: 'any-model' }), 'x/AGENT.md'), c);
    expect(await readFile(path.join(claude.dir, '.claude/skills/first-touch-email/SKILL.md'), 'utf8')).toBe(
      await readFile(path.join(open.dir, '.opencode/skills/first-touch-email/SKILL.md'), 'utf8'),
    );
  });

  it('says plainly when a role names a plugin that does not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'conclave-tpl-'));
    await mkdir(path.join(root, 'agents', 'ghostly'), { recursive: true });
    for (const f of ['AGENT.md.hbs', 'RULES.md.hbs', 'permissions.yaml', 'connectors.yaml']) {
      await writeFile(path.join(root, 'agents', 'ghostly', f), await readFile(path.join(templatesRoot, 'agents', 'writer', f), 'utf8'));
    }
    await writeFile(
      path.join(root, 'agents', 'ghostly', 'template.yaml'),
      (await readFile(path.join(templatesRoot, 'agents', 'writer', 'template.yaml'), 'utf8')).replace('key: writer', 'key: ghostly') + 'plugins: [no-such-kit]\n',
    );
    await expect(loadTemplate(root, 'ghostly', path.join(root, 'plugins'))).rejects.toThrow(/Unknown plugin "no-such-kit"/);
  });
});
