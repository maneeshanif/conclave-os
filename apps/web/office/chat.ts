/**
 * Talking to someone near you (S6-15c), without any drawing: who is close enough, and the lines said. Pure and tested; the page
 * only shows the result. Text only, to people within a few tiles.
 */
export const NEAR = 4;
export const FAR = 5;
const KEEP = 50;

export interface ChatLine {
  id: string;
  name: string;
  text: string;
  at: number;
  mine: boolean;
}

/** The people to talk with: anyone within NEAR tiles, and anyone already in the talk who is still within FAR (so it does not flicker at the edge). Nearest first. */
export function nearbyPeople(me: { x: number; y: number }, others: { id: string; position: { x: number; y: number } }[], was: string[]): string[] {
  const dist = (o: { position: { x: number; y: number } }) => Math.hypot(o.position.x - me.x, o.position.y - me.y);
  return others
    .filter((o) => dist(o) <= (was.includes(o.id) ? FAR : NEAR))
    .sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id))
    .map((o) => o.id);
}

/** Adds a chat message from the server (or your own, with `mine`) to the lines, keeping the last 50. Anything else leaves them as they were. */
export function addChat(lines: ChatLine[], msg: { kind: string; [key: string]: unknown }, mine = false): ChatLine[] {
  if (msg.kind !== 'chat') return lines;
  const { id, name, text, at } = msg;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof text !== 'string' || !text || typeof at !== 'number') return lines;
  return [...lines, { id, name, text, at, mine }].slice(-KEEP);
}
