import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalBytes, clearWithDelegate, createDelegate, delegateMayClear, getDelegate, HAND_DECISIONS_NEEDED, revokeDelegate, setDelegateActive, setMandateRule, type Delegate } from '../src/approvals/delegate';
import { withWorkspace } from '../src/db/tenant';
import type { System } from '../src/system';
import { testSystem } from './helpers/db';

/** The delegate (S8-10): clears routine approvals inside a written limit, signs every decision, and refuses the rest in code. */
let sys: System;
let keyDir = '';
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const email = async (step: number, campaign: boolean, status = 'pending') =>
  (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status) values ($1, 'email.send', $2, $3, $4) returning id", [ws(), `t:${randomUUID()}`, JSON.stringify({ step, to: 'a@b.test', subject: 's', body: 'b', ...(campaign ? { campaignId: randomUUID() } : {}) }), status])).rows[0].id as string;
const ledger = async (id: string) => (await sql('select outcome, reason, reasoning, signature, kind from delegate_ledger where approval_id = $1 order by created_at', [id])).rows;
const status = async (id: string) => (await sql('select status, decided_by from approvals where id = $1', [id])).rows[0] as { status: string; decided_by: string | null };

beforeAll(async () => {
  ({ sys } = await testSystem());
  keyDir = await mkdtemp(path.join(tmpdir(), 'conclave-keys-'));
}, 240_000);
afterAll(async () => {
  await sys?.close();
  if (keyDir) await rm(keyDir, { recursive: true, force: true });
});

describe('the delegate (S8-10)', () => {
  it('is registered switched off, with a fingerprint you can see, and its private key in a file outside the database', async () => {
    const made = await createDelegate(sys.app, ws(), keyDir);
    expect(made.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const d = (await getDelegate(sys.app, ws()))!;
    expect(d).toMatchObject({ active: false, fingerprint: made.fingerprint, mandate: {} });
    const file = path.join(keyDir, `${ws()}.ed25519.pem`);
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    const row = JSON.stringify((await sql('select * from delegates')).rows);
    expect(row).not.toContain('PRIVATE KEY');
    expect(readFileSync(file, 'utf8')).toContain('PRIVATE KEY');
    await expect(createDelegate(sys.app, ws(), keyDir)).rejects.toThrow(); // a key is never overwritten
  });

  it('may not take a kind over until it has been decided by hand twenty times, and never takes a never-delegated kind', async () => {
    await expect(setMandateRule(sys.app, ws(), { kind: 'email.send', minStep: 2, maxStep: 3 })).rejects.toThrow(new RegExp(`${HAND_DECISIONS_NEEDED}`));
    for (const kind of ['post.publish', 'hire', 'pr.merge', 'deploy', 'dm.send']) await expect(setMandateRule(sys.app, ws(), { kind })).rejects.toThrow(/never delegated/);
    for (let i = 0; i < HAND_DECISIONS_NEEDED; i++) await sql("insert into approvals (workspace_id, kind, dedupe_key, payload, status, decided_by) values ($1, 'email.send', $2, '{}', 'executed', 'founder')", [ws(), `hand:${i}`]);
    await setMandateRule(sys.app, ws(), { kind: 'email.send', minStep: 2, maxStep: 3 });
    expect((await getDelegate(sys.app, ws()))!.mandate['email.send']).toMatchObject({ minStep: 2, maxStep: 3 });
  });

  it('does nothing while it is switched off', async () => {
    const id = await email(2, true);
    expect(await clearWithDelegate(sys.app, ws(), keyDir, id, 'A routine follow-up.')).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/not registered|switched off/) });
    expect((await status(id)).status).toBe('pending');
  });

  it('clears one routine approval, signed, as the delegate, with its reasoning in the ledger', async () => {
    await setDelegateActive(sys.app, ws(), true);
    const id = await email(2, true);
    expect(await clearWithDelegate(sys.app, ws(), keyDir, id, 'Follow-up 2 of an approved sequence, same wording as the ones you approved.')).toEqual({ outcome: 'cleared' });
    const d = (await getDelegate(sys.app, ws()))!;
    expect(await status(id)).toEqual({ status: 'approved', decided_by: `delegate:${d.fingerprint}` });
    const [l] = await ledger(id);
    expect(l).toMatchObject({ outcome: 'cleared', kind: 'email.send' });
    expect(l.reasoning).toMatch(/Follow-up 2/);
    expect(Buffer.from(l.signature, 'base64')).toHaveLength(64);
    expect(await clearWithDelegate(sys.app, ws(), keyDir, id, 'again')).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/not pending/) }); // never decides twice
  });

  it('refuses one outside its limit, leaves it pending for a person, and says why in the ledger', async () => {
    for (const [step, campaign, why] of [[1, true, 'first message'], [4, true, 'past the mandate'], [2, false, 'no campaign']] as const) {
      const id = await email(step, campaign);
      expect(await clearWithDelegate(sys.app, ws(), keyDir, id, why), why).toEqual({ outcome: 'refused', reason: 'outside the mandate' });
      expect((await status(id)).status).toBe('pending');
      expect((await ledger(id))[0]).toMatchObject({ outcome: 'refused', reason: 'outside the mandate' });
    }
    const post = (await sql("insert into approvals (workspace_id, kind, dedupe_key, payload) values ($1, 'post.publish', 'p1', '{}') returning id", [ws()])).rows[0].id as string;
    expect(await clearWithDelegate(sys.app, ws(), keyDir, post, 'publish it')).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/never delegated/) });
  });

  it('refuses a bad signature (a different key), and the kill switch, and a revoked delegate', async () => {
    const d = (await getDelegate(sys.app, ws()))!;
    const a = { id: randomUUID(), kind: 'email.send', status: 'pending', payload: { step: 2, campaignId: 'c' } };
    const other = generateKeyPairSync('ed25519');
    expect(delegateMayClear(d, a, sign(null, canonicalBytes(a), other.privateKey))).toEqual({ ok: false, reason: 'the signature does not verify' });
    const tampered = { ...a, payload: { step: 3, campaignId: 'c' } };
    expect(delegateMayClear(d, tampered, sign(null, canonicalBytes(a), other.privateKey)).ok).toBe(false);

    const id = await email(3, true);
    await sql('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [ws()]);
    await sql('update workspace_settings set kill_switch = 1');
    expect(await clearWithDelegate(sys.app, ws(), keyDir, id, 'x')).toEqual({ outcome: 'refused', reason: 'the kill switch is on' });
    await sql('update workspace_settings set kill_switch = 0');
    await revokeDelegate(sys.app, ws());
    expect(await clearWithDelegate(sys.app, ws(), keyDir, id, 'x')).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/revoked|switched off/) });
    expect((await status(id)).status).toBe('pending');
    const asRevoked: Delegate = { ...d, active: true, revokedAt: new Date() };
    expect(delegateMayClear(asRevoked, a, Buffer.alloc(64)).ok).toBe(false);
  });
});
