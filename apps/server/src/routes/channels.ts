import { Hono } from 'hono';
import type { AppEnv } from '../app';

/** Clients' channel messages (S10-7): read only, newest first, each with whether a reply is waiting for a yes. Replying is an approved action, never made here. */
export function channelRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/', async (c) => {
    const rows = await c.get('tx').client.query<{ id: string; channel: string; from_name: string; body: string; status: string; created_at: Date; reply: string | null }>(
      `select m.id, m.channel, m.from_name, m.body, m.status, m.created_at,
              (select a.status from approvals a where a.kind = 'channel.reply' and a.dedupe_key = 'channel:' || m.id::text) as reply
         from channel_messages m order by m.created_at desc, m.id limit 200`,
    );
    return c.json({ messages: rows.rows.map((m) => ({ id: m.id, channel: m.channel, from: m.from_name, body: m.body, status: m.status, receivedAt: m.created_at.toISOString(), reply: m.reply })) });
  });
  return r;
}
