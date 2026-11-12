import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Claims an outreach message may not make (CLAUDE.md rule 7). Checked in the proposal handler and
 * again by the executor, never left to a prompt. Deliberately broad: a false refusal costs a redraft,
 * a false pass can cost a client or a regulator's letter.
 */
const MEDICAL = [
  /\b(cure[sd]?|heal(s|ed)?|treat(s|ed|ment for)?|diagnos\w*|prescri\w*|dosage|dose[sd]?|side[- ]effects?)\b/i,
  /\b(fda[- ]approved|clinically proven|medically proven|guaranteed results?|risk[- ]free|no side effects)\b/i,
  /\b(botox|filler|semaglutide|ozempic|tirzepatide)\b.*\b(safe|results|guarantee\w*)\b/i,
];
const LEGAL = [/\b(legal advice|guarantee[sd]? (compliance|you will not be sued)|hipaa[- ]compliant|lawsuit|liability)\b/i];
const MONEY = /(?:\$|usd\s?|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?k)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd)\b/gi;

export interface ClaimCheck {
  ok: boolean;
  reasons: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s,]/g, '').replace(/^usd/, '$');

/** Refuses medical and legal claims, and any price that is not written in COMPANY.md. */
export function checkClaims(text: string, companyMd: string): ClaimCheck {
  const reasons: string[] = [];
  for (const r of MEDICAL) {
    const m = r.exec(text);
    if (m) reasons.push(`medical claim: "${m[0]}"`);
  }
  for (const r of LEGAL) {
    const m = r.exec(text);
    if (m) reasons.push(`legal claim: "${m[0]}"`);
  }
  const allowed = new Set((companyMd.match(MONEY) ?? []).map(norm));
  for (const m of text.match(MONEY) ?? []) {
    if (!allowed.has(norm(m))) reasons.push(`price not in COMPANY.md: "${m}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** The cold email footer, from the "## Cold email footer" section of COMPANY.md. */
export async function emailFooter(companyRoot: string): Promise<{ text: string; placeholder: boolean }> {
  const md = await readFile(path.join(companyRoot, 'COMPANY.md'), 'utf8').catch(() => '');
  // Line by line, not one regex: with the `m` flag `$` matches at the end of every line, which cut a two-line
  // address after its first line and made an empty section capture the next heading as its text.
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Cold email footer\s*$/i.test(l));
  let text = '';
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const next = rest.findIndex((l) => /^#{1,6}\s/.test(l));
    text = (next < 0 ? rest : rest.slice(0, next)).join('\n').trim();
  }
  // A footer without a real postal address fails the pre-send check (SPEC 15, cold email rules).
  const placeholder = !text || /\bTODO\b/.test(text) || /\[(business )?address\]/i.test(text);
  return { text, placeholder };
}

export async function companyMarkdown(companyRoot: string): Promise<string> {
  return readFile(path.join(companyRoot, 'COMPANY.md'), 'utf8').catch(() => '');
}

/**
 * True when an address or its domain is on the suppression list. Both sides are normalised: a list entry typed
 * as OWNER@CLINIC.COM must still stop mail to owner@clinic.com. Comparing the stored value as it was typed let
 * exactly that email go out to a suppressed address.
 */
export function isSuppressed(email: string, values: string[]): boolean {
  const e = email.trim().toLowerCase();
  const at = e.indexOf('@');
  const domain = at >= 0 ? e.slice(at) : '';
  return values.some((raw) => {
    const v = raw.trim().toLowerCase();
    return v !== '' && (v === e || v === domain);
  });
}
