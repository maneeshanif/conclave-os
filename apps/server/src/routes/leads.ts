import { Hono, type Context } from 'hono';
import type { PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';
import type { AppEnv } from '../app';
import type { Bus } from '../bus';
import { COLUMN_ALIASES, mapHeaders, parseCsv } from '../leads/csv';
import { domainOf, ingestLead, isWebAddress, type NewLeadInput } from '../leads/ingest';

export const LEAD_STAGES = ['new', 'contacted', 'replied', 'qualified', 'won', 'lost', 'do_not_contact'] as const;
const MARKETS = ['services', 'product', 'founder_network'] as const;

/** Until login exists (S1-10) there is one person acting. */
const ACTOR = 'founder';

/** An address is stored trimmed and lowercased, so "Dana@Clinic.com" and "dana@clinic.com" are one person. */
export const EmailIn = z.string().trim().toLowerCase().max(254).pipe(z.email());
const Website = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'must be an http or https address');
const Text = (max: number) => z.string().trim().min(1).max(max);

const NewLead = z
  .object({
    businessName: Text(200).optional(),
    website: Website.optional(),
    contactName: Text(200).optional(),
    email: EmailIn.optional(),
    market: z.enum(MARKETS).optional(),
    notes: z.string().max(5000).optional(),
    stage: z.enum(LEAD_STAGES).optional(),
  })
  .refine((v) => v.businessName || v.email || v.website, { message: 'Give at least a business name, an email address or a website.' });

