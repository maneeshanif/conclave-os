import { CronExpressionParser } from 'cron-parser';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import type { RunOutcome } from '../harness/loop';

/** Everything that starts a run sends this one request (SPEC 11: one event starts every run). */
export interface RunRequestEvent {
  workspaceId: string;
  agentId: string;
  trigger: 'heartbeat' | 'manual' | 'task_assigned' | 'message';
}

export interface Dispatcher {
  name: 'inngest' | 'local';
  request(e: RunRequestEvent): Promise<void>;
}

/**
 * The in-process dispatcher, with the same limits as the Inngest function (SPEC 14): at most two
 * runs at once, never the same agent twice. Used when no Inngest dev server is running, and in tests.
 * A request for an agent that is already running is queued, not dropped.
 */
export class LocalDispatcher implements Dispatcher {
  readonly name = 'local' as const;
  private queue: RunRequestEvent[] = [];
  private running = new Set<string>();
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly execute: (e: RunRequestEvent) => Promise<RunOutcome>,
    private readonly limit = 2,
    private readonly onError: (err: unknown) => void = (err) => console.error('run failed to start:', err),
  ) {}

  async request(e: RunRequestEvent): Promise<void> {
    this.queue.push(e);
    this.pump();
  }

  /** Drops every queued request (the kill switch). Runs already started are cancelled by the loop. */
  clearQueue(): number {
    return this.queue.splice(0).length;
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private pump() {
    while (this.active < this.limit) {
      const i = this.queue.findIndex((q) => !this.running.has(q.agentId));
      if (i < 0) break;
      const e = this.queue.splice(i, 1)[0]!;
      this.running.add(e.agentId);
      this.active++;
      this.execute(e)
        .catch(this.onError)
        .finally(() => {
          this.running.delete(e.agentId);
          this.active--;
          this.pump();
          if (this.active === 0 && this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r());
        });
    }
  }
}

/**
 * The ticker's decision for one agent: is a heartbeat due? Due when the most recent scheduled time
 * is after the last heartbeat run (or, with no heartbeat run yet, within the last two minutes).
 */
export function heartbeatDue(cron: string, lastHeartbeat: Date | null, now: Date): boolean {
  let prev: Date;
  try {
    prev = CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
  } catch {
    return false;
  }
  if (lastHeartbeat) return prev > lastHeartbeat;
  return now.getTime() - prev.getTime() < 2 * 60_000;
}

/** Sends a run request for every active agent whose heartbeat is due (SPEC 11). */
export async function tick(pool: pg.Pool, workspaceId: string, dispatcher: Dispatcher, now = new Date()): Promise<string[]> {
  const agents = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{ id: string; heartbeat_cron: string; last: Date | null }>(
      `select a.id, a.heartbeat_cron,
              (select max(r.started_at) from runs r where r.agent_id = a.id and r.trigger = 'heartbeat') as last
       from agents a where a.status = 'active' and a.heartbeat_cron is not null and a.heartbeat_cron <> ''`,
    ),
  );
  const due = agents.rows.filter((a) => heartbeatDue(a.heartbeat_cron, a.last, now));
  for (const a of due) await dispatcher.request({ workspaceId, agentId: a.id, trigger: 'heartbeat' });
  return due.map((a) => a.id);
}
