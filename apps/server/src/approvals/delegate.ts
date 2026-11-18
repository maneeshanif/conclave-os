import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import { readSettings } from '../settings';

/**
 * The delegate (S8-10, SPEC 6, Identic AI): clears routine approvals in the founder's name, inside a written limit. Three gates run in code
 * before any decision posts: the delegate is registered and not revoked, the signature verifies, and the action sits inside both the mandate
 * and the owner's own policy. A failure refuses the decision (the approval stays pending, for a person) and says why in the ledger. The model is
 * never here: this is the posting step. The private key lives in a file outside the repository and never enters a prompt or the database.
 */

/** Kinds that are never delegated, whatever a mandate says (SPEC 6): publishing, messages to a new person, hires, code that leaves the machine, policy. */
export const NEVER_DELEGATED = ['post.publish', 'dm.send', 'hire', 'agent.create', 'skill.patch', 'repo.create', 'pr.merge', 'pr.open', 'deploy', 'video.brief'] as const;

/** How many times the founder must have decided a kind by hand before a mandate may cover it. */
export const HAND_DECISIONS_NEEDED = 20;

export interface Rule {
  kind: string;
  /** For `email.send`: only follow-ups, steps minSteps to maxStep, and only inside a campaign. */
  minStep?: number;
  maxStep?: number;
  requireCampaign?: boolean;
}
export type Mandate = Record<string, Rule>;

export interface Delegate {
  id: string;
  publicKeyPem: string;
  fingerprint: string;
  active: boolean;
  revokedAt: Date | null;
  mandate: Mandate;
}

export interface ApprovalFacts {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
}

export type Verdict = { ok: true } | { ok: false; reason: string };
const refuse = (reason: string): Verdict => ({ ok: false, reason });

/** The bytes a decision is signed over: the approval id, its kind and its payload, with keys in a fixed order. */
export function canonicalBytes(a: ApprovalFacts): Buffer {
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, stable(x)])) : v);
  return Buffer.from(JSON.stringify({ id: a.id, kind: a.kind, payload: stable(a.payload) }));
}

export const fingerprintOf = (publicKeyPem: string): string => createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

/** Does this rule allow this approval? Rules are data; only the kinds below have any. */
function ruleAllows(rule: Rule, a: ApprovalFacts): boolean {
  if (rule.kind !== a.kind) return false;
  if (a.kind === 'email.send') {
    const step = Number(a.payload.step);
    if (!Number.isInteger(step) || step < (rule.minStep ?? 2) || step > (rule.maxStep ?? 3)) return false;
    if (rule.requireCampaign !== false && !a.payload.campaignId) return false;
    return true;
  }
  return false; // no other kind has a rule yet
}

/** The three gates (SPEC 6). Pure: given the delegate, the approval and a signature over it. */
export function delegateMayClear(d: Delegate, a: ApprovalFacts, signature: Buffer): Verdict {
  if (!d.active || d.revokedAt) return refuse('the delegate is not registered, or is switched off or revoked');
  if (!verify(null, canonicalBytes(a), createPublicKey(d.publicKeyPem), signature)) return refuse('the signature does not verify');
  if ((NEVER_DELEGATED as readonly string[]).includes(a.kind)) return refuse(`${a.kind} is never delegated`);
  if (a.status !== 'pending') return refuse(`the approval is ${a.status}, not pending`);
  const rule = d.mandate[a.kind];
  if (!rule || !ruleAllows(rule, a)) return refuse('outside the mandate');
  return { ok: true };
}

const keyFile = (dir: string, workspaceId: string) => path.join(dir, `${workspaceId}.ed25519.pem`);

async function loadKey(dir: string, workspaceId: string): Promise<KeyObject> {
  return createPrivateKey(await readFile(keyFile(dir, workspaceId), 'utf8'));
}

/** Registers a delegate for this workspace: a new ed25519 key whose private half is written to a file only the server reads. Starts switched off. */
export async function createDelegate(pool: pg.Pool, workspaceId: string, keyDir: string): Promise<{ id: string; fingerprint: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await mkdir(keyDir, { recursive: true });
  const file = keyFile(keyDir, workspaceId);
  await writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  await chmod(file, 0o600).catch(() => undefined);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fp = fingerprintOf(pem);
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ id: string }>('insert into delegates (workspace_id, public_key_pem, fingerprint) values ($1, $2, $3) returning id', [workspaceId, pem, fp]));
  return { id: r.rows[0]!.id, fingerprint: fp };
}

export async function getDelegate(pool: pg.Pool, workspaceId: string): Promise<Delegate | null> {
  const r = await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ id: string; public_key_pem: string; fingerprint: string; active: boolean; revoked_at: Date | null; mandate: Mandate }>('select id, public_key_pem, fingerprint, active, revoked_at, mandate from delegates order by created_at desc limit 1'));
  const x = r.rows[0];
  return x ? { id: x.id, publicKeyPem: x.public_key_pem, fingerprint: x.fingerprint, active: x.active, revokedAt: x.revoked_at, mandate: x.mandate } : null;
}

