import type pg from 'pg';
import { z } from 'zod';

/**
 * The Boardroom's rule (SPEC 4, S6-10): any claim in a discussion cites a number or a record, and the OS checks it against its own
 * tables before the turn is kept. A citation is either a count ("tasks where status is todo: 12") or a record ("this lead"). Only
 * tables and columns on this list can be cited, so nothing an agent writes reaches the database as anything but a value, and the
 * check runs inside the company's own transaction, so another company's rows cannot be cited.
 */
const COUNTABLE = {
  tasks: ['status'],
  approvals: ['status', 'kind'],
  runs: ['status'],
  leads: ['stage'],
  signals: ['status'],
  posts: ['status'],
  deals: ['stage', 'status'],
  agents: ['status'],
} as const;
export const EVIDENCE_TABLES = Object.keys(COUNTABLE) as [keyof typeof COUNTABLE, ...(keyof typeof COUNTABLE)[]];

export const EvidenceItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('count'), table: z.enum(EVIDENCE_TABLES), where: z.object({ column: z.string().max(40), value: z.string().max(100) }).strict().optional(), claimed: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('record'), table: z.enum(EVIDENCE_TABLES), id: z.uuid() }).strict(),
]);
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export type EvidenceResult = { ok: true } | { ok: false; reasons: string[] };

/** Checks each citation against the tables. Every one that fails is named, with what the tables show. */
export async function checkEvidence(c: pg.PoolClient, items: unknown[]): Promise<EvidenceResult> {
  const reasons: string[] = [];
  for (const raw of items) {
    const parsed = EvidenceItem.safeParse(raw);
    if (!parsed.success) {
      reasons.push(`"${JSON.stringify(raw).slice(0, 80)}" is not a citation the OS can check (cite a count of ${EVIDENCE_TABLES.join(', ')} by one of their listed columns, or a record by id)`);
      continue;
    }
    const e = parsed.data;
    if (e.type === 'record') {
      const found = await c.query(`select 1 from ${e.table} where id = $1`, [e.id]);
      if (!found.rows[0]) reasons.push(`there is no ${e.table} record ${e.id}`);
      continue;
    }
    const columns = COUNTABLE[e.table] as readonly string[];
    if (e.where && !columns.includes(e.where.column)) {
      reasons.push(`${e.table} cannot be counted by ${e.where.column} (use ${columns.join(' or ')})`);
      continue;
    }
    const r = e.where
      ? await c.query<{ n: number }>(`select count(*)::int as n from ${e.table} where ${e.where.column} = $1`, [e.where.value])
      : await c.query<{ n: number }>(`select count(*)::int as n from ${e.table}`);
    const n = r.rows[0]!.n;
    if (n !== e.claimed) reasons.push(`${e.table}${e.where ? ` where ${e.where.column} = ${e.where.value}` : ''} is ${n}, not ${e.claimed}`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
