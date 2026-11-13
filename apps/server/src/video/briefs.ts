import { checkClaims } from '../actions/policy';

/**
 * Video briefs (SPEC 8). A brief is a script and a shot list that a person approves before anything is generated, because
 * generation costs credits. Credits are counted here, from the shot list, never taken from the agent that wrote it.
 */
export const SHOT_KINDS = ['text', 'image', 'clip'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

/** What each kind of shot costs to make. A text card is drawn by the assembly code and costs nothing. */
export const CREDITS: Record<ShotKind, number> = { text: 0, image: 1, clip: 5 };

export interface Shot {
  kind: ShotKind;
  description: string;
  seconds: number;
}

export const MAX_SHOTS = 20;
export const MAX_SECONDS_PER_SHOT = 30;
export const MAX_TOTAL_SECONDS = 180;

export const estimateCredits = (shots: Shot[]) => shots.reduce((sum, s) => sum + CREDITS[s.kind], 0);
export const totalSeconds = (shots: Shot[]) => shots.reduce((sum, s) => sum + s.seconds, 0);

/** The brief's own rules: the length, and the same blocked claims and unlisted prices as any text that will be seen. */
export function checkBrief(b: { script: string; shots: Shot[] }, companyMd: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (totalSeconds(b.shots) > MAX_TOTAL_SECONDS) reasons.push(`the video would run ${totalSeconds(b.shots)} seconds, over the limit of 3 minutes`);
  reasons.push(...checkClaims([b.script, ...b.shots.map((s) => s.description)].join('\n'), companyMd).reasons);
  return { ok: reasons.length === 0, reasons };
}

export const assetKey = (briefId: string, shot: number, ext: string) => `assets/${briefId}/shot-${shot}.${ext}`;
export const extFor = (mime: string) => (mime.startsWith('video/') ? 'mp4' : mime === 'image/jpeg' ? 'jpg' : 'png');
