/**
 * Which company this browser is working in (S6-13a). Kept in the browser only; every request names it in a header, and the server
 * checks it. None means the company the server was started for.
 */
import { worldQuery } from './world';

const KEY = 'conclave.company';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function currentCompany(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && ID.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function setCurrentCompany(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved: the next page load is in the default company.
  }
}

/** The address of the live socket for the current company. A browser cannot add a header to a socket, so it goes in the address. */
export function eventsUrl(api: string): string {
  const c = currentCompany();
  const q = [c ? `company=${c}` : '', worldQuery()].filter(Boolean).join('&');
  return `${api.replace(/^http/, 'ws')}/events${q ? `?${q}` : ''}`;
}