/** Adds or changes one rule. A never-delegated kind is refused, and so is a kind the founder has not decided by hand enough times. */
export async function setMandateRule(pool: pg.Pool, workspaceId: string, rule: Rule): Promise<void> {
  if ((NEVER_DELEGATED as readonly string[]).includes(rule.kind)) throw new Error(`${rule.kind} is never delegated, so no mandate can cover it.`);
  if (rule.kind !== 'email.send') throw new Error(`There is no rule shape for ${rule.kind} yet. Only follow-up emails (email.send) can be delegated.`);
  const n = Number((await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<{ n: number }>("select count(*)::int as n from approvals where kind = $1 and decided_by = 'founder' and status in ('approved','executing','executed','failed','rejected')", [rule.kind]))).rows[0]!.n);
  if (n < HAND_DECISIONS_NEEDED) throw new Error(`You have decided ${rule.kind} by hand ${n} times. The delegate may take over a kind only after ${HAND_DECISIONS_NEEDED}.`);
  await withWorkspace(pool, workspaceId, ({ client: c }) => c.query("update delegates set mandate = mandate || jsonb_build_object($1::text, $2::jsonb) where id = (select id from delegates order by created_at desc limit 1)", [rule.kind, JSON.stringify(rule)]));
}

export async function setDelegateActive(pool: pg.Pool, workspaceId: string, active: boolean): Promise<void> {
  await withWorkspace(pool, workspaceId, ({ client: c }) => c.query('update delegates set active = $1 where revoked_at is null', [active]));
}

export async function revokeDelegate(pool: pg.Pool, workspaceId: string): Promise<void> {
  await withWorkspace(pool, workspaceId, ({ client: c }) => c.query('update delegates set active = false, revoked_at = now() where revoked_at is null'));
}

export type ClearResult = { outcome: 'cleared' } | { outcome: 'refused'; reason: string };

/**
 * The posting step: signs the approval with the delegate's key, runs the three gates, and, only if all pass and the kill switch is off,
 * decides the approval yes as `delegate:<fingerprint>`. Everything goes in the ledger, cleared or refused, matched on the approval id.
 * A refused approval stays pending: it goes up to a person.
 */
export async function clearWithDelegate(pool: pg.Pool, workspaceId: string, keyDir: string, approvalId: string, reasoning: string, signWith?: KeyObject): Promise<ClearResult> {
  const d = await getDelegate(pool, workspaceId);
  const a = (await withWorkspace(pool, workspaceId, ({ client: c }) => c.query<ApprovalFacts>('select id, kind, status, payload from approvals where id = $1', [approvalId]))).rows[0];
  if (!a) return { outcome: 'refused', reason: 'no such approval' };
  const note = async (outcome: 'cleared' | 'refused', reason: string | null, signature: Buffer | null) => {
    await withWorkspace(pool, workspaceId, ({ client: c }) =>
      c.query('insert into delegate_ledger (workspace_id, approval_id, delegate_id, kind, outcome, reason, reasoning, signature) values ($1, $2, $3, $4, $5, $6, $7, $8)', [workspaceId, approvalId, d?.id ?? null, a.kind, outcome, reason, reasoning.slice(0, 2000), signature ? signature.toString('base64') : null]),
    );
  };
  const no = async (reason: string, sig: Buffer | null = null): Promise<ClearResult> => {
    await note('refused', reason, sig);
    return { outcome: 'refused', reason };
  };
  if (!d) return no('there is no delegate');
  if (await withWorkspace(pool, workspaceId, async ({ client: c }) => (await readSettings(c, workspaceId)).killSwitch)) return no('the kill switch is on');
  let signature: Buffer;
  try {
    signature = sign(null, canonicalBytes(a), signWith ?? (await loadKey(keyDir, workspaceId)));
  } catch {
    return no('the delegate key could not be read');
  }
  const verdict = delegateMayClear(d, a, signature);
  if (!verdict.ok) return no(verdict.reason, signature);
  const decided = await withWorkspace(pool, workspaceId, async ({ client: c }) => {
    const r = await c.query("update approvals set status = 'approved', decided_by = $2, decided_at = now(), decision_note = 'Cleared by the delegate inside its mandate' where id = $1 and status = 'pending'", [approvalId, `delegate:${d.fingerprint}`]);
    if (r.rowCount) await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, $2, 'approval.decided', $3, $4)", [workspaceId, `delegate:${d.fingerprint}`, approvalId, JSON.stringify({ kind: a.kind, approved: true, delegate: true })]);
    return Boolean(r.rowCount);
  });
  if (!decided) return no('the approval was decided by someone else first', signature);
  await note('cleared', null, signature);
  return { outcome: 'cleared' };
}
