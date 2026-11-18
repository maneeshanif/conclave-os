import { DECOR_FOOTPRINT } from '@conclave/shared';

/** What a click on the world does while editing (S6B-9). Pure. */
export type EditTool = { kind: 'place'; name: string; turn: number } | { kind: 'remove' } | { kind: 'move'; id: number | null } | { kind: 'door' };
export type TileAction = { kind: 'place'; name: string; x: number; y: number; turn?: number } | { kind: 'remove'; id: number } | { kind: 'pick'; id: number } | { kind: 'move'; id: number; x: number; y: number } | { kind: 'door'; x: number; y: number } | { kind: 'nothing'; why: string };

export function tileAction(tool: EditTool | null, tile: { x: number; y: number }, decor: { id: number; x: number; y: number; w: number; h: number }[]): TileAction | null {
  if (!tool) return null; // not editing: the click is for walking
  // A door works on a wall or a gap, not on a piece of scenery: the server says whether it opened or closed.
  if (tool.kind === 'door') return { kind: 'door', x: tile.x, y: tile.y };
  if (tool.kind === 'place') return { kind: 'place', name: tool.name, x: tile.x, y: tile.y, ...(tool.turn ? { turn: tool.turn } : {}) };
  if (tool.kind === 'move' && tool.id !== null) return { kind: 'move', id: tool.id, x: tile.x, y: tile.y };
  // The topmost piece under the tile: the last one drawn.
  const hit = [...decor].reverse().find((d) => tile.x >= d.x && tile.x < d.x + d.w && tile.y >= d.y && tile.y < d.y + d.h);
  if (tool.kind === 'move') return hit ? { kind: 'pick', id: hit.id } : { kind: 'nothing', why: 'Click the piece to move.' };
  return hit ? { kind: 'remove', id: hit.id } : { kind: 'nothing', why: 'Click a piece of scenery to remove it.' };
}

export const PICTURES = Object.entries(DECOR_FOOTPRINT).map(([name, [w, h]]) => ({ name, w, h }));
