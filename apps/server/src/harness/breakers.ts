import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

export interface BreakerRow {
  key: string;
  state: 'closed' | 'open';
  failures: number;
  last_error: string | null;
  opened_at: Date | null;
  open_until: Date | null;
}

export type Gate = { allowed: true } | { allowed: false; until: Date };

/**
 * Circuit breakers (SPEC 14, "Tool or connector error"). Three failures in a row of one tool open its breaker: further calls
 * are refused at once, without asking the tool, so a broken connector is not hammered and an agent is not left waiting on
 * it. A refused call is not counted. The breaker closes by itself after a cooldown (the first call after it goes through)
 * or when a person resets it, and one action item says it is open. A success resets the count. Each tool has its own breaker.
 *
 * What counts as a failure is the caller's call: a tool that broke (an exception), not a tool that worked and said no.
 */
export class Breakers {
  private readonly pool: pg.Pool;
  private readonly ws: string;
  private readonly after: number;
  private readonly cooldownMs: number;
  private readonly now: () => Date;

  constructor(o: { pool: pg.Pool; workspaceId: string; failuresToOpen?: number; cooldownMs?: number; now?: () => Date }) {
    this.pool = o.pool;
    this.ws = o.workspaceId;
    this.after = o.failuresToOpen ?? 3;
    this.cooldownMs = o.cooldownMs ?? 5 * 60_000;
    this.now = o.now ?? (() => new Date());
  }

  /** Asks whether a call may go ahead. An open breaker whose cooldown is over closes here. */
  async before(key: string): Promise<Gate> {
    const now = this.now();
    return withWorkspace(this.pool, this.ws, async ({ client: c }) => {
      const r = await c.query<{ state: string; open_until: Date | null }>('select state, open_until from circuit_breakers where key = $1 for update', [key]);
      const row = r.rows[0];
      if (!row || row.state !== 'open') return { allowed: true } as Gate;
      if (row.open_until && row.open_until > now) return { allowed: false, until: row.open_until } as Gate;
      await this.close(c, key, 'system');
      return { allowed: true } as Gate;
    });
  }

  async success(key: string): Promise<void> {
    await withWorkspace(this.pool, this.ws, ({ client: c }) =>
      c.query("update circuit_breakers set failures = 0, updated_at = now() where key = $1 and state = 'closed' and failures > 0", [key]),
    );
  }

  async failure(key: string, message: string): Promise<void> {
    const now = this.now();
    await withWorkspace(this.pool, this.ws, async ({ client: c }) => {
      const r = await c.query<{ state: string; failures: number }>(
        `insert into circuit_breakers (workspace_id, key, failures, last_error) values ($1, $2, 1, $3)
         on conflict (workspace_id, key) do update set failures = case when circuit_breakers.state = 'open' then circuit_breakers.failures else circuit_breakers.failures + 1 end,
           last_error = excluded.last_error, updated_at = now()
         returning state, failures`,
        [this.ws, key, message.slice(0, 500)],
      );
      const row = r.rows[0]!;
      if (row.state === 'open' || row.failures < this.after) return;
      await c.query("update circuit_breakers set state = 'open', opened_at = $2, open_until = $3 where key = $1", [key, now, new Date(now.getTime() + this.cooldownMs)]);
      await c.query("insert into action_items (workspace_id, kind, title, body) values ($1, 'breaker_open', $2, $3)", [
        this.ws,
        `${key.replace(':', ' ')} keeps failing, so it is switched off for a few minutes`,
        `breaker: ${key}\n${row.failures} failures in a row; the last error was: ${message.slice(0, 300)}\nCalls to it are refused until about ${new Date(now.getTime() + this.cooldownMs).toISOString().slice(11, 16)} UTC, then it is tried again. If it is still broken it will switch off again. You can reset it earlier from the Health screen once it is fixed.`,
      ]);
      await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', 'breaker.opened', $2, $3)", [this.ws, key, JSON.stringify({ failures: row.failures })]);
    });
  }

  private async close(c: pg.PoolClient, key: string, by: string): Promise<boolean> {
    const r = await c.query("update circuit_breakers set state = 'closed', failures = 0, open_until = null, updated_at = now() where key = $1 and state = 'open' returning key", [key]);
    if (!r.rows[0]) return false;
    await c.query("update action_items set status = 'done', resolved_at = now(), resolved_by = $2, resolution_note = 'The breaker closed.' where kind = 'breaker_open' and status = 'open' and body like $1", [`breaker: ${key}\n%`, by]);
    await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'breaker.closed', $3, '{}')", [this.ws, by, key]);
    return true;
  }

  /** Closes a breaker on a person's say-so. False if it was not open. */
  async reset(key: string, by: string): Promise<boolean> {
    return withWorkspace(this.pool, this.ws, ({ client: c }) => this.close(c, key, by));
  }

  async list(): Promise<BreakerRow[]> {
    const r = await withWorkspace(this.pool, this.ws, ({ client: c }) => c.query<BreakerRow>('select key, state, failures, last_error, opened_at, open_until from circuit_breakers order by state desc, key'));
    return r.rows;
  }
}
