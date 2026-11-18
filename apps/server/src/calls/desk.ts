import type pg from 'pg';
import { checkClaims } from '../actions/policy';
import { withWorkspace } from '../db/tenant';

/** The digits of a phone number: how a number is compared with the suppression list and with another number. */
export const digits = (phone: string) => phone.replace(/\D+/g, '');

export interface CallItem {
  id: string;
  leadId: string;
  businessName: string;
  phone: string;
  opener: string;
  status: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One line to open a call with: who we are calling, and one thing we noticed if the notes say so. Never more than a line. */
export function openerFor(businessName: string, notes: string | null, companyMd: string): string {
  const plain = `Hi, is this ${businessName}? I have one quick question about how people book with you.`;
  const first = (notes ?? '').split(/(?<=[.!?])\s+/)[0]?.replace(/\s+/g, ' ').trim();
  if (!first) return plain;
  const noticed = `Hi, is this ${businessName}? I noticed this: ${clip(first, 120)} Do you have a minute?`;
  // A note may hold a claim we may not make; if the line would carry it, fall back to the plain one.
  return checkClaims(noticed, companyMd).ok ? noticed : plain;
}

/**
 * The daily call list (S9-8, SPEC 4): leads with a phone number that are still worth a call (not won, lost or marked do not contact, and not
 * on the suppression list), those who have replied first, up to the limit, each with a one-line opener. Asking again for the same day adds
 * nothing. A lead is on a given day's list once.
 */
export async function buildCallList(pool: pg.Pool, workspaceId: string, o: { day: string; limit: number; companyMd?: string }): Promise<CallItem[]> {
  const companyMd = o.companyMd ?? '';
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const have = Number((await c.query<{ n: number }>('select count(*)::int as n from call_list_items where day = $1', [o.day])).rows[0]!.n);
    if (have >= o.limit) return;
    const suppressed = new Set((await c.query<{ value: string }>('select value from suppression')).rows.map((r) => digits(r.value)).filter(Boolean));
    const rows = (
      await c.query<{ id: string; business_name: string | null; phone: string; notes: string | null; stage: string }>(
        `select id, business_name, phone, notes, stage from leads
          where phone is not null and phone <> '' and stage in ('new','contacted','replied')
            and not exists (select 1 from call_list_items i where i.lead_id = leads.id and i.day = $1)
          order by (stage = 'replied') desc, created_at, id`,
        [o.day],
      )
    ).rows.filter((r) => !suppressed.has(digits(r.phone)));
    for (const r of rows.slice(0, o.limit - have)) {
      const name = r.business_name?.trim() || 'your business';
      await c.query('insert into call_list_items (workspace_id, lead_id, day, opener) values ($1, $2, $3, $4) on conflict do nothing', [workspaceId, r.id, o.day, openerFor(name, r.notes, companyMd)]);
    }
  });
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) =>
    c.query<{ id: string; lead_id: string; business_name: string | null; phone: string; opener: string; status: string }>(
      `select i.id, i.lead_id, l.business_name, l.phone, i.opener, i.status from call_list_items i join leads l on l.id = i.lead_id and l.workspace_id = i.workspace_id
        where i.day = $1 order by (l.stage = 'replied') desc, l.created_at, l.id`,
      [o.day],
    ),
  );
  return r.rows.map((x) => ({ id: x.id, leadId: x.lead_id, businessName: x.business_name?.trim() || 'your business', phone: x.phone, opener: x.opener, status: x.status }));
}
