import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setRoleStack } from '../src/company/role-edit';

/** The Settings screen writes an agent's runtime and model into its role file, so a sync does not undo it. */
let root = '';
const file = () => path.join(root, 'departments', 'outreach', 'agents', 'outreach-noor', 'AGENT.md');
const ROLE = `---\nid: outreach-noor\nname: Noor\nruntime: claude-cli\nmodel: writer\nautonomy: 1\nmax_turns: 20\n---\n\n# Role\nYou draft. runtime: this line in the body is not touched.\nmodel: nor this one.\n`;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'conclave-role-'));
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), ROLE);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('setRoleStack', () => {
  it('changes only the runtime and model lines of the front matter and keeps everything else exactly', async () => {
    expect(await setRoleStack(root, 'outreach-noor', { runtime: 'openai-agents', model: 'openai' })).toBe(true);
    const now = await readFile(file(), 'utf8');
    expect(now).toBe(ROLE.replace('runtime: claude-cli', 'runtime: openai-agents').replace('model: writer', 'model: openai'));
    expect(now).toContain('runtime: this line in the body is not touched.');
    expect(now).toContain('model: nor this one.');
  });

  it('changes just one of the two when only one is given, and keeps a Windows line ending file in its own style', async () => {
    await writeFile(file(), ROLE.replace(/\n/g, '\r\n'));
    expect(await setRoleStack(root, 'outreach-noor', { model: 'any-model' })).toBe(true);
    const now = await readFile(file(), 'utf8');
    expect(now).toContain('model: any-model\r\n');
    expect(now).toContain('runtime: claude-cli\r\n');
    expect(now.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('says false for an agent with no role file or one whose id does not match, and writes nothing', async () => {
    const before = await readFile(file(), 'utf8');
    expect(await setRoleStack(root, 'nobody', { model: 'x' })).toBe(false);
    expect(await setRoleStack(path.join(root, 'missing'), 'outreach-noor', { model: 'x' })).toBe(false);
    expect(await readFile(file(), 'utf8')).toBe(before);
  });
});
