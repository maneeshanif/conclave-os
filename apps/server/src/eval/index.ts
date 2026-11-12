import { readFileSync } from 'node:fs';
import { draftProblems } from '../checks';

/**
 * The eval set and the gate (SPEC 9, 14 "A change makes things worse"). A set is a list of leads with what each draft must
 * mention. A drafter (an agent, or in tests a scripted one) writes a draft per lead; each draft is scored by the same output
 * check an agent's result faces plus the lead's own checks. The score of a change is compared with a stored baseline, and
 * a change that scores worse, or that breaks a lead that used to pass, fails the gate and says which leads got worse.
 * Nothing here calls a model: the drafter is passed in.
 */
export interface EvalLead {
  id: string;
  company: string;
  contact: string;
  /** The one specific thing seen about them: what a good draft would be built on. */
  observation: string;
  /** Words the draft must contain (case-insensitive): it must be about this lead, not a template. */
  mustMention: string[];
}
export interface EvalSet {
  name: string;
  note: string;
  leads: EvalLead[];
}
export interface LeadResult {
  id: string;
  passed: boolean;
  reasons: string[];
}
export interface EvalResult {
  set: string;
  total: number;
  passed: number;
  score: number;
  results: LeadResult[];
}
export interface Baseline {
  set: string;
  total: number;
  score: number;
  passed: string[];
  recordedAt: string;
  /** What produced the drafts that set this baseline. */
  by: string;
}
export type Drafter = (lead: EvalLead) => Promise<string>;

/** Reads `eval/<name>/leads.json` from the repo root. */
export function loadSet(name: string, root = new URL('../../../../eval/', import.meta.url)): EvalSet {
  const raw = JSON.parse(readFileSync(new URL(`${name}/leads.json`, root), 'utf8')) as { note: string; leads: EvalLead[] };
  return { name, note: raw.note, leads: raw.leads };
}

function leadProblems(lead: EvalLead, draft: string): string[] {
  const reasons = draftProblems(draft);
  for (const w of lead.mustMention) if (!draft.toLowerCase().includes(w.toLowerCase())) reasons.push(`The draft does not mention "${w}".`);
  return reasons;
}

/** Has the drafter write a draft for each lead, one after the other, and scores each. A drafter that throws fails that lead only. */
export async function runEval(set: EvalSet, drafter: Drafter): Promise<EvalResult> {
  const results: LeadResult[] = [];
  for (const lead of set.leads) {
    let reasons: string[];
    try {
      reasons = leadProblems(lead, await drafter(lead));
    } catch (err) {
      reasons = [`The drafter failed: ${(err as Error).message}`];
    }
    results.push({ id: lead.id, passed: reasons.length === 0, reasons });
  }
  const passed = results.filter((r) => r.passed).length;
  return { set: set.name, total: results.length, passed, score: results.length ? passed / results.length : 0, results };
}

export function baselineOf(set: EvalSet, r: EvalResult, by = 'reference drafter'): Baseline {
  return { set: set.name, total: r.total, score: r.score, passed: r.results.filter((x) => x.passed).map((x) => x.id), recordedAt: new Date().toISOString(), by };
}

export interface GateResult {
  ok: boolean;
  score: number;
  baselineScore: number;
  /** Leads that passed in the baseline and fail now, with why. */
  regressions: LeadResult[];
  summary: string;
}

export function compare(base: Baseline, now: EvalResult): GateResult {
  if (base.set !== now.set) throw new Error(`The baseline is for a different set ("${base.set}") than this run ("${now.set}").`);
  const was = new Set(base.passed);
  const regressions = now.results.filter((r) => !r.passed && was.has(r.id));
  const worse = now.score < base.score - 1e-9;
  const ok = regressions.length === 0 && !worse;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const better = now.score > base.score + 1e-9;
  const summary = ok
    ? better
      ? `Better than the baseline: ${pct(now.score)} against ${pct(base.score)}.`
      : `At the baseline: ${pct(now.score)}.`
    : `${regressions.length ? `${regressions.length} of ${base.passed.length} leads got worse (${regressions.map((r) => r.id).join(', ')}). ` : ''}Score ${pct(now.score)} against a baseline of ${pct(base.score)}.`;
  return { ok, score: now.score, baselineScore: base.score, regressions, summary };
}

/**
 * A deterministic drafter that follows the skill's rules: short, about the lead, built on the one observation. It is not a
 * model. It is what the shipped baseline was recorded with, and `--reference` uses it to check the gate itself works.
 */
export const referenceDrafter: Drafter = async (l) => `Subject: An idea for ${l.company}\n\nHi ${l.contact}, I noticed ${l.observation}. Happy to share a concept if useful.`;
