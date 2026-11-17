/** How an agent looks from its state (S6B-3, S6B-4): a small mood over its head, a typing bob, a blink. Pure, so it is tested with no canvas. */
const MOOD: Record<string, string> = { working: '⌨️', waiting: '⏳', blocked: '⛔', discussion: '💬', handoff: '📨', idle: '💤' };

export function moodFor(state: string | undefined): string | null {
  return state && Object.hasOwn(MOOD, state) ? MOOD[state]! : null;
}

/** A quick one pixel bob while the agent is working, as if typing. */
export function typingBob(state: string | undefined, timeMs: number): number {
  if (state !== 'working') return 0;
  return Math.floor(timeMs / 110) % 2 === 0 ? 0 : -1;
}

/** True for a moment in each four second cycle; `offset` keeps agents from all blinking together. */
export function blinking(timeMs: number, offset: number): boolean {
  return (timeMs + offset) % 4000 < 120;
}

/** Something new needs you when the count rises. The first count seen is not news. */
export function needsYouRose(before: number | null, now: number): boolean {
  return before !== null && now > before;
}
