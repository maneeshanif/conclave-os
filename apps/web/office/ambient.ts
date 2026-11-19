/** What moves in the world (S6B-4). Pure, so it is tested without a canvas; the scene turns each kind into an animation. */
export type Ambient = 'steam' | 'sway' | 'flicker' | 'ball';

const BY_PICTURE: Record<string, Ambient> = { coffee: 'steam', plant: 'sway', tree: 'sway', arcade: 'flicker', pingpong: 'ball' };

export function ambientFor(picture: string): Ambient | null {
  return Object.hasOwn(BY_PICTURE, picture) ? BY_PICTURE[picture]! : null;
}

/** Someone who asked their system for less motion gets none. */
export function reducedMotion(w: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  try {
    return !!w?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
