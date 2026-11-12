import type pg from 'pg';
import type { Bus } from '../bus';
import { withWorkspace } from '../db/tenant';
import type { ApprovalDecision } from '../routes/approvals';

/**
 * The approval gate (SPEC 6, "How the gate is built", and the three rules around it).
 *
 * A proposal writes an `approvals` row and asks the gate to wait. The gate waits up to three days for a
 * decision, then either runs the real action once, drops it, or marks it expired. The same flow runs two ways:
 * as an Inngest function (a durable wait that survives restarts) and in process with timers (the default when
 * no Inngest server is configured). The database row is the source of truth either way. Nothing here sends
 * anything: the executor does, after claiming the approval once.
 */
export const DECISION_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;
/** setTimeout cannot wait longer than this (about 24.8 days). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** What a gate does to an approval, whichever engine drives it. */
export interface GateOps {
  /** Run the real action. Called at most once per decision, and never retried. */
  execute(approvalId: string): Promise<unknown>;
  /** The wait ran out: mark the approval expired. */
  expire(approvalId: string): Promise<unknown>;
}

/** The part of Inngest's `step` the gate uses. */
export interface GateStep {
  waitForEvent(id: string, opts: { event: string; timeout: string | number; match: string }): Promise<{ data: { approved: boolean } } | null>;
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleepUntil(id: string, until: Date): Promise<void>;
}

/**
 * The Inngest function body. Waits for `approval/decided` for this approval, matched by field (the id is never
 * spliced into an expression), then does exactly one thing. Registered with `retries: 0`, and the executor
 * claims the approval first anyway, so a replay can never send twice.
 */
export function approvalGateHandler(ops: GateOps) {
  return async ({ event, step }: { event: { data: { approvalId: string } }; step: GateStep }) => {
    const { approvalId } = event.data;
    const decision = await step.waitForEvent('await-decision', { event: 'approval/decided', timeout: '3d', match: 'data.approvalId' });
    if (!decision) {
      await step.run('expire', () => ops.expire(approvalId));
      return { status: 'expired' as const };
    }
    if (!decision.data.approved) return { status: 'rejected' as const };
    // The executor says "held" when a send cap is reached: the email stays approved and is tried again when there
    // is room. Each try and each sleep is its own durable step, so none repeats on a replay.
    for (let n = 0; n <= MAX_HOLD_RETRIES; n++) {
      const result = await step.run(n === 0 ? 'execute' : `execute-${n}`, () => ops.execute(approvalId));
      if (!isHeld(result)) return { status: 'executed' as const };
      if (n === MAX_HOLD_RETRIES) break;
      await step.sleepUntil(`wait-for-room-${n + 1}`, new Date(result.until));
    }
    return { status: 'held' as const };
  };
}

/** How many times one approval waits for room before the function gives up and leaves it approved for recovery. */
const MAX_HOLD_RETRIES = 100;

/** The executor's answer when a send cap is reached. `until` is a Date here and text after Inngest stores a step result. */
function isHeld(r: unknown): r is { status: 'held'; until: Date | string } {
  return typeof r === 'object' && r !== null && (r as { status?: unknown }).status === 'held' && (r as { until?: unknown }).until !== undefined;
}

export interface GateExecutors {
  run(approvalId: string): Promise<unknown>;
  recover(): Promise<{ resumed: string[]; unknown: string[]; held?: { id: string; until: Date }[] }>;
}

export interface RecoverReport {
  /** Pending approvals that have a live wait again. */
  waiting: string[];
  /** Pending approvals already past their time: expired now, never sent. */
  expired: string[];
  /** Approved emails that never ran and were run now. */
  resumed: string[];
  /** Emails left mid-send by the last process: marked failed, never resent. */
  unknown: string[];
  /** Approved emails over a send cap: still approved, tried again when there is room. */
  held: { id: string; until: Date }[];
}

export interface ApprovalGate {
  name: 'local' | 'inngest';
  /** A proposal was just queued. */
  requested(approvalId: string): Promise<void>;
  /** A decision has committed. */
  decided(d: ApprovalDecision): Promise<void>;
  /** Run once when the server starts. */
  recover(): Promise<RecoverReport>;
}

interface Deps {
  pool: pg.Pool;
  workspaceId: string;
  bus?: Bus;
}

/** Marks a pending approval expired. Returns false if it was no longer pending (decided in the meantime). */
export async function expireApproval({ pool, workspaceId, bus }: Deps, approvalId: string): Promise<boolean> {
  const done = await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query("update approvals set status = 'expired' where id = $1 and status = 'pending' returning id", [approvalId]);
    if (!r.rows[0]) return false;
    await c.query("update outreach_messages set status = 'expired' where approval_id = $1 and status = 'queued'", [approvalId]);
    await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'gate', 'approval.expired', $2, '{}')", [workspaceId, approvalId]);
    return true;
  });
  if (done) bus?.publish({ kind: 'approval.changed', workspaceId, approvalId, status: 'expired' });
  return done;
}

async function pendingApprovals({ pool, workspaceId }: Deps): Promise<{ id: string; created_at: Date }[]> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{ id: string; created_at: Date }>("select id, created_at from approvals where status = 'pending' order by created_at"),
  );
  return r.rows;
}

export interface LocalGateOptions extends Deps {
  executors: GateExecutors;
  /** How long a proposal waits for a decision. Three days; tests use less. */
  timeoutMs?: number;
  onError?: (err: unknown) => void;
}

