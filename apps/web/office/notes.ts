/** The plan wall (S6B-10): the task board shows tasks as sticky notes, as jsm-hq's plan wall does. Pure, so it is tested with no canvas. */
export const NOTE_LIMIT = 12;

const COLOUR: Record<string, string> = { blocked: '#ef4444', in_progress: '#60a5fa', todo: '#fde047', done: '#4ade80' };
// Blocked first (it needs you), then what is moving, then what waits, then what is finished.
const ORDER = ['blocked', 'in_progress', 'todo', 'done'];

export interface Note {
  id: string;
  colour: string;
}

export function notesFor(tasks: { id: string; status: string; created_at: string }[]): Note[] {
  const shown = tasks.filter((t) => Object.hasOwn(COLOUR, t.status));
  shown.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return shown.slice(0, NOTE_LIMIT).map((t) => ({ id: t.id, colour: COLOUR[t.status]! }));
}

/** Where each of n notes goes inside a board of the given size in pixels: a grid, row by row, with a little space round each. */
export function noteSpots(n: number, boardW: number, boardH: number): { x: number; y: number; w: number; h: number }[] {
  const cols = 6;
  const rows = Math.ceil(NOTE_LIMIT / cols);
  const w = Math.floor((boardW - 8) / cols) - 1;
  const h = Math.floor((boardH - 6) / rows) - 1;
  return Array.from({ length: n }, (_, i) => ({ x: 4 + (i % cols) * (w + 1), y: 3 + Math.floor(i / cols) * (h + 1), w, h }));
}
