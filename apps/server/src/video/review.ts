import { checkClaims } from '../actions/policy';
import type { Plan } from './assemble';
import { MAX_TOTAL_SECONDS, type Shot } from './briefs';

/**
 * The review check (SPEC 8: "a reviewer checks the render against the brief and the brand rules"), as rules in code, run before
 * the approval card is offered. It lists every problem it finds at once, so the brief can be fixed in one go.
 */
export function reviewPlan(plan: Plan, brief: { shots: Shot[]; script: string }, companyMd: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const wanted = brief.shots.reduce((s, x) => s + x.seconds, 0);
  if (plan.durationSeconds !== wanted) reasons.push(`the plan length (${plan.durationSeconds} seconds) is not the brief's (${wanted} seconds)`);
  if (plan.durationSeconds > MAX_TOTAL_SECONDS) reasons.push(`the video runs ${plan.durationSeconds} seconds, over the limit of 3 minutes`);
  for (const s of plan.scenes) if (s.kind !== 'text' && !s.assetKey) reasons.push(`shot ${s.shot} (${s.kind}) has no asset`);
  if (plan.captions.length === 0) reasons.push('there are no captions');
  if (plan.captions.some((c) => c.end > plan.durationSeconds || c.start < 0 || c.end < c.start)) reasons.push('the captions run past the end of the video');
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(plan.brand.primary) || !hex.test(plan.brand.text)) reasons.push('the brand colours are missing or not #RRGGBB colours (set them under "## Brand" in COMPANY.md)');
  if (!plan.brand.logo.trim()) reasons.push('the logo is missing (set it under "## Brand" in COMPANY.md)');
  const spoken = [...plan.captions.map((c) => c.text), ...plan.scenes.flatMap((s) => (s.text ? [s.text] : []))].join('\n');
  reasons.push(...checkClaims(spoken, companyMd).reasons);
  return { ok: reasons.length === 0, reasons };
}
