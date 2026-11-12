import { Hono, type Context } from 'hono';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { EmailIn } from './leads';

const ACTOR = 'founder';
export const ACCOUNT_STAGES = ['prospect', 'client', 'past_client', 'lost'] as const;

const Text = (max: number) => z.string().trim().min(1).max(max);
const Website = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'must be an http or https address');
const Money = z.number().min(0).max(1_000_000_000);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date written YYYY-MM-DD');
const uuid = z.uuid();

const NewAccount = z.object({
  name: Text(200),
  website: Website.optional(),
  market: Text(60).optional(),
  stage: z.enum(ACCOUNT_STAGES).optional(),
  health: Text(60).optional(),
  notes: z.string().max(5000).optional(),
});
const PatchAccount = z
  .object({
    name: Text(200),
    website: Website.nullable(),
    market: Text(60).nullable(),
    stage: z.enum(ACCOUNT_STAGES),
    health: Text(60).nullable(),
    notes: z.string().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change.' });

const NewContact = z.object({
  accountId: uuid,
  name: Text(200).optional(),
  role: Text(100).optional(),
  email: EmailIn.optional(),
  phone: Text(40).optional(),
  instagram: Text(100).optional(),
  xHandle: Text(100).optional(),
  linkedin: Text(300).optional(),
});

const NewDeal = z.object({ accountId: uuid, offer: Text(300).optional(), value: Money.optional(), nextStep: Text(500).optional(), due: Day.optional() });
const PatchDeal = z
  .object({ offer: Text(300).nullable(), value: Money.nullable(), nextStep: Text(500).nullable(), due: Day.nullable() })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change.' });

const ACCOUNT_COLUMNS: Record<string, string> = { name: 'name', website: 'website', market: 'market', stage: 'stage', health: 'health', notes: 'notes' };
const DEAL_COLUMNS: Record<string, string> = { offer: 'offer', value: 'value', nextStep: 'next_step', due: 'due' };

/**
 * Accounts, contacts and deals (SPEC 10): the business as a system of record. Promoting a lead is the one way a
 * prospect becomes an account, and it is done in code in one step, once.
 */
export function crmRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;
  const bad = (c: Context<AppEnv>, error: z.ZodError) => c.json({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
  const body = (c: Context<AppEnv>) => c.req.json().catch(() => null);
  const accountExists = async (c: Context<AppEnv>, id: string) => (await q(c, 'select 1 from accounts where id = $1', [id])).length > 0;

  function setClause(patch: Record<string, unknown>, columns: Record<string, string>, firstParam: number) {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${columns[k]} = $${firstParam + params.length - 1}`);
    }
    return { sets: sets.join(', '), params };
  }

  // ---- accounts
  r.get('/accounts', async (c) =>
    c.json(await q(c, 'select id, name, website, market, stage, health, notes, created_at from accounts order by created_at desc, id desc limit 500')),
  );

  r.post('/accounts', async (c) => {
    const p = NewAccount.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const a = p.data;
    const [row] = await q<{ id: string }>(
      c,
      'insert into accounts (workspace_id, name, website, market, stage, health, notes) values ($1, $2, $3, $4, coalesce($5, \'prospect\'), $6, $7) returning id',
      [ws, a.name, a.website ?? null, a.market ?? null, a.stage ?? null, a.health ?? null, a.notes ?? null],
    );
    return c.json({ id: row!.id }, 201);
  });

  r.get('/accounts/:id', async (c) => {
    const id = c.req.param('id');
    const [account] = await q(c, 'select id, name, website, market, stage, health, notes, created_at from accounts where id = $1', [id]);
    if (!account) return c.json({ error: 'Not found' }, 404);
    const contacts = await q(c, 'select id, name, role, email, phone, instagram, x_handle, linkedin from contacts where account_id = $1 order by created_at, id', [id]);
    const deals = await q(c, 'select id, offer, value, stage, next_step, due from deals where account_id = $1 order by created_at, id', [id]);
    return c.json({ ...account, contacts, deals });
  });

  r.patch('/accounts/:id', async (c) => {
    const p = PatchAccount.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const { sets, params } = setClause(p.data, ACCOUNT_COLUMNS, 2);
    const rows = await q(c, `update accounts set ${sets} where id = $1 returning id`, [c.req.param('id'), ...params]);
    return rows[0] ? c.json({ id: c.req.param('id') }) : c.json({ error: 'Not found' }, 404);
  });

  // ---- contacts
  r.get('/contacts', async (c) => {
    const accountId = c.req.query('accountId');
    if (accountId !== undefined && !uuid.safeParse(accountId).success) return c.json({ error: 'accountId must be an id' }, 400);
    return c.json(
      await q(c, 'select id, account_id, name, role, email, phone, instagram, x_handle, linkedin from contacts where ($1::uuid is null or account_id = $1) order by created_at desc, id desc limit 500', [accountId ?? null]),
    );
  });

  r.post('/contacts', async (c) => {
    const p = NewContact.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const k = p.data;
    if (!(await accountExists(c, k.accountId))) return c.json({ error: 'No such account.' }, 404);
    const [row] = await q<{ id: string }>(
      c,
      'insert into contacts (workspace_id, account_id, name, role, email, phone, instagram, x_handle, linkedin) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id',
      [ws, k.accountId, k.name ?? null, k.role ?? null, k.email ?? null, k.phone ?? null, k.instagram ?? null, k.xHandle ?? null, k.linkedin ?? null],
    );
    return c.json({ id: row!.id }, 201);
  });

  // ---- deals
  r.get('/deals', async (c) =>
    c.json(await q(c, 'select id, account_id, offer, value, stage, next_step, due from deals order by created_at desc, id desc limit 500')),
  );

  r.get('/deals/:id', async (c) => {
    const [row] = await q(c, 'select id, account_id, offer, value, stage, next_step, due from deals where id = $1', [c.req.param('id')]);
    return row ? c.json(row) : c.json({ error: 'Not found' }, 404);
  });

  r.post('/deals', async (c) => {
    const p = NewDeal.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const d = p.data;
    if (!(await accountExists(c, d.accountId))) return c.json({ error: 'No such account.' }, 404);
    const [row] = await q<{ id: string }>(c, 'insert into deals (workspace_id, account_id, offer, value, next_step, due) values ($1, $2, $3, $4, $5, $6) returning id', [
      ws,
      d.accountId,
      d.offer ?? null,
      d.value ?? null,
      d.nextStep ?? null,
      d.due ?? null,
    ]);
    return c.json({ id: row!.id }, 201);
  });

  r.patch('/deals/:id', async (c) => {
    const p = PatchDeal.safeParse(await body(c));
    if (!p.success) return bad(c, p.error);
    const { sets, params } = setClause(p.data, DEAL_COLUMNS, 2);
    const rows = await q(c, `update deals set ${sets} where id = $1 returning id`, [c.req.param('id'), ...params]);
    return rows[0] ? c.json({ id: c.req.param('id') }) : c.json({ error: 'Not found' }, 404);
  });

  // ---- promoting a lead
  r.post('/leads/:id/promote', async (c) => {
    const leadId = c.req.param('id');
    // The lead row is locked, so two promotions at once take turns and the second finds the first's work.
    const [lead] = await q<{
      id: string;
      stage: string;
      account_id: string | null;
      business_name: string | null;
      website: string | null;
      contact_name: string | null;
      email: string | null;
      market: string;
      notes: string | null;
    }>(c, 'select id, stage, account_id, business_name, website, contact_name, email, market, notes from leads where id = $1 for update', [leadId]);
    if (!lead) return c.json({ error: 'Not found' }, 404);

    if (lead.account_id) {
      const [contact] = await q<{ id: string }>(c, 'select id from contacts where account_id = $1 order by created_at, id limit 1', [lead.account_id]);
      const [deal] = await q<{ id: string }>(c, 'select id from deals where account_id = $1 order by created_at, id limit 1', [lead.account_id]);
      return c.json({ accountId: lead.account_id, contactId: contact?.id ?? null, dealId: deal?.id ?? null, existed: true });
    }
    if (lead.stage === 'do_not_contact') return c.json({ error: 'This lead is on the do-not-contact list, so it cannot become an account.' }, 409);

    const name = lead.business_name ?? lead.email ?? lead.website ?? 'Unnamed account';
    const [account] = await q<{ id: string }>(c, "insert into accounts (workspace_id, name, website, market, stage, notes) values ($1, $2, $3, $4, 'prospect', $5) returning id", [
      ws,
      name,
      lead.website,
      lead.market,
      lead.notes,
    ]);
    const [contact] = await q<{ id: string }>(c, 'insert into contacts (workspace_id, account_id, name, email) values ($1, $2, $3, $4) returning id', [ws, account!.id, lead.contact_name, lead.email]);
    const [deal] = await q<{ id: string }>(c, 'insert into deals (workspace_id, account_id, offer) values ($1, $2, $3) returning id', [ws, account!.id, `First offer to ${name}`]);
    await q(c, 'update leads set account_id = $2 where id = $1', [leadId, account!.id]);
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'lead.promoted', $3, $4)", [
      ws,
      ACTOR,
      leadId,
      JSON.stringify({ accountId: account!.id, contactId: contact!.id, dealId: deal!.id }),
    ]);
    return c.json({ accountId: account!.id, contactId: contact!.id, dealId: deal!.id, existed: false }, 201);
  });

  return r;
}
