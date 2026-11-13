import { createHash } from 'node:crypto';
import { checkClaims } from '../actions/policy';

/**
 * Posts (SPEC 8, 15; slice 5): what an agent proposes to publish on X, LinkedIn or Instagram. A post is an approval first; the
 * text a person approves is the text that goes out. These are the rules the proposal handler applies in code (CLAUDE.md rule 7),
 * so none of them depends on a prompt.
 */
export const POST_PLATFORMS = ['x', 'linkedin', 'instagram'] as const;
export type PostPlatform = (typeof POST_PLATFORMS)[number];

/** What each platform accepts for the text of one post. */
export const PLATFORM_LIMITS: Record<PostPlatform, number> = { x: 280, linkedin: 3000, instagram: 2200 };

export const isPostPlatform = (channel: string): channel is PostPlatform => (POST_PLATFORMS as readonly string[]).includes(channel);

/** Spacing and case do not make a post new: the same words on the same account are one post. */
export function hashText(text: string): string {
  return createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

/** The domains a post may link to: the bullets under "## Approved link domains" in COMPANY.md, without www. Nothing listed means no links. */
export function approvedLinkDomains(companyMd: string): string[] {
  const lines = companyMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+approved link domains\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const m = /^\s*[-*]\s+(\S+)\s*$/.exec(line);
    if (m) out.push(m[1]!.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
  }
  return [...new Set(out)];
}

// A link is a web address with a scheme, or a bare domain with a common ending (the platforms turn those into links too).
const TLDS = 'com|net|org|io|co|app|dev|ai|me|ly|gl|info|biz|us|uk|pk|ca|au|de|fr|in|tv|xyz|site|online|shop|test|example';
const LINK = new RegExp(String.raw`\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:${TLDS})\b(?:\/[^\s)]*)?`, 'gi');

/** The hosts a text links to, lower-case, without www. */
export function linkHosts(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    const host = m[0].replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase().replace(/^www\./, '');
    hosts.add(host);
  }
  return [...hosts];
}

/** Everything the proposal handler checks about the text, with one plain reason for each thing wrong. */
export function checkPost(platform: PostPlatform, text: string, companyMd: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!text.trim()) reasons.push('the text is empty');
  if (text.length > PLATFORM_LIMITS[platform]) reasons.push(`too long for ${platform}: ${text.length} characters, the limit is ${PLATFORM_LIMITS[platform]}`);
  reasons.push(...checkClaims(text, companyMd).reasons);
  const allowed = approvedLinkDomains(companyMd);
  for (const host of linkHosts(text)) if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) reasons.push(`link to ${host}, which is not an approved link domain (see COMPANY.md)`);
  return { ok: reasons.length === 0, reasons };
}
