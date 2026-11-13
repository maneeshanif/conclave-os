import { normalizeUrl } from '../signals';

/**
 * Hooks (SPEC 8): patterns that are working in the niche, filed by the Hook Scout. A hook is a description of a pattern and a
 * link to the example, never a copy of someone's post. These are the rules the tool applies in code.
 */
export interface HookInput {
  pattern: string;
  exampleUrl: string;
  platform?: string | undefined;
  format?: string | undefined;
  notes?: string | undefined;
}

const MAX_PATTERN_WORDS = 40;
const MAX_QUOTE_WORDS = 12;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Quoted runs of text ("...", curly quotes, or guillemets) longer than a short phrase. */
function longQuotes(text: string): string[] {
  const found = [...text.matchAll(/"([^"]+)"|“([^”]+)”|«([^»]+)»/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  return found.filter((q) => words(q) > MAX_QUOTE_WORDS);
}

export function checkHook(h: HookInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  try {
    normalizeUrl(h.exampleUrl);
  } catch {
    reasons.push('the example needs a link to where it was seen (an http or https address)');
  }
  if (!h.pattern.trim()) reasons.push('the pattern is empty');
  if (words(h.pattern) > MAX_PATTERN_WORDS) reasons.push(`the pattern is too long (${words(h.pattern)} words, at most ${MAX_PATTERN_WORDS}): describe the pattern, do not copy the post`);
  for (const field of [h.pattern, h.notes ?? '']) if (longQuotes(field).length) reasons.push(`it quotes the example at length (a quote of more than ${MAX_QUOTE_WORDS} words): describe the pattern in your own words and keep only the link; a hook is not a copy of someone's post`);
  return { ok: reasons.length === 0, reasons };
}
