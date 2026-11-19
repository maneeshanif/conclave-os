/**
 * Improvement proposals (S8-11, SPEC 9). The Research room learns from the industry, and its output is never a silent change: a proposal
 * carries the evidence, the expected gain and an eval that must pass before it can be approved. The eval here is a set of text cases run
 * against the new skill text, by the server, with no model: each case lists phrases the text must contain and phrases it must not.
 */
export interface EvalCase {
  name?: string;
  mustContain: string[];
  mustNotContain?: string[];
}

export interface EvalResult {
  ok: boolean;
  failures: string[];
}

export function runEval(text: string, cases: EvalCase[]): EvalResult {
  const lower = text.toLowerCase();
  const failures: string[] = [];
  cases.forEach((c, i) => {
    const label = c.name ?? `case ${i + 1}`;
    for (const p of c.mustContain) if (!lower.includes(p.toLowerCase())) failures.push(`${label}: the text must contain "${p}"`);
    for (const p of c.mustNotContain ?? []) if (lower.includes(p.toLowerCase())) failures.push(`${label}: the text must not contain "${p}"`);
  });
  if (!cases.length) failures.push('there is no eval: a proposal needs at least one case');
  return { ok: failures.length === 0, failures };
}
