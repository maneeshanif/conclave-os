import { DECOR_FOOTPRINT } from '@conclave/shared';

/** What a click on the world does while editing (S6B-9). Pure. */
export type EditTool = { kind: 'place'; name: string; turn: number } | { kind: 'remove' };
export type TileAction = { kind: 'place'; name: string; x: number; y: number; turn?: number } | { kind: 'remove'; id: number } | { kind: 'nothing'; why: string };

export function tileAction(tool: EditTool | null, tile: { x: number; y: number }, decor: { id: number; x: number; y: number; w: number; h: number }[]): TileAction | null {
  if (!tool) return null; // not editing: the click is for walking
  if (tool.kind === 'place') return { kind: 'place', name: tool.name, x: tile.x, y: tile.y, ...(tool.turn ? { turn: tool.turn } : {}) };
  // The topmost piece under the tile: the last one drawn.
  const hit = [...decor].reverse().find((d) => tile.x >= d.x && tile.x < d.x + d.w && tile.y >= d.y && tile.y < d.y + d.h);
  return hit ? { kind: 'remove', id: hit.id } : { kind: 'nothing', why: 'Click a piece of scenery to remove it.' };
}

export const PICTURES = Object.entries(DECOR_FOOTPRINT).map(([name, [w, h]]) => ({ name, w, h }));
