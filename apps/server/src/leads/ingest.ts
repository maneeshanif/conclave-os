import type { PoolClient } from 'pg';

export interface NewLeadInput {
  businessName?: string | undefined;
  website?: string | undefined;
  contactName?: string | undefined;
  email?: string | undefined;
  notes?: string | undefined;
  sourceUrl?: string | undefined;
  market?: string | undefined;
}

export type IngestResult =
  | { kind: 'created'; id: string; verified: boolean }
  | { kind: 'duplicate'; id: string; by: 'email' | 'website' }
  | { kind: 'suppressed' };

/** The host of a web address without a leading "www.", lowercased: "https://WWW.Glow.test/about" is "glow.test". */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** A web address a person or agent can have copied a source from: http or https, nothing else. */
export function isWebAddress(v: string): boolean {
  return /^https?:\/\//i.test(v) && URL.canParse(v);
}

/**
 * Adds a lead unless it is already there or may not be contacted. The same rules for an agent's add_lead and for a CSV
 * import: one lead per address however it is cased, one per website, nothing on the suppression list. A lead is verified
 * only when `verified` says so, and the callers say so only when there is a source. Takes a per-workspace lock, so the
 * same lead added by several runs at once is still one lead.
 */
export async function ingestLead(tx: PoolClient, ws: string, input: NewLeadInput, verified: boolean): Promise<IngestResult> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`lead-ingest:${ws}`]);
  const email = input.email?.toLowerCase() ?? null;
  const domain = domainOf(input.website);

  if (email) {
    const supp = await tx.query(
      `select 1 from suppression s where lower(s.value) = $1 or lower(s.value) = '@' || split_part($1, '@', 2) limit 1`,
      [email],
    );
    if (supp.rowCount) return { kind: 'suppressed' };
    const dup = await tx.query<{ id: string }>('select id from leads where lower(email) = $1', [email]);
    if (dup.rows[0]) return { kind: 'duplicate', id: dup.rows[0].id, by: 'email' };
  }
  if (domain) {
    const dup = await tx.query<{ id: string }>('select id from leads where domain = $1', [domain]);
    if (dup.rows[0]) return { kind: 'duplicate', id: dup.rows[0].id, by: 'website' };
  }
  const r = await tx.query<{ id: string }>(
    `insert into leads (workspace_id, business_name, website, domain, contact_name, email, notes, source_url, verified, market)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, 'services')) returning id`,
    [ws, input.businessName ?? null, input.website ?? null, domain, input.contactName ?? null, email, input.notes ?? null, input.sourceUrl ?? null, verified, input.market ?? null],
  );
  return { kind: 'created', id: r.rows[0]!.id, verified };
}
