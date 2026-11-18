import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalCrmConnector, syncFromCrm, type CrmAccount, type CrmConnector } from '../src/crm/sync';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** CRM sync with one system of record (S10-8): the tables are the record, an outside CRM is read and never outranks them. */
let sys: System;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const acct = (name: string) => sql('select id, name, stage, external_ref from accounts where name = $1', [name]).then((r) => r.rows[0]);

beforeAll(async () => {
  ({ sys } = await testSystem());
}, 240_000);
afterAll(() => sys?.close());

describe('CRM sync (S10-8)', () => {
  it('brings in an account the tables do not have, as a prospect unless its stage is a known one', async () => {
    const crm = new LocalCrmConnector([
      { externalId: 'sf-1', name: 'Glow Clinic', stage: 'client' },
      { externalId: 'sf-2', name: 'Bright Spa', stage: 'mystery-stage' },
    ]);
    expect(await syncFromCrm(sys.app, ws(), crm)).toMatchObject({ created: 2, matched: 0, conflicts: 0 });
    expect(await acct('Glow Clinic')).toMatchObject({ stage: 'client', external_ref: 'sf-1' });
    expect(await acct('Bright Spa')).toMatchObject({ stage: 'prospect', external_ref: 'sf-2' });
  });

  it('keeps what the tables say when the CRM disagrees, and flags the conflict once', async () => {
    await sql("update accounts set stage = 'past_client' where name = 'Glow Clinic'");
    const crm = new LocalCrmConnector([{ externalId: 'sf-1', name: 'Glow Clinic', stage: 'client' }]);
    expect(await syncFromCrm(sys.app, ws(), crm)).toMatchObject({ created: 0, matched: 1, conflicts: 1 });
    expect((await acct('Glow Clinic')).stage).toBe('past_client'); // the tables win
    const c = (await sql("select field, local_value, external_value, status from crm_conflicts")).rows;
    expect(c).toEqual([{ field: 'stage', local_value: 'past_client', external_value: 'client', status: 'open' }]);
    expect(await syncFromCrm(sys.app, ws(), crm)).toMatchObject({ conflicts: 0 }); // seen already
    expect((await sql('select count(*)::int as n from crm_conflicts')).rows[0].n).toBe(1);
  });

  it('matches by the external id first, then by name, and sets the id on a name match', async () => {
    await sql("insert into accounts (workspace_id, name) values ($1, 'Sunrise Dental')", [ws()]);
    const crm = new LocalCrmConnector([{ externalId: 'sf-9', name: 'sunrise dental' }]);
    expect(await syncFromCrm(sys.app, ws(), crm)).toMatchObject({ created: 0, matched: 1 });
    expect((await acct('Sunrise Dental')).external_ref).toBe('sf-9');
    expect((await sql("select count(*)::int as n from accounts where lower(name) = 'sunrise dental'")).rows[0].n).toBe(1);
  });

  it('never deletes or changes anything because the CRM no longer lists an account, and never writes to the CRM', async () => {
    const before = (await sql('select count(*)::int as n from accounts')).rows[0].n;
    class Spy implements CrmConnector {
      readonly name = 'spy';
      calls: string[] = [];
      async fetchAccounts(): Promise<CrmAccount[]> {
        this.calls.push('fetchAccounts');
        return [];
      }
    }
    const spy = new Spy();
    expect(await syncFromCrm(sys.app, ws(), spy)).toMatchObject({ created: 0, matched: 0, conflicts: 0 });
    expect(spy.calls).toEqual(['fetchAccounts']);
    expect(Object.keys(Object.getPrototypeOf(spy)).filter((k) => /write|update|push|create|delete/i.test(k))).toEqual([]);
    expect((await sql('select count(*)::int as n from accounts')).rows[0].n).toBe(before);
  });

  it('skips an entry with no id or no name, cuts a long name, and does not take markup as anything but text', async () => {
    const crm = new LocalCrmConnector([
      { externalId: '', name: 'No Id Ltd' },
      { externalId: 'sf-10', name: '   ' },
      { externalId: 'sf-11', name: `<b>Bold</b> ${'x'.repeat(500)}` },
    ]);
    const r = await syncFromCrm(sys.app, ws(), crm);
    expect(r).toMatchObject({ created: 1, skipped: 2 });
    const n = (await sql("select name from accounts where external_ref = 'sf-11'")).rows[0].name as string;
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n.startsWith('<b>Bold</b>')).toBe(true);
  });
});
