/**
 * Embedded tools (WorkAdventure's Trello, Notion, Miro and Google panels): a short list, set on the Settings screen, of outside web pages
 * that open in a panel inside the office. They are an allow-list: nothing outside the list can be shown, and a page on the list is shown in
 * a sandbox. The rules here keep the list to ordinary public https pages. Pure, so the rules are tested without a server.
 */
export interface EmbeddedTool {
  name: string;
  url: string;
}

export const MAX_EMBEDS = 12;

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

/** True for an IPv4 or IPv6 address written as a host (a tool lives at a name, so none is accepted). */
function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':');
}

/** Returns what is wrong with a tool in one sentence, or null if it is fine. The URL is checked as a whole, not by a pattern on its text. */
export function embedProblem(t: { name?: unknown; url?: unknown }): string | null {
  if (typeof t.name !== 'string' || !t.name.trim()) return 'Give the tool a name.';
  if (t.name.trim().length > 40) return 'A name is at most 40 characters.';
  if (typeof t.url !== 'string' || !t.url.trim()) return 'Give the tool a web address.';
  let u: URL;
  try {
    u = new URL(t.url.trim());
  } catch {
    return 'That is not a web address.';
  }
  if (u.protocol !== 'https:') return 'Only https addresses are allowed.';
  if (u.username || u.password) return 'An address with a name or password in it is not allowed.';
  if (u.port && u.port !== '443') return 'Only the standard https port is allowed.';
  const host = u.hostname;
  if (isIpHost(host)) return 'Use a name, not an IP address.';
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return 'That address is on this machine or a private network, so it is not allowed.';
  if (t.url.trim().length > 500) return 'That address is too long.';
  return null;
}

/** Checks a whole list: a limit on how many, no repeated name, and each one fine. Returns the clean list, or throws a message. */
export function cleanEmbeds(list: unknown): EmbeddedTool[] {
  if (!Array.isArray(list)) throw new Error('Send a list of tools.');
  if (list.length > MAX_EMBEDS) throw new Error(`At most ${MAX_EMBEDS} tools.`);
  const seen = new Set<string>();
  const out: EmbeddedTool[] = [];
  for (const raw of list as { name?: unknown; url?: unknown }[]) {
    const problem = embedProblem(raw ?? {});
    if (problem) throw new Error(`${typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : 'A tool'}: ${problem}`);
    const name = (raw.name as string).trim();
    if (seen.has(name.toLowerCase())) throw new Error(`There are two tools called "${name}".`);
    seen.add(name.toLowerCase());
    out.push({ name, url: new URL((raw.url as string).trim()).toString() });
  }
  return out;
}
