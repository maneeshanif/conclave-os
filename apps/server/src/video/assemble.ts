import { createHash } from 'node:crypto';
import type pg from 'pg';
import { withWorkspace } from '../db/tenant';
import type { Shot } from './briefs';
import { reviewPlan } from './review';

/**
 * Assembly (SPEC 8): the scenes, captions, timing and brand of a video laid out from an approved brief and its assets. Assembly is
 * code, not a model, so the same inputs give the same plan byte for byte. The plan is what a renderer (Remotion) draws; this
 * file decides nothing about pixels. A plan is reviewed by rules in code before anyone is asked to approve the video.
 */
export interface Brand {
  primary: string;
  text: string;
  logo: string;
}
export interface Scene {
  shot: number;
  kind: 'text' | 'image' | 'clip';
  start: number;
  duration: number;
  text: string | null;
  assetKey: string | null;
}
export interface Caption {
  start: number;
  end: number;
  text: string;
}
export interface Plan {
  scenes: Scene[];
  captions: Caption[];
  durationSeconds: number;
  brand: Brand;
}

/** The brand from the "## Brand" section of COMPANY.md: primary and text colours as #RRGGBB, and the logo's asset key. Null if absent or malformed. */
export function parseBrand(companyMd: string): Brand | null {
  const lines = companyMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+brand\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const found: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const m = /^\s*[-*]\s+(primary|text|logo)\s*:\s*(\S+)\s*$/i.exec(line);
    if (m) found[m[1]!.toLowerCase()] = m[2]!;
  }
  const hex = /^#[0-9a-f]{6}$/i;
  if (!found.primary || !found.text || !found.logo || !hex.test(found.primary) || !hex.test(found.text)) return null;
  return { primary: found.primary, text: found.text, logo: found.logo };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildPlan(i: { title: string; script: string; shots: Shot[]; assets: { shot: number; key: string; kind: string }[]; brand: Brand }): Plan {
  const byShot = new Map(i.assets.map((a) => [a.shot, a.key]));
  let t = 0;
  const scenes: Scene[] = i.shots.map((s, idx) => {
    const scene: Scene = { shot: idx + 1, kind: s.kind, start: t, duration: s.seconds, text: s.kind === 'text' ? s.description : null, assetKey: s.kind === 'text' ? null : (byShot.get(idx + 1) ?? null) };
    t += s.seconds;
    return scene;
  });
  const sentences = i.script.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const captions: Caption[] = sentences.map((text, n) => ({ start: round2((n * t) / sentences.length), end: n === sentences.length - 1 ? t : round2(((n + 1) * t) / sentences.length), text }));
  return { scenes, captions, durationSeconds: t, brand: { primary: i.brand.primary, text: i.brand.text, logo: i.brand.logo } };
}

/** The plan as text with a fixed key order, so it can be compared and hashed. */
export const planJson = (p: Plan) => JSON.stringify(p);
export const planHash = (p: Plan) => createHash('sha256').update(planJson(p)).digest('hex');

/**
 * Builds the plan for a brief whose assets were generated, reviews it, and stores the plan, its hash and the review. A plan that
 * passes is `ready`; one that does not is `review_failed` with the reasons, and nothing is offered for approval from it.
 */
export async function assembleBrief(c: pg.PoolClient, ws: string, briefId: string, companyMd: string): Promise<{ ok: boolean; reasons: string[]; hash: string }> {
  const b = (await c.query<{ title: string; script: string; shots: Shot[]; status: string }>('select title, script, shots, status from video_briefs where id = $1 for update', [briefId])).rows[0];
  if (!b) throw new Error('No such brief.');
  if (!['generated', 'ready', 'review_failed'].includes(b.status)) throw new Error(`This brief has not been generated yet (it is ${b.status}), so there is nothing to assemble.`);
  const assets = (await c.query<{ shot: number; key: string; kind: string }>('select shot, key, kind from video_assets where brief_id = $1 order by shot', [briefId])).rows;
  const brand = parseBrand(companyMd) ?? { primary: '', text: '', logo: '' };
  const plan = buildPlan({ title: b.title, script: b.script, shots: b.shots, assets, brand });
  const review = reviewPlan(plan, { shots: b.shots, script: b.script }, companyMd);
  const hash = planHash(plan);
  await c.query('update video_briefs set plan = $2, plan_hash = $3, review = $4, status = $5 where id = $1', [briefId, JSON.stringify(plan), hash, JSON.stringify(review), review.ok ? 'ready' : 'review_failed']);
  await c.query("insert into audit_log (workspace_id, actor, action, subject, data) values ($1, 'system', $2, $3, $4)", [ws, review.ok ? 'video_plan.ready' : 'video_plan.review_failed', briefId, JSON.stringify({ hash, reasons: review.reasons })]);
  return { ok: review.ok, reasons: review.reasons, hash };
}

/** Assembles every brief whose assets have just been generated. Run by the ticker, so a finished generation becomes a reviewed plan without anyone asking. */
export async function assembleGenerated(pool: pg.Pool, ws: string, companyMd: string): Promise<{ ready: string[]; failed: string[] }> {
  const ids = await withWorkspace(pool, ws, ({ client: c }) => c.query<{ id: string }>("select id from video_briefs where status = 'generated' order by created_at"));
  const out = { ready: [] as string[], failed: [] as string[] };
  for (const { id } of ids.rows) {
    const r = await withWorkspace(pool, ws, ({ client: c }) => assembleBrief(c, ws, id, companyMd));
    (r.ok ? out.ready : out.failed).push(id);
  }
  return out;
}
