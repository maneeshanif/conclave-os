import { withWorkspace } from '../db/tenant';
import { executeEmail, recoverApprovals, releaseApproved, type ExecResult, type ExecutorDeps } from './email';
import { executeDm, recoverDms, releaseDms } from './dm';
import { executePost, recoverPosts, releasePosts } from './post';
import { executeVideoBrief, recoverVideo, releaseVideo } from './video';
import { executePrOpen, recoverPrs, releasePrs } from './pr';
import { executeAgentCreate, recoverAgents, releaseAgents } from './agent';

/**
 * The executors (SPEC 6): deterministic code that performs an approved action. The model is never
 * here. Five kinds: `email.send`, `post.publish`, `dm.send`, `video.brief` and `agent.create`. Calls for the same approval are serialised; the claim in
 * the database makes a second call a no-op even across processes.
 */
export function createExecutors(deps: ExecutorDeps) {
  const inFlight = new Map<string, Promise<ExecResult | Awaited<ReturnType<typeof executePost>>>>();
  const kindOf = async (approvalId: string) => (await withWorkspace(deps.pool, deps.workspaceId, ({ client: c }) => c.query<{ kind: string }>('select kind from approvals where id = $1', [approvalId]))).rows[0]?.kind;
  const run = (approvalId: string): Promise<ExecResult | Awaited<ReturnType<typeof executePost>>> => {
    const existing = inFlight.get(approvalId);
    if (existing) return existing;
    const p = kindOf(approvalId)
      .then((kind) => (kind === 'post.publish' ? executePost(deps, approvalId) : kind === 'dm.send' ? executeDm(deps, approvalId) : kind === 'video.brief' ? executeVideoBrief(deps, approvalId) : kind === 'agent.create' ? executeAgentCreate(deps, approvalId) : kind === 'pr.open' ? executePrOpen(deps, approvalId) : executeEmail(deps, approvalId)))
      .finally(() => inFlight.delete(approvalId));
    inFlight.set(approvalId, p);
    return p;
  };
  return {
    run,
    recover: async () => {
      const mail = await recoverApprovals(deps);
      const posts = await recoverPosts(deps);
      const dms = await recoverDms(deps);
      const video = await recoverVideo(deps);
      const agents = await recoverAgents(deps);
      const prs = await recoverPrs(deps);
      return { ...mail, resumed: [...mail.resumed, ...posts.resumed, ...dms.resumed, ...video.resumed, ...agents.resumed, ...prs.resumed], unknown: [...mail.unknown, ...posts.unknown, ...dms.unknown, ...video.unknown, ...prs.unknown], held: [...mail.held, ...dms.held] };
    },
    release: async () => {
      const mail = await releaseApproved(deps);
      const posts = await releasePosts(deps);
      const dms = await releaseDms(deps);
      const video = await releaseVideo(deps);
      const agents = await releaseAgents(deps);
      const prs = await releasePrs(deps);
      return { released: [...mail.released, ...posts, ...dms.released, ...video, ...agents, ...prs], held: [...mail.held, ...dms.held] };
    },
  };
}
export type Executors = ReturnType<typeof createExecutors>;
