import { DECOR_FOOTPRINT } from '@conclave/shared';

/** What a click on the world does while editing (S6B-9). Pure. */
export type EditTool = { kind: 'place'; name: string; turn: number } | { kind: 'remove' } | { kind: 'move'; id: number | null } | { kind: 'door' } | { kind: 'grow'; side: 'north' | 'south' | 'east' | 'west'; shrink?: boolean };
export type TileAction = { kind: 'place'; name: string; x: number; y: number; turn?: number } | { kind: 'remove'; id: number } | { kind: 'pick'; id: number } | { kind: 'move'; id: number; x: number; y: number } | { kind: 'door'; x: number; y: number } | { kind: 'grow'; x: number; y: number; side: 'north' | 'south' | 'east' | 'west'; shrink?: boolean } | { kind: 'nothing'; why: string };

export function tileAction(tool: EditTool | null, tile: { x: number; y: number }, decor: { id: number; x: number; y: number; w: number; h: number }[]): TileAction | null {
  if (!tool) return null; // not editing: the click is for walking
  // A door works on a wall or a gap, not on a piece of scenery: the server says whether it opened or closed.
  if (tool.kind === 'grow') return { kind: 'grow', x: tile.x, y: tile.y, side: tool.side, ...(tool.shrink ? { shrink: true } : {}) };
  if (tool.kind === 'door') return { kind: 'door', x: tile.x, y: tile.y };
  if (tool.kind === 'place') return { kind: 'place', name: tool.name, x: tile.x, y: tile.y, ...(tool.turn ? { turn: tool.turn } : {}) };
  if (tool.kind === 'move' && tool.id !== null) return { kind: 'move', id: tool.id, x: tile.x, y: tile.y };
  // The topmost piece under the tile: the last one drawn.
  const hit = [...decor].reverse().find((d) => tile.x >= d.x && tile.x < d.x + d.w && tile.y >= d.y && tile.y < d.y + d.h);
  if (tool.kind === 'move') return hit ? { kind: 'pick', id: hit.id } : { kind: 'nothing', why: 'Click the piece to move.' };
  return hit ? { kind: 'remove', id: hit.id } : { kind: 'nothing', why: 'Click a piece of scenery to remove it.' };
}

type Piece = { id: number; x: number; y: number; w: number; h: number };
const pieceAt = (decor: Piece[], t: { x: number; y: number }) => [...decor].reverse().find((d) => t.x >= d.x && t.x < d.x + d.w && t.y >= d.y && t.y < d.y + d.h);

/** True if a press on this tile picks a piece up: only with the Move tool, and only on a piece. Then the press is a drag of the piece, not of the view. */
export function grabs(tool: EditTool | null, tile: { x: number; y: number }, decor: Piece[]): boolean {
  return tool?.kind === 'move' && !!pieceAt(decor, tile);
}

/**
 * Dropping a piece after dragging it (S6C-2): where it goes keeps the spot you held it by, so a wide piece does not jump under the pointer.
 * Null if it did not move or the Move tool is not in hand.
 */
export function dragAction(tool: EditTool | null, from: { x: number; y: number }, to: { x: number; y: number }, decor: Piece[]): { kind: 'move'; id: number; x: number; y: number } | null {
  if (tool?.kind !== 'move') return null;
  const piece = pieceAt(decor, from);
  if (!piece || (from.x === to.x && from.y === to.y)) return null;
  return { kind: 'move', id: piece.id, x: piece.x + (to.x - from.x), y: piece.y + (to.y - from.y) };
}

export const PICTURES = Object.entries(DECOR_FOOTPRINT).map(([name, [w, h]]) => ({ name, w, h }));
