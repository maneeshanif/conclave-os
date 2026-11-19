import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Changes `runtime:` and `model:` in an agent's role file. The company is text, and the next sync reads these lines back into the database,
 * so a change made on the Settings screen has to be written here too, or it would be undone. Only those two lines of the front matter are
 * touched; the rest of the file, including the role text, is kept exactly. Returns false if no role file has that id.
 */
export async function setRoleStack(companyRoot: string, agentId: string, change: { runtime?: string; model?: string }): Promise<boolean> {
  const base = path.join(companyRoot, 'departments');
  let departments: string[];
  try {
    departments = await readdir(base);
  } catch {
    return false;
  }
  for (const d of departments) {
    const file = path.join(base, d, 'agents', agentId, 'AGENT.md');
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const crlf = text.includes('\r\n');
    const t = text.replace(/\r\n/g, '\n');
    const end = t.indexOf('\n---', 4);
    if (!t.startsWith('---\n') || end < 0) return false;
    let head = t.slice(0, end);
    const rest = t.slice(end);
    if (!new RegExp(`^id: ${escapeRe(agentId)}\\s*$`, 'm').test(head)) continue;
    for (const [field, value] of [['runtime', change.runtime], ['model', change.model]] as const) {
      if (value === undefined) continue;
      const line = new RegExp(`^${field}:.*$`, 'm');
      head = line.test(head) ? head.replace(line, () => `${field}: ${value}`) : `${head}\n${field}: ${value}`;
    }
    const out = head + rest;
    await writeFile(file, crlf ? out.replace(/\n/g, '\r\n') : out);
    return true;
  }
  return false;
}
