import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { readSettings, startOfToday, type Settings } from '../settings';

const ACTOR = 'founder';

const Patch = z
  .object({
    killSwitch: z.boolean(),
    windowHours: z.number().int().min(1).max(168),
    windowCap: z.number().int().min(1).max(100_000),
    emailDailyCap: z.number().int().min(1).max(100_000),
  })
  .partial()
  .strict() // a typo such as "killswitch" is an error, not a silent no-op
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });

const COLUMN: Record<string, string> = { windowHours: 'window_hours', windowCap: 'window_cap', emailDailyCap: 'email_daily_cap' };

/**
 * Settings and the kill switch (SPEC 6, 14, 15). Turning the switch on records when, then, after the commit, stops
 * everything that is running or waiting (`onKillSwitch`). Turning it off only clears the switch: work that was
 * stopped or dropped does not come back, and approved emails it was holding are not sent until someone asks
 * (`release-held`), so a stale decision never goes out as a side effect of "all clear".
 */
export function settingsRoutes(deps: {
  workspaceId: string;
  bus: Bus;
  onKillSwitch?: (on: boolean) => Promise<void> | void;
  onReleaseHeld?: () => Promise<number> | number;
}) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const afterCommit = (c: Context<AppEnv>, fn: () => Promise<void>) => c.get('after').push(fn);

  async function view(c: Context<AppEnv>, s: Settings) {
    const tx = c.get('tx').client;
    const now = new Date();
    const count = async (sql: string, p: unknown[]) => (await tx.query<{ n: number }>(sql, p)).rows[0]!.n;
    return {
      killSwitch: s.killSwitch,
      killSwitchAt: s.killSwitchAt,
      windowHours: s.windowHours,
      windowCap: s.windowCap,
      emailDailyCap: s.emailDailyCap,
      sentInWindow: await count("select count(*)::int as n from outreach_messages where channel = 'email' and status = 'sent' and sent_at >= $1", [new Date(now.getTime() - s.windowHours * 3_600_000)]),
      sentToday: await count("select count(*)::int as n from outreach_messages where channel = 'email' and status = 'sent' and sent_at >= $1", [startOfToday(now)]),
      heldApprovals: await count("select count(*)::int as n from approvals where kind = 'email.send' and status = 'approved'", []),
    };
  }

  r.get('/', async (c) => c.json(await view(c, await readSettings(c.get('tx').client, ws, true))));

  r.patch('/', async (c) => {
    const parsed = Patch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    const tx = c.get('tx').client;
    const before = await readSettings(tx, ws, true, true); // locked, so two changes cannot interleave
    const b = parsed.data;

    const changed: string[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(COLUMN)) {
      const next = b[key as keyof typeof b];
      if (next !== undefined && next !== before[key as keyof Settings]) {
        values.push(next);
        sets.push(`${col} = $${values.length}`);
        changed.push(key);
      }
    }
    const switchChanged = b.killSwitch !== undefined && b.killSwitch !== before.killSwitch;
    if (switchChanged) {
      values.push(b.killSwitch ? 1 : 0);
      sets.push(`kill_switch = $${values.length}`);
      sets.push(b.killSwitch ? 'kill_switch_at = now()' : 'kill_switch_at = null');
      changed.push('killSwitch');
    }

    if (changed.length) {
      await tx.query(`update workspace_settings set ${sets.join(', ')}, updated_at = now()`, values);
      const pick = (s: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, s[k]]));
      const after = { ...before, ...(b as Record<string, unknown>) };
      await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'settings.changed', $3, $4)", [
        ws,
        ACTOR,
        ws,
        JSON.stringify({ before: pick(before as unknown as Record<string, unknown>), after: pick(after) }),
      ]);
      afterCommit(c, async () => {
        deps.bus.publish({ kind: 'settings.changed', workspaceId: ws });
        if (switchChanged) await deps.onKillSwitch?.(b.killSwitch === true);
      });
    }
    return c.json(await view(c, await readSettings(tx, ws)));
  });

  r.post('/release-held', async (c) => {
    const s = await readSettings(c.get('tx').client, ws, true);
    if (s.killSwitch) return c.json({ error: 'The kill switch is on. Turn it off first.' }, 409);
    return c.json({ released: (await deps.onReleaseHeld?.()) ?? 0 });
  });

  return r;
}
