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
    // One waiting request per agent is enough: when it starts, the run takes whatever task is ready, whoever
    // asked. A request that arrives while the agent is running is kept (the queue is empty then), so a task
    // created mid-run still gets its run afterwards.
    if (this.queue.some((q) => q.workspaceId === e.workspaceId && q.agentId === e.agentId)) return;
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
export function heartbeatDue(cron: string, lastHeartbeat: Date | null, now: Date, opts: { tz?: string } = {}): boolean {
  const prev = lastScheduled(cron, now, opts.tz);
  if (!prev) return false;
  if (lastHeartbeat) return prev > lastHeartbeat;
  return now.getTime() - prev.getTime() < 2 * 60_000;
}

/** The most recent time the schedule says to run, in the company's time zone (the server's own if none is given). Null if the schedule is not valid. */
export function lastScheduled(cron: string, now: Date, tz?: string): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now, ...(tz ? { tz } : {}) }).prev().toDate();
  } catch {
    return null;
  }
}

/** A scheduled run is still worth starting if its time was this recent. Later than this the laptop slept through it, and it is let go. */
export const CATCH_UP_MS = 6 * 3_600_000;

export interface TickOptions {
  /** The company's time zone, such as Asia/Karachi. Heartbeat schedules are read in it. */
  tz?: string;
  catchUpMs?: number;
}

const OPEN_TASK = "('todo','in_progress','waiting_approval','blocked')";

/**
 * Wakes every active agent whose heartbeat is due (SPEC 11, 14).
 *
 * A heartbeat time is handled exactly once, however many tickers run and however often the server restarts: the
 * agent's row remembers the last scheduled time it handled (claimed with one conditional update, so two tickers at
 * the same moment make one request). Handled means one of three things: asked, skipped because the kill switch is on,
 * or let go because the laptop was asleep for more than `catchUpMs` after it. Only the first sends anything; a missed
 * morning is never replayed later, and several missed mornings are one catch-up at most, never a burst.
 *
 * When the agent has a standing task (heartbeat_task in its role file) and none from an earlier run is still open, a task
 * with that text is made first, so the wake-up has something to do. `asked` is the in-memory second memory from before
 * heartbeats were stored; it is still honoured. Schedules are read in the company's time zone.
 */
export async function tick(
  pool: pg.Pool,
  workspaceId: string,
  dispatcher: Dispatcher,
  now = new Date(),
  asked: Map<string, Date> = new Map(),
  opts: TickOptions = {},
): Promise<string[]> {
  const { agents, killed } = await withWorkspace(pool, workspaceId, async ({ client: c }) => ({
    agents: (
      await c.query<{ id: string; heartbeat_cron: string; heartbeat_task: string | null; stored: Date | null; ran: Date | null }>(
        `select a.id, a.heartbeat_cron, a.heartbeat_task, a.last_heartbeat_at as stored,
                (select max(r.started_at) from runs r where r.agent_id = a.id and r.trigger = 'heartbeat') as ran
           from agents a where a.status = 'active' and a.heartbeat_cron is not null and a.heartbeat_cron <> ''`,
      )
    ).rows,
    killed: ((await c.query<{ kill_switch: number }>('select kill_switch from workspace_settings')).rows[0]?.kill_switch ?? 0) === 1,
  }));

  const woken: string[] = [];
  const catchUp = opts.catchUpMs ?? CATCH_UP_MS;
  for (const a of agents) {
    const memory = asked.get(a.id) ?? null;
    const last = [a.stored, a.ran, memory].filter((d): d is Date => d !== null).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    if (!heartbeatDue(a.heartbeat_cron, last, now, opts)) continue;
    const scheduled = lastScheduled(a.heartbeat_cron, now, opts.tz)!;

    // Claim this scheduled time. If another ticker got there first, there is nothing left to do.
    const claimed = await withWorkspace(pool, workspaceId, async ({ client: c }) => {
      const r = await c.query('update agents set last_heartbeat_at = $3 where id = $1 and (last_heartbeat_at is null or last_heartbeat_at < $2) returning id', [a.id, scheduled, now]);
      return r.rows.length > 0;
    });
    asked.set(a.id, now);
    if (!claimed) continue;
    if (killed || now.getTime() - scheduled.getTime() > catchUp) continue; // handled, and not asked

    if (a.heartbeat_task) {
      await withWorkspace(pool, workspaceId, async ({ client: c }) => {
        const open = await c.query(`select 1 from tasks where assignee_id = $1 and kind = 'heartbeat' and status in ${OPEN_TASK} limit 1`, [a.id]);
        if (open.rows.length) return;
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: opts.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(scheduled);
        await c.query("insert into tasks (workspace_id, assignee_id, title, body, kind, created_by) values ($1, $2, $3, $4, 'heartbeat', 'system')", [workspaceId, a.id, `Scheduled run ${day}`, a.heartbeat_task]);
      });
    }
    await dispatcher.request({ workspaceId, agentId: a.id, trigger: 'heartbeat' });
    woken.push(a.id);
  }
  return woken;
}
