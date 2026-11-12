import { executeEmail, recoverApprovals, type ExecResult, type ExecutorDeps } from './email';

/**
 * The executors (SPEC 6): deterministic code that performs an approved action. The model is never
 * here. Slice 1 has one kind, `email.send`. Calls for the same approval are serialised; the claim in
 * the database makes a second call a no-op even across processes.
 */
export function createExecutors(deps: ExecutorDeps) {
  const inFlight = new Map<string, Promise<ExecResult>>();
  const run = (approvalId: string): Promise<ExecResult> => {
    const existing = inFlight.get(approvalId);
    if (existing) return existing;
    const p = executeEmail(deps, approvalId).finally(() => inFlight.delete(approvalId));
    inFlight.set(approvalId, p);
    return p;
  };
  return {
    run,
    recover: () => recoverApprovals(deps),
  };
}
export type Executors = ReturnType<typeof createExecutors>;
