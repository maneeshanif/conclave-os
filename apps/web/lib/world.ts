/**
 * Which world this browser is in (S6-17): the headquarters (the company office) or one of the extra maps. Kept in the browser only.
 * The office requests and the live socket name it in their address; the server checks it, and a name that is not a plain key is the
 * headquarters.
 */
export const HQ = 'hq';
const KEY = 'conclave.world';
const PLAIN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export interface WorldInfo {
  key: string;
  name: string;
  blurb: string;
}

export function currentWorld(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && PLAIN.test(v) ? v : HQ;
  } catch {
    return HQ;
  }
}

export function setCurrentWorld(key: string): void {
  try {
    if (key && key !== HQ && PLAIN.test(key)) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved: the next page load is in the headquarters.
  }
}

/** "world=campus", or nothing at the headquarters. */
export function worldQuery(): string {
  const w = currentWorld();
  return w === HQ ? '' : `world=${w}`;
}
