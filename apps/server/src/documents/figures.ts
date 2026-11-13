/**
 * Checking the figures in a draft (S2-12, SPEC 10: "never invent an outcome; case text comes only from numbers in the
 * tables"). A draft may state a figure only if it is one the tables hold. This is plain code, not a prompt: the draft
 * tool runs it and refuses a draft with a figure it cannot account for.
 *
 * What counts as a figure: any amount of money, any percentage, any decimal, and any whole number above 10. Whole numbers
 * up to 10 with no sign are left alone, so "Step 2 of 3" and a numbered list are fine. Years (2000 to 2100) are fine.
 */
const NUMBER = /\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$?\d+(?:\.\d+)?%?/g;

export function extractFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const value = Number(raw.replace(/[$,%]/g, ''));
    if (!Number.isFinite(value)) continue;
    const marked = raw.startsWith('$') || raw.endsWith('%') || raw.includes('.');
    if (marked || value > 10) out.push(value);
  }
  return out;
}

const isYear = (n: number) => Number.isInteger(n) && n >= 2000 && n <= 2100;

export function checkFigures(text: string, allowed: Set<number>): { ok: boolean; unknown: string[] } {
  const unknown: string[] = [];
  for (const n of extractFigures(text)) {
    if (allowed.has(n) || isYear(n)) continue;
    if (!unknown.includes(String(n))) unknown.push(String(n));
  }
  return { ok: unknown.length === 0, unknown };
}
