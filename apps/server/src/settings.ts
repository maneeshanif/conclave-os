import type { PoolClient } from 'pg';

/**
 * Workspace settings (SPEC 11, slice 1): the kill switch and the send caps.
 *
 * Sends are capped two ways, both changeable later. A rolling window, 30 in 5 hours by default, where follow-ups
 * count like first emails, and a per-day cap, 100 by default. Over either cap an email is held, not failed.
 */
export const SETTING_DEFAULTS = { windowHours: 5, windowCap: 30, emailDailyCap: 100 } as const;

export interface Settings {
  killSwitch: boolean;
  killSwitchAt: Date | null;
  windowHours: number;
  windowCap: number;
  emailDailyCap: number;
}

interface Row {
  kill_switch: number;
  kill_switch_at: Date | null;
  window_hours: number;
  window_cap: number;
  email_daily_cap: number;
}

/**
 * Reads this workspace's settings. With `create`, the row is made on first read; without it a missing row just
 * means the defaults, which is what an executor wants (it must never fail to send because a row is absent, and
 * it must not write while it only reads).
 */
export async function readSettings(c: PoolClient, workspaceId: string, create = false, lock = false): Promise<Settings> {
  if (create) await c.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [workspaceId]);
  const r = await c.query<Row>(`select kill_switch, kill_switch_at, window_hours, window_cap, email_daily_cap from workspace_settings${lock ? ' for update' : ''}`);
  const row = r.rows[0];
  return {
    killSwitch: (row?.kill_switch ?? 0) === 1,
    killSwitchAt: row?.kill_switch_at ?? null,
    windowHours: row?.window_hours ?? SETTING_DEFAULTS.windowHours,
    windowCap: row?.window_cap ?? SETTING_DEFAULTS.windowCap,
    emailDailyCap: row?.email_daily_cap ?? SETTING_DEFAULTS.emailDailyCap,
  };
}

/** The start of the server's local day. The per-day cap counts from here. */
export function startOfToday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The next local midnight: when a per-day hold opens. */
export function startOfTomorrow(now: Date): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}
