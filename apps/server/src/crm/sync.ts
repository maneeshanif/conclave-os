import type pg from 'pg';
import { withWorkspace } from '../db/tenant';

/**
 * CRM sync with one system of record (S10-8, SPEC 10, 11). The tables are the record. An outside CRM is read through a connector and never
 * outranks them: where it disagrees with a table, the table is kept and the disagreement is written down (once) for a person to settle. The
 * connector has no way to write: the interface is a read, and the sync never calls anything that changes the CRM. An account the CRM no
 * longer lists is left alone.
 */
export interface CrmAccount {
  externalId: string;
  name: string;
  stage?: string;
}

export interface CrmConnector {
  readonly name: string;
  fetchAccounts(): Promise<CrmAccount[]>;
}

/** The stand-in: a list given to it. A real one (Salesforce, HubSpot) is a connector for later, read only. */
export class LocalCrmConnector implements CrmConnector {
  readonly name = 'local';
  constructor(private readonly accounts: CrmAccount[]) {}
  async fetchAccounts(): Promise<CrmAccount[]> {
    return this.accounts;
  }
}

const STAGES = ['prospect', 'client', 'past_client', 'lost'];

export interface SyncReport {
  created: number;
  matched: number;
  conflicts: number;
  skipped: number;
}

export async function syncFromCrm(pool: pg.Pool, workspaceId: string, crm: CrmConnector): Promise<SyncReport> {
  const outside = await crm.fetchAccounts();
  const report: SyncReport = { created: 0, matched: 0, conflicts: 0, skipped: 0 };
  await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    for (const o of outside) {
      const externalId = o.externalId.trim().slice(0, 200);
      const name = o.name.trim().slice(0, 200);
      if (!externalId || !name) {
        report.skipped++;
        continue;
      }
      const stage = o.stage && STAGES.includes(o.stage) ? o.stage : null;
      let row = (await c.query<{ id: string; stage: string; external_ref: string | null }>('select id, stage, external_ref from accounts where external_ref = $1', [externalId])).rows[0];
      if (!row) {
        row = (await c.query<{ id: string; stage: string; external_ref: string | null }>('select id, stage, external_ref from accounts where lower(name) = lower($1) and external_ref is null order by created_at limit 1', [name])).rows[0];
        if (row) await c.query('update accounts set external_ref = $2 where id = $1', [row.id, externalId]);
      }
      if (!row) {
        await c.query('insert into accounts (workspace_id, name, stage, external_ref) values ($1, $2, $3, $4)', [workspaceId, name, stage ?? 'prospect', externalId]);
        report.created++;
        continue;
      }
      report.matched++;
      if (stage && stage !== row.stage) {
        const r = await c.query('insert into crm_conflicts (workspace_id, account_id, field, local_value, external_value) values ($1, $2, $3, $4, $5) on conflict do nothing', [workspaceId, row.id, 'stage', row.stage, stage]);
        if (r.rowCount) report.conflicts++;
      }
    }
  });
  return report;
}
