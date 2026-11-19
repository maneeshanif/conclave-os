import { z } from 'zod';

/**
 * Release channels (A6, SPEC 16, borrow audit P9): stable, beta and nightly, with a smoke gate. Someone who installs the OS picks a channel; an
 * upgrade is offered only from that channel (beta sees beta and stable, nightly sees everything) and only if it is newer than what runs and
 * passes the smoke checks. Pure: the list of releases is data a publisher writes (a `releases.json`), and the smoke gate is a function given
 * in, so a person can read the rule and a test can run it. Nothing is downloaded here and nothing is installed.
 */
export const CHANNELS = ['stable', 'beta', 'nightly'] as const;
export type Channel = (typeof CHANNELS)[number];

const Semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'a version such as 1.4.0 or 1.5.0-beta.2');
const Release = z.object({ version: Semver, channel: z.enum(CHANNELS), notes: z.string().max(2000).optional() }).strict();
export const ReleasesFile = z.object({ releases: z.array(Release).max(500) }).strict();
export type Release = z.infer<typeof Release>;

/** Which channels a person on `channel` may take a release from: the one they chose and every steadier one. */
export const VISIBLE: Record<Channel, readonly Channel[]> = { stable: ['stable'], beta: ['stable', 'beta'], nightly: ['stable', 'beta', 'nightly'] };

/** -1, 0 or 1. A release with a suffix (1.5.0-beta.2) is older than the same number without one (1.5.0). */
export function compareVersions(a: string, b: string): number {
  const [an, ap = ''] = a.split(/-(.+)/);
  const [bn, bp = ''] = b.split(/-(.+)/);
  const x = an!.split('.').map(Number);
  const y = bn!.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! < y[i]! ? -1 : 1;
  if (ap === bp) return 0;
  if (!ap) return 1;
  if (!bp) return -1;
  return ap.localeCompare(bp, undefined, { numeric: true }) < 0 ? -1 : 1;
}

/** The newest release a person on `channel` could move to from `current`, or null if there is none. */
export function newestFor(channel: Channel, current: string, releases: Release[]): Release | null {
  const ok = releases.filter((r) => VISIBLE[channel].includes(r.channel) && compareVersions(r.version, current) > 0);
  return ok.sort((p, q) => compareVersions(q.version, p.version))[0] ?? null;
}

export interface SmokeResult {
  ok: boolean;
  reasons: string[];
}

export type UpgradePlan = { action: 'none'; why: string } | { action: 'blocked'; release: Release; reasons: string[] } | { action: 'upgrade'; release: Release };

/**
 * Decides an upgrade: nothing to do, blocked by the smoke gate (with why), or go. The gate is run only when there is something to move to, and a
 * gate that throws counts as a failure, so a broken check never lets a release through.
 */
export async function planUpgrade(o: { channel: Channel; current: string; releases: unknown; smoke: (r: Release) => Promise<SmokeResult> }): Promise<UpgradePlan> {
  const parsed = ReleasesFile.safeParse(o.releases);
  if (!parsed.success) return { action: 'none', why: `The list of releases is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  if (!Semver.safeParse(o.current).success) return { action: 'none', why: `The running version "${o.current}" is not a version.` };
  const next = newestFor(o.channel, o.current, parsed.data.releases);
  if (!next) return { action: 'none', why: `Nothing newer than ${o.current} on the ${o.channel} channel.` };
  let smoke: SmokeResult;
  try {
    smoke = await o.smoke(next);
  } catch (err) {
    smoke = { ok: false, reasons: [`the smoke check could not run: ${(err as Error).message}`] };
  }
  return smoke.ok ? { action: 'upgrade', release: next } : { action: 'blocked', release: next, reasons: smoke.reasons.length ? smoke.reasons : ['the smoke check failed'] };
}
