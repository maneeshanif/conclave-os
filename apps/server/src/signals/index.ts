import type { PoolClient } from 'pg';
import { ingestLead } from '../leads/ingest';

/**
 * Signals (SPEC 3 rooms 6 and 9, SPEC 11): what the scouts find, kept as data. A signal is a public post or page with a
 * reason to act on it: someone asking for the services we sell, a recurring problem, a new tool. The scouts only read; a
 * signal is stored with where it came from so a person can check it, and nothing here posts, messages or follows anyone.
 */
export const SIGNAL_KINDS = ['service_request', 'pain_point', 'tool_news'] as const;
export const SIGNAL_STATUSES = ['new', 'qualified', 'dismissed', 'promoted'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid)$/i;

/** One form for a web address, so the same post found twice is one signal: no fragment, no tracking parameters, no trailing slash, no www. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('That is not a web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only a web address (http or https) can be a signal.');
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  let out = u.toString();
  if (u.pathname !== '/') out = out.replace(/\/(\?|$)/, '$1');
  return out;
}

export interface NewSignal {
  kind: SignalKind;
  source: string;
  url: string;
  author?: string | undefined;
  excerpt?: string | undefined;
  departmentId?: string | undefined;
}

export interface SignalRow {
  id: string;
  kind: SignalKind;
  source: string;
  url: string;
  author: string | null;
  excerpt: string | null;
  status: SignalStatus;
  score: number | null;
  reason: string | null;
  lead_id: string | null;
  found_by: string;
  found_at: Date;
}

const COLUMNS = 'id, kind, source, url, author, excerpt, status, score, reason, lead_id, found_by, found_at';

/** The shape the API and the web page use. */
export function signalView(r: SignalRow) {
  return { id: r.id, kind: r.kind, source: r.source, url: r.url, author: r.author, excerpt: r.excerpt, status: r.status, score: r.score, reason: r.reason, leadId: r.lead_id, foundBy: r.found_by, foundAt: r.found_at.toISOString() };
}

async function audit(tx: PoolClient, ws: string, actor: string, action: string, id: string, data: unknown = {}) {
  await tx.query('insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, $3, $4, $5)', [ws, actor, action, id, JSON.stringify(data)]);
}

/** Records a signal, or returns the one already stored for the same address. Safe to call twice at once. */
export async function addSignal(tx: PoolClient, ws: string, input: NewSignal, foundBy: string): Promise<{ id: string; created: boolean }> {
  const url = normalizeUrl(input.url);
  const r = await tx.query<{ id: string }>(
    `insert into signals (workspace_id, department_id, kind, source, url, author, excerpt, found_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (workspace_id, url) do nothing returning id`,
    [ws, input.departmentId ?? null, input.kind, input.source, url, input.author ?? null, input.excerpt ?? null, foundBy],
  );
  if (r.rows[0]) {
    await audit(tx, ws, foundBy, 'signal.added', r.rows[0].id, { kind: input.kind, source: input.source });
    return { id: r.rows[0].id, created: true };
  }
  const existing = await tx.query<{ id: string }>('select id from signals where url = $1', [url]);
  return { id: existing.rows[0]!.id, created: false };
}

export async function getSignal(tx: PoolClient, id: string): Promise<SignalRow | null> {
  return (await tx.query<SignalRow>(`select ${COLUMNS} from signals where id = $1`, [id])).rows[0] ?? null;
}

export type Change = { ok: true; signal: SignalRow } | { ok: false; status: 404 | 409; error: string };

/** Moves a signal to qualified, with a score and the reason. A dismissed one is reopened this way; a promoted one is final. */
export async function qualifySignal(tx: PoolClient, ws: string, id: string, by: string, o: { score?: number | undefined; reason?: string | undefined }): Promise<Change> {
  const cur = (await tx.query<{ status: SignalStatus }>('select status from signals where id = $1 for update', [id])).rows[0];
  if (!cur) return { ok: false, status: 404, error: 'Not found' };
  if (cur.status === 'promoted') return { ok: false, status: 409, error: 'This signal has already been promoted to a lead.' };
  const r = await tx.query<SignalRow>(`update signals set status = 'qualified', score = coalesce($2, score), reason = coalesce($3, reason), updated_at = now() where id = $1 returning ${COLUMNS}`, [id, o.score ?? null, o.reason ?? null]);
  await audit(tx, ws, by, 'signal.qualified', id, { score: o.score ?? null });
  return { ok: true, signal: r.rows[0]! };
}

export async function dismissSignal(tx: PoolClient, ws: string, id: string, by: string, reason?: string): Promise<Change> {
  const cur = (await tx.query<{ status: SignalStatus }>('select status from signals where id = $1 for update', [id])).rows[0];
  if (!cur) return { ok: false, status: 404, error: 'Not found' };
  if (cur.status === 'promoted') return { ok: false, status: 409, error: 'This signal has already been promoted to a lead.' };
  const r = await tx.query<SignalRow>(`update signals set status = 'dismissed', reason = coalesce($2, reason), updated_at = now() where id = $1 returning ${COLUMNS}`, [id, reason ?? null]);
  await audit(tx, ws, by, 'signal.dismissed', id, { reason: reason ?? null });
  return { ok: true, signal: r.rows[0]! };
}

/**
 * Makes a lead from a signal. The lead's source is the signal's address, so it is verified and may join a campaign; the usual
 * lead rules (suppression, duplicates) apply because it goes through the same ingest as every other lead. Promoting twice
 * returns the lead already made. A dismissed signal must be qualified again first.
 */
export async function promoteSignal(tx: PoolClient, ws: string, id: string, by: string): Promise<Change> {
  const s = (await tx.query<SignalRow>(`select ${COLUMNS} from signals where id = $1 for update`, [id])).rows[0];
  if (!s) return { ok: false, status: 404, error: 'Not found' };
  if (s.status === 'promoted' && s.lead_id) return { ok: true, signal: s };
  if (s.status === 'dismissed') return { ok: false, status: 409, error: 'This signal was dismissed. Qualify it again before promoting it.' };
  const notes = [s.excerpt, `Found by a scout on ${s.source}: ${s.url}`, s.reason ? `Why: ${s.reason}` : null].filter(Boolean).join('\n\n');
  const lead = await ingestLead(tx, ws, { businessName: s.author ?? `Signal from ${s.source}`, notes, sourceUrl: s.url, market: 'services' }, true);
  if (lead.kind === 'suppressed') return { ok: false, status: 409, error: 'This contact is on the suppression list.' };
  const r = await tx.query<SignalRow>(`update signals set status = 'promoted', lead_id = $2, updated_at = now() where id = $1 returning ${COLUMNS}`, [id, lead.id]);
  await audit(tx, ws, by, 'signal.promoted', id, { lead: lead.id });
  return { ok: true, signal: r.rows[0]! };
}
