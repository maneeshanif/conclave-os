import { Hono } from 'hono';
import { z } from 'zod';
import type { Notifier } from '../push';

const Sub = z.object({ endpoint: z.string().max(2000), keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }) });

/** What the browser needs to subscribe, and where it hands the subscription back (S5-10). Only the public key is ever given out. */
export function pushRoutes(deps: { notifier: Notifier; publicKey: string }) {
  const r = new Hono();
  r.get('/key', (c) => c.json({ publicKey: deps.publicKey }));
  r.post('/subscribe', async (c) => {
    const parsed = Sub.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'A subscription needs an endpoint and its keys (p256dh and auth).' }, 400);
    try {
      await deps.notifier.subscribe(parsed.data, c.req.header('user-agent') ?? '');
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    return c.json({ subscribed: true }, 201);
  });
  r.delete('/subscribe', async (c) => {
    const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Give the endpoint to remove.' }, 400);
    await deps.notifier.unsubscribe(parsed.data.endpoint);
    return c.json({ subscribed: false });
  });
  return r;
}