const PatchLead = z
  .object({
    businessName: Text(200).nullable().optional(),
    website: Website.nullable().optional(),
    contactName: Text(200).nullable().optional(),
    email: EmailIn.nullable().optional(),
    market: z.enum(MARKETS).optional(),
    notes: z.string().max(5000).nullable().optional(),
    stage: z.enum(LEAD_STAGES).optional(),
    verified: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change.' });

const COLUMNS: Record<string, string> = {
  businessName: 'business_name',
  website: 'website',
  contactName: 'contact_name',
  email: 'email',
  market: 'market',
  notes: 'notes',
  stage: 'stage',
  verified: 'verified',
};

const MAX_IMPORT_ROWS = 5000;
const ImportBody = z.object({ csv: z.string().min(1, 'is empty').max(2_000_000, 'is too large (2 MB at most)'), dryRun: z.boolean().default(false), verified: z.boolean().default(false) });

const ListQuery = z.object({
  stage: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** True when the address, or its whole domain, is on the suppression list. Same rule as the executor's. */
const SUPPRESSED = `exists (select 1 from suppression s
                            where lower(s.value) = lower(l.email)
                               or lower(s.value) = '@' || split_part(lower(l.email), '@', 2))`;

/** Escapes % and _ so a search for "50%" finds "50%" and not everything. */
const likePattern = (q: string) => `%${q.replace(/[!%_]/g, (m) => `!${m}`)}%`;

/** Puts an address on the suppression list. Quietly does nothing if it is already there. */
export async function suppress(tx: PoolClient, workspaceId: string, value: string, reason: string, actor = ACTOR): Promise<string | null> {
  const r = await tx.query<{ id: string }>(
    'insert into suppression (workspace_id, value, reason) values ($1, $2, $3) on conflict (workspace_id, value) do nothing returning id',
    [workspaceId, value, reason],
  );
  if (!r.rows[0]) return null;
  await tx.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'suppression.added', $3, $4)", [
    workspaceId,
    actor,
    r.rows[0].id,
    JSON.stringify({ value, reason }),
  ]);
  return r.rows[0].id;
}

/**
 * Leads (SPEC 10). A lead is who the company may write to. Marking one do-not-contact also puts its address on
 * the suppression list, so the proposal handler and the executor refuse it even if the stage is changed later;
 * the stage cannot be moved back while the address is still listed.
 */
export function leadRoutes(deps: { workspaceId: string; bus: Bus }) {
  const r = new Hono<AppEnv>();
  const ws = deps.workspaceId;
  const q = async <T extends QueryResultRow>(c: Context<AppEnv>, sql: string, params: unknown[] = []) => (await c.get('tx').client.query<T>(sql, params)).rows;
  const bad = (c: Context<AppEnv>, error: z.ZodError) => c.json({ error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);

  r.get('/', async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) return bad(c, parsed.error);
    const { stage, q: search, limit } = parsed.data;
    let stages: string[] | null = null;
    if (stage) {
      stages = stage.split(',').map((s) => s.trim());
      const unknown = stages.find((s) => !(LEAD_STAGES as readonly string[]).includes(s));
      if (unknown) return c.json({ error: `Unknown stage "${unknown}". Known: ${LEAD_STAGES.join(', ')}` }, 400);
    }
    return c.json(
      await q(
        c,
        `select l.id, l.business_name, l.website, l.contact_name, l.email, l.market, l.stage, l.notes, l.created_at, l.verified, l.score, l.score_reason, l.source_url, ${SUPPRESSED} as suppressed
           from leads l
          where ($1::text[] is null or l.stage = any($1))
            and ($2::text is null or l.business_name ilike $2 escape '!' or l.email ilike $2 escape '!'
                                  or l.contact_name ilike $2 escape '!' or l.website ilike $2 escape '!')
          order by l.created_at desc, l.id desc limit $3`,
        [stages, search ? likePattern(search) : null, limit],
      ),
    );
  });

  /**
   * A CSV the person drops in. `dryRun` shows what would happen and writes nothing. Rows are checked one by one: a bad
   * row or a duplicate is reported with its row number and the rest still go in. A row is verified only if it names a
   * source_url, or the person says the whole file is verified.
   */
  r.post('/import', async (c) => {
    const parsed = ImportBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const { csv, dryRun, verified: fileVerified } = parsed.data;
    const records = parseCsv(csv);
    if (records.length < 2) return c.json({ error: 'The file needs a header row and at least one row of leads.' }, 400);
    if (records.length - 1 > MAX_IMPORT_ROWS) return c.json({ error: `That is ${records.length - 1} rows. The limit is ${MAX_IMPORT_ROWS} per file: split it.` }, 400);
    const { columns, ignored } = mapHeaders(records[0]!);
    const known = new Set(columns.values());
    if (!known.has('business_name') && !known.has('email') && !known.has('website')) {
      return c.json({ error: `No column says who a lead is. Name at least one column business_name, email or website (${Object.values(COLUMN_ALIASES).flat().slice(0, 6).join(', ')} and similar are understood).` }, 400);
    }
    const tx = c.get('tx').client;
    // A preview does the real work inside a savepoint and then undoes it, so it reports exactly what a real import would.
    await tx.query('savepoint lead_import');
    let created = 0;
    const duplicates: { row: number; reason: string }[] = [];
    const invalid: { row: number; reason: string }[] = [];
    for (const [i, rec] of records.slice(1).entries()) {
      const row = i + 2;
      const cell: Partial<Record<keyof typeof COLUMN_ALIASES, string>> = {};
      for (const [col, name] of columns) {
        const v = (rec[col] ?? '').trim();
        if (v) cell[name] = v;
      }
      const input: NewLeadInput = {};
      if (cell.business_name) input.businessName = cell.business_name.slice(0, 200);
      if (cell.contact_name) input.contactName = cell.contact_name.slice(0, 200);
      if (cell.notes) input.notes = cell.notes.slice(0, 5000);
      if (cell.email) {
        const e = EmailIn.safeParse(cell.email);
        if (!e.success) {
          invalid.push({ row, reason: `"${cell.email}" is not an email address` });
          continue;
        }
        input.email = e.data;
      }
      if (cell.website) {
        const w = /^[a-z][a-z0-9+.-]*:/i.test(cell.website) ? cell.website : `https://${cell.website}`;
        if (!isWebAddress(w) || w.length > 300) {
          invalid.push({ row, reason: `"${cell.website}" is not a website address (http or https)` });
          continue;
        }
        input.website = w;
      }
      if (cell.source_url) {
        if (!isWebAddress(cell.source_url) || cell.source_url.length > 500) {
          invalid.push({ row, reason: `"${cell.source_url}" is not a web address for the source` });
          continue;
        }
        input.sourceUrl = cell.source_url;
      }
      if (!input.businessName && !input.email && !input.website) {
        invalid.push({ row, reason: 'nothing says who this lead is: no business name, email or website' });
        continue;
      }
      const res = await ingestLead(tx, ws, input, fileVerified || !!input.sourceUrl);
      if (res.kind === 'created') created++;
      else if (res.kind === 'duplicate') duplicates.push({ row, reason: `already in the list (same ${res.by})` });
      else invalid.push({ row, reason: 'the address is on the suppression list' });
    }
    if (dryRun) await tx.query('rollback to savepoint lead_import');
    else {
      await tx.query('release savepoint lead_import');
      await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'leads.imported', null, $3)", [ws, ACTOR, JSON.stringify({ created, duplicates: duplicates.length, invalid: invalid.length })]);
    }
    return c.json({ ...(dryRun ? { would_create: created } : { created }), duplicates, invalid, ignored_columns: ignored });
  });

  r.get('/:id', async (c) => {
    const [lead] = await q(
      c,
      `select l.id, l.business_name, l.website, l.contact_name, l.email, l.market, l.stage, l.notes, l.created_at, l.verified, l.score, l.score_reason, l.source_url, ${SUPPRESSED} as suppressed
         from leads l where l.id = $1`,
      [c.req.param('id')],
    );
    if (!lead) return c.json({ error: 'Not found' }, 404);
    const messages = await q(c, 'select id, step, subject, status, sent_at, approval_id from outreach_messages where lead_id = $1 order by created_at, id', [c.req.param('id')]);
    return c.json({ ...lead, messages });
  });

  r.post('/', async (c) => {
    const parsed = NewLead.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const b = parsed.data;
    const [row] = await q<{ id: string }>(
      c,
      `insert into leads (workspace_id, business_name, website, contact_name, email, market, notes, stage, domain)
       values ($1, $2, $3, $4, $5, coalesce($6, 'services'), $7, coalesce($8, 'new'), $9)
       on conflict (workspace_id, lower(email)) where email is not null do nothing returning id`,
      [ws, b.businessName ?? null, b.website ?? null, b.contactName ?? null, b.email ?? null, b.market ?? null, b.notes ?? null, b.stage ?? null, domainOf(b.website)],
    );
    if (!row) {
      const [existing] = await q<{ id: string }>(c, 'select id from leads where lower(email) = $1', [b.email]);
      return c.json({ error: 'A lead with this address already exists.', id: existing?.id }, 409);
    }
    if (b.stage === 'do_not_contact' && b.email) await suppress(c.get('tx').client, ws, b.email, 'marked do not contact');
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'lead.created', $3, '{}')", [ws, ACTOR, row.id]);
    return c.json({ id: row.id }, 201);
  });

  r.patch('/:id', async (c) => {
    const parsed = PatchLead.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return bad(c, parsed.error);
    const b = parsed.data as Record<string, unknown>;
    const id = c.req.param('id');
    const tx = c.get('tx').client;

    const [lead] = await q<{ email: string | null; stage: string }>(c, 'select email, stage from leads where id = $1 for update', [id]);
    if (!lead) return c.json({ error: 'Not found' }, 404);
    const email = b.email !== undefined ? (b.email as string | null) : lead.email;
    const stage = (b.stage as string | undefined) ?? lead.stage;

    // Changes to one address wait for each other, so two leads cannot both take it.
    if (email) await q(c, 'select pg_advisory_xact_lock(hashtext($1))', [`lead-email:${ws}:${email}`]);
    if (email && email !== lead.email) {
      const [taken] = await q<{ id: string }>(c, 'select id from leads where lower(email) = $1 and id <> $2', [email, id]);
      if (taken) return c.json({ error: 'Another lead already has this address.', id: taken.id }, 409);
    }
    // Moving a lead out of do-not-contact must be a deliberate act: take the address off the list first.
    if (lead.stage === 'do_not_contact' && stage !== 'do_not_contact' && email) {
      const [listed] = await q(c, `select 1 from suppression s where lower(s.value) = $1 or lower(s.value) = '@' || split_part($1, '@', 2)`, [email]);
      if (listed) return c.json({ error: 'This address is still on the suppression list. Remove it from the list, with a reason, before changing the stage.' }, 409);
    }

    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, col] of Object.entries(COLUMNS)) {
      if (b[key] !== undefined) {
        values.push(b[key]);
        sets.push(`${col} = $${values.length}`);
      }
    }
    if (b.website !== undefined) {
      values.push(domainOf(b.website as string | null));
      sets.push(`domain = $${values.length}`);
    }
    await q(c, `update leads set ${sets.join(', ')} where id = $1`, values);

    // A do-not-contact lead's address is always on the list, including after it changes.
    if (stage === 'do_not_contact' && email) await suppress(tx, ws, email, 'marked do not contact');
    await q(c, "insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'lead.updated', $3, $4)", [ws, ACTOR, id, JSON.stringify({ fields: Object.keys(b) })]);
    return c.json({ id });
  });

  return r;
}
