import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';

/**
 * The first-run wizard as an API (S9-7, SPEC 16): name the company, pick a template, say where the model comes from, note which channels to
 * connect later, and say what the first hire is. Each step is saved as the person answers it and can be answered again. Nothing is sent
 * anywhere, and no key is ever taken here: a key goes in the server's own environment file, and the strict schemas below refuse any field
 * that looks like one.
 */
export const STEPS = ['company', 'template', 'model', 'channels', 'first-hire'] as const;
export type Step = (typeof STEPS)[number];

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
const SCHEMAS: Record<Step, z.ZodType> = {
  company: z.object({ name: z.string().trim().min(1).max(60) }).strict(),
  template: z.object({ template: Slug }).strict(),
  // Where the model comes from. A signed-in CLI, a local model, or an API key the person puts in the environment file themselves.
  model: z.object({ source: z.enum(['cli', 'local', 'key']), runtime: z.enum(['claude-cli', 'opencode', 'codex', 'openai-agents', 'claude-agent', 'http']).optional() }).strict(),
  channels: z.object({ later: z.array(z.enum(['email', 'x', 'linkedin', 'instagram', 'slack'])).max(5) }).strict(),
  'first-hire': z.object({ template: Slug, department: Slug, name: z.string().trim().min(1).max(60).optional() }).strict(),
};

export function setupRoutes(deps: { templates: () => Promise<string[]> }) {
  const r = new Hono<AppEnv>();
  const read = async (c: { get: (k: 'tx') => AppEnv['Variables']['tx'] }) => (await c.get('tx').client.query<{ step: string; data: unknown; updated_at: string }>('select step, data, updated_at from setup_steps')).rows;

  r.get('/', async (c) => {
    const saved = new Map((await read(c)).map((s) => [s.step, s]));
    const steps = STEPS.map((step) => ({ step, done: saved.has(step), data: saved.get(step)?.data ?? null, updatedAt: saved.get(step)?.updated_at ?? null }));
    return c.json({ steps, next: steps.find((s) => !s.done)?.step ?? null, templates: await deps.templates() });
  });

  r.put('/:step', async (c) => {
    const step = c.req.param('step') as Step;
    if (!STEPS.includes(step)) return c.json({ error: `Unknown step. Steps: ${STEPS.join(', ')}.` }, 404);
    const parsed = SCHEMAS[step].safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    if (step === 'template' || step === 'first-hire') {
      const wanted = (parsed.data as { template: string }).template;
      const known = step === 'template' ? await deps.templates() : null;
      if (known && !known.includes(wanted)) return c.json({ error: `There is no company template called "${wanted}".` }, 400);
    }
    await c.get('tx').client.query('insert into setup_steps (workspace_id, step, data) values (current_setting(\'app.workspace_id\')::uuid, $1, $2) on conflict (workspace_id, step) do update set data = excluded.data, updated_at = now()', [step, JSON.stringify(parsed.data)]);
    c.get('tx').client.query("insert into audit_log (workspace_id, actor, action, subject, data) values (current_setting('app.workspace_id')::uuid, 'founder', 'setup.step', $1, $2)", [step, JSON.stringify(parsed.data)]).catch(() => undefined);
    return c.json({ step, data: parsed.data });
  });

  return r;
}
