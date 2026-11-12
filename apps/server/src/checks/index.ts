import type pg from 'pg';

/**
 * Output checks (SPEC 14, "Wrong or malformed output"). Plain code: a check looks at a run's result and says whether it is
 * good enough, with the reasons if not. A check never calls a model. A role names one in `output_check`; after the run
 * reports done, the loop runs it, and a failure gets one repair, then the stronger model, then a blocked task.
 */
export interface CheckContext {
  /** What the agent reported when it finished. */
  output: string;
  runId: string;
}
export interface CheckResult {
  ok: boolean;
  reasons: string[];
  /** The check itself is at fault (it does not exist), so repairing the output cannot help. */
  fatal?: boolean;
}
type Check = (c: pg.PoolClient, ctx: CheckContext) => Promise<CheckResult> | CheckResult;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const result = (reasons: string[]): CheckResult => ({ ok: reasons.length === 0, reasons });
const fatal = (reasons: string[]): CheckResult => ({ ok: false, reasons, fatal: true });

/**
 * The limits written in the outreach rep's checks README: a subject under 8 words, a body under 170 words, nothing
 * hyped as "agentic". Plain rules with no database, so the eval gate (S3-8) can score a draft with them too.
 */
export function draftProblems(output: string): string[] {
  const m = /^\s*subject:[ \t]*(.+)$/im.exec(output);
  if (!m) return ['The result is not a draft: it needs a line starting "Subject:" and then the body of the email.'];
  const subject = m[1]!.trim();
  const body = output.slice((m.index ?? 0) + m[0].length).trim();
  const reasons: string[] = [];
  if (wordCount(subject) >= 8) reasons.push(`The subject has ${wordCount(subject)} words; it must be under 8.`);
  if (!body) reasons.push('The body is empty.');
  else if (wordCount(body) >= 170) reasons.push(`The body has ${wordCount(body)} words; it must be under 170.`);
  if (/agentic/i.test(output)) reasons.push('It uses the word "agentic", which the email must not.');
  return reasons;
}

/** An agent that proposed its email through propose_email is let through: the proposal handler already checked what it proposed. This is for the one that writes a draft as its result (an agent on trial). */
const emailDraft: Check = async (c, ctx) => {
  const proposed = await c.query("select 1 from approvals where run_id = $1 and kind = 'email.send' limit 1", [ctx.runId]);
  if (proposed.rows.length) return result([]);
  return result(draftProblems(ctx.output));
};

const nonEmpty: Check = (_c, ctx) => result(ctx.output.trim() ? [] : ['The result is empty.']);

export const CHECKS: Record<string, Check> = { 'email-draft': emailDraft, 'non-empty': nonEmpty };

/** Runs the named check. A name that is not in the registry fails, loudly, rather than passing quietly. */
export async function runCheck(c: pg.PoolClient, name: string, ctx: CheckContext): Promise<CheckResult> {
  const check = CHECKS[name];
  if (!check) return fatal([`Unknown output check "${name}". The role file names a check that does not exist (known: ${Object.keys(CHECKS).join(', ')}).`]);
  return check(c, ctx);
}
