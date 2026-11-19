import { checkClaims } from '../actions/policy';
import { approvedLinkDomains, linkHosts } from '../posts';

/**
 * Direct messages (SPEC 15, CLAUDE.md rule 6): one person at a time, each its own approval, never a list. A DM may follow contact
 * that a person already approved or that the lead started; it is never the first cold touch.
 */
export const DM_CHANNELS = ['x_dm', 'ig_dm'] as const;
export type DmChannel = (typeof DM_CHANNELS)[number];
export const isDmChannel = (c: string): c is DmChannel => (DM_CHANNELS as readonly string[]).includes(c);

/** What each platform accepts for one message. */
export const DM_LIMITS: Record<DmChannel, number> = { x_dm: 10_000, ig_dm: 1000 };

/** A handle compared without its @ or its case, so "@Dana_Clinic" and "dana_clinic" are one person. */
export const normalizeHandle = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

/** Stages that show contact already happened: an approved email went out (contacted), or the lead answered (replied and on). */
const ELIGIBLE = new Set(['contacted', 'replied', 'qualified', 'won']);
export const dmEligible = (stage: string) => ELIGIBLE.has(stage);

/** Is this person on the suppression list, by handle (with or without @) or through the lead's email address? */
export function dmSuppressed(recipient: string, leadEmail: string | null, values: string[]): boolean {
  const who = normalizeHandle(recipient);
  const email = leadEmail?.trim().toLowerCase() ?? '';
  const domain = email.includes('@') ? email.slice(email.indexOf('@')) : '';
  return values.some((raw) => {
    const v = raw.trim().toLowerCase();
    return v !== '' && (normalizeHandle(v) === who || (email !== '' && (v === email || v === domain)));
  });
}

/** The text rules, the same as for a post: length for the platform, blocked claims and prices, and links only to approved domains. */
export function checkDm(channel: DmChannel, text: string, companyMd: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!text.trim()) reasons.push('the text is empty');
  if (text.length > DM_LIMITS[channel]) reasons.push(`too long for ${channel}: ${text.length} characters, the limit is ${DM_LIMITS[channel]}`);
  reasons.push(...checkClaims(text, companyMd).reasons);
  const allowed = approvedLinkDomains(companyMd);
  for (const host of linkHosts(text)) if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) reasons.push(`link to ${host}, which is not an approved link domain (see COMPANY.md)`);
  return { ok: reasons.length === 0, reasons };
}
