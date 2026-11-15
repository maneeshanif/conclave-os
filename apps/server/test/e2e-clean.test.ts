import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeHiredAgent } from '../src/commands/e2e';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'conclave-e2eclean-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));
const role = async (dept: string, id: string) => {
  const dir = path.join(root, 'departments', dept, 'agents', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'AGENT.md'), '---\nid: x\n---\n');
  return path.join(dir, 'AGENT.md');
};

describe('the e2e leaves the repo alone (S0-15)', () => {
  it('removes the agent it hired and the folders that only held it', async () => {
    const file = await role('research', 'research-researcher');
    await removeHiredAgent(root, file);
    expect(existsSync(path.join(root, 'departments'))).toBe(false);
  });

  it('leaves another agent in the same department, and other departments, alone', async () => {
    const file = await role('research', 'research-researcher');
    const other = await role('research', 'someone-else');
    const elsewhere = await role('outreach', 'outreach-rep');
    await removeHiredAgent(root, file);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(elsewhere)).toBe(true);
  });

  it('only ever removes inside the company folder, and says nothing if it is already gone', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'conclave-outside-'));
    await mkdir(path.join(outside, 'keep'), { recursive: true });
    await expect(removeHiredAgent(root, path.join(outside, 'keep', 'AGENT.md'))).rejects.toThrow(/outside/i);
    expect(existsSync(path.join(outside, 'keep'))).toBe(true);
    await rm(outside, { recursive: true, force: true });
    await expect(removeHiredAgent(root, path.join(root, 'departments', 'research', 'agents', 'gone', 'AGENT.md'))).resolves.toBeUndefined();
  });
});