/** The gate for a server with no Inngest: a timer per pending approval, in memory, rebuilt from the database on start. */
export class LocalApprovalGate implements ApprovalGate {
  readonly name = 'local' as const;
  private readonly waits = new Map<string, { timer: NodeJS.Timeout; deadline: number }>();
  /** One timer per approved email that is over a cap, to try it again when there is room. */
  private readonly holds = new Map<string, NodeJS.Timeout>();
  private readonly timeoutMs: number;
  private readonly onError: (err: unknown) => void;

  constructor(private readonly o: LocalGateOptions) {
    this.timeoutMs = o.timeoutMs ?? DECISION_TIMEOUT_MS;
    this.onError = o.onError ?? ((err) => console.error('approval gate:', err));
  }

  waiting(): string[] {
    return [...this.waits.keys()];
  }

  /** Approved emails waiting for room under a send cap. */
  holding(): string[] {
    return [...this.holds.keys()];
  }

  remainingMs(approvalId: string): number {
    const w = this.waits.get(approvalId);
    return w ? Math.max(0, w.deadline - Date.now()) : 0;
  }

  stop(): void {
    for (const w of this.waits.values()) clearTimeout(w.timer);
    this.waits.clear();
    for (const t of this.holds.values()) clearTimeout(t);
    this.holds.clear();
  }

  private startWait(approvalId: string, ms: number): void {
    const timer = setTimeout(() => void this.expire(approvalId), ms);
    timer.unref();
    this.waits.set(approvalId, { timer, deadline: Date.now() + ms });
  }

  private async expire(approvalId: string): Promise<void> {
    this.clear(approvalId);
    try {
      await expireApproval(this.o, approvalId);
    } catch (err) {
      this.onError(err);
    }
  }

  private clear(approvalId: string): void {
    const w = this.waits.get(approvalId);
    if (w) clearTimeout(w.timer);
    this.waits.delete(approvalId);
  }

  async requested(approvalId: string): Promise<void> {
    if (this.waits.has(approvalId)) return; // one wait per approval, however often it is asked
    const row = (await pendingApprovals(this.o)).find((p) => p.id === approvalId);
    if (!row) return; // already decided or gone: nothing to wait for
    const left = this.timeoutMs - (Date.now() - row.created_at.getTime());
    if (left <= 0) await this.expire(approvalId);
    else this.startWait(approvalId, left);
  }

  /**
   * A decision has committed. Rejected means there is nothing to do. Approved runs the executor, once: it is not
   * retried here, and the claim in the database stops a second process from running it too. It never throws,
   * because the API call that made the decision has already succeeded.
   */
  async decided(d: ApprovalDecision): Promise<void> {
    this.clear(d.approvalId);
    if (!d.approved) return;
    await this.execute(d.approvalId);
  }

  /** Runs the executor once. If a send cap holds the email, tries again when there is room. Never throws. */
  private async execute(approvalId: string): Promise<void> {
    try {
      const result = await this.o.executors.run(approvalId);
      if (isHeld(result)) this.hold(approvalId, new Date(result.until));
    } catch (err) {
      this.onError(err);
    }
  }

  private hold(approvalId: string, until: Date): void {
    if (this.holds.has(approvalId)) return; // one timer per email, however often it is held
    const ms = Math.min(Math.max(1000, until.getTime() - Date.now()), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.holds.delete(approvalId);
      void this.execute(approvalId);
    }, ms);
    timer.unref();
    this.holds.set(approvalId, timer);
  }

  async recover(): Promise<RecoverReport> {
    const waiting: string[] = [];
    const expired: string[] = [];
    for (const row of await pendingApprovals(this.o)) {
      const left = this.timeoutMs - (Date.now() - row.created_at.getTime());
      if (left <= 0) {
        if (await expireApproval(this.o, row.id)) expired.push(row.id);
      } else {
        this.clear(row.id);
        this.startWait(row.id, left);
        waiting.push(row.id);
      }
    }
    const { resumed, unknown, held = [] } = await this.o.executors.recover();
    for (const h of held) this.hold(h.id, h.until);
    return { waiting, expired, resumed, unknown, held };
  }
}

export interface InngestGateOptions extends Deps {
  send(e: { name: string; id?: string; data: Record<string, unknown> }): Promise<unknown>;
  executors: GateExecutors;
  timeoutMs?: number;
}

/** The gate as events on Inngest. The function that waits is `approvalGateHandler`; this side only sends. */
export function createInngestGate(o: InngestGateOptions): ApprovalGate {
  const timeoutMs = o.timeoutMs ?? DECISION_TIMEOUT_MS;
  const gate: ApprovalGate = {
    name: 'inngest',
    async requested(approvalId) {
      // The event id makes a repeat request for the same approval one event, so a restart does not pile up waits.
      await o.send({ name: 'approval/requested', id: `approval-requested:${approvalId}`, data: { approvalId, workspaceId: o.workspaceId } });
    },
    async decided(d) {
      await o.send({ name: 'approval/decided', data: { approvalId: d.approvalId, workspaceId: d.workspaceId, approved: d.approved } });
    },
    async recover() {
      const waiting: string[] = [];
      const expired: string[] = [];
      for (const row of await pendingApprovals(o)) {
        if (timeoutMs - (Date.now() - row.created_at.getTime()) <= 0) {
          if (await expireApproval(o, row.id)) expired.push(row.id);
        } else {
          await gate.requested(row.id);
          waiting.push(row.id);
        }
      }
      const { resumed, unknown, held = [] } = await o.executors.recover();
      return { waiting, expired, resumed, unknown, held };
    },
  };
  return gate;
}

/** The two things a gate does, for Inngest's function: run the executor, expire the approval. */
export function gateOps(deps: Deps & { executors: GateExecutors }): GateOps {
  return {
    execute: (approvalId) => deps.executors.run(approvalId),
    expire: (approvalId) => expireApproval(deps, approvalId),
  };
}
