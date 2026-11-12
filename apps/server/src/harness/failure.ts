import type { ErrorKind } from '../runtimes/types';

/**
 * What kind of failure a run ended in, for deciding what to do next (SPEC 14):
 * - transient: the model service or the network hiccupped. Retry the step, then the fallback model.
 * - plan_limit: the subscription's usage limit. Retrying is pointless; the runtime is paused until the reset (S3-3).
 * - auth: the sign-in is wrong or expired. A person has to fix it; never retried.
 * - permanent: anything else (a crash, a bad config, too many turns, a timeout, a cancel). Never retried.
 */
export type FailureClass = 'transient' | 'plan_limit' | 'auth' | 'permanent';

const PLAN = /usage limit|hit your limit|limit reached|quota|out of credits|credit balance/i;
const TRANSIENT = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|temporarily unavailable|overloaded|\b50[234]\b|bad gateway|service unavailable|gateway time-?out|too many requests|\b429\b|rate.?limit/i;

export function failureClass(e: { kind: ErrorKind; message: string }): FailureClass {
  if (e.kind === 'auth') return 'auth';
  if (e.kind === 'cancelled' || e.kind === 'config' || e.kind === 'max_turns' || e.kind === 'timeout') return 'permanent';
  if (PLAN.test(e.message)) return 'plan_limit';
  if (e.kind === 'limit' || TRANSIENT.test(e.message)) return 'transient';
  return 'permanent';
}
