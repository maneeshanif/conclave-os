/**
 * Your name and look in the office (S6-15b). Kept in this browser only; the server is told with each move so others see it.
 * Pure over a storage object, so it is tested without a page. A blocked or broken storage gives the defaults.
 */
export interface Profile {
  name: string;
  /** 0 to 5, the six looks the sprite sheet has. */
  look: number;
}
const KEY = 'conclave.office.profile';

/** Short, one line, no markup brackets or control characters. */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const n = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return n || 'Guest';
}
const goodLook = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5;

export function readProfile(store: Pick<Storage, 'getItem'> | null): Profile {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null') as { name?: unknown; look?: unknown } | null;
    return { name: typeof v?.name === 'string' ? cleanName(v.name) : 'Guest', look: goodLook(v?.look) ? v.look : 0 };
  } catch {
    return { name: 'Guest', look: 0 };
  }
}

export function writeProfile(store: Pick<Storage, 'setItem'> | null, p: Profile): void {
  try {
    store?.setItem(KEY, JSON.stringify({ name: cleanName(p.name), look: goodLook(p.look) ? p.look : 0 }));
  } catch {
    // Not saved: it resets next visit.
  }
}
