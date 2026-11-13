import { withWorkspace } from '../db/tenant';
import { executeEmail, recoverApprovals, releaseApproved, type ExecResult, type ExecutorDeps } from './email';
import { executePost, recoverPosts, releasePosts } from './post';

/**
 * The executors (SPEC 6): deterministic code that performs an approved action. The model is never
 * here. Two kinds: `email.send` and `post.publish`. Calls for the same approval are serialised; the claim in
 * the database makes a second call a no-op even across processes.
 */
export function createExecutors(deps: ExecutorDeps) {
  const inFlight = new Map<string, Promise<ExecResult | Awaited<ReturnType<typeof executePost>>>>();
  const kindOf = async (approvalId: string) => (await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ kind: string }>('select kind from approvals where id = $1', [approvalId]))).rows[0]?.kind;
  const run = (approvalId: string): Promise<ExecResult | Awaited<ReturnType<typeof executePost>>> => {
    const existing = inFlight.get(approvalId);
    if (existing) return existing;
    const p = kindOf(approvalId)
      .then((kind) => (kind === 'post.publish' ? executePost(deps, approvalId) : executeEmail(deps, approvalId)))
      .finally(() => inFlight.delete(approvalId));
    inFlight.set(approvalId, p);
    return p;
  };
  return {
    run,
    recover: async () => {
      const mail = await recoverApprovals(deps);
      const posts = await recoverPosts(deps);
      return { ...mail, resumed: [...mail.resumed, ...posts.resumed], unknown: [...mail.unknown, ...posts.unknown] };
    },
    release: async () => {
      const mail = await releaseApproved(deps);
      const posts = await releasePosts(deps);
      return { ...mail, released: [...mail.released, ...posts] };
    },
  };
}
export type Executors = ReturnType<typeof createExecutors>;
