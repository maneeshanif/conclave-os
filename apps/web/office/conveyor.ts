/**
 * The conveyor (jsm-hq's pull request belt): every open pull request is a parcel riding a belt towards the review board. Pure, so a test can
 * check where the parcels are at any moment. It is only a picture of what the Pull requests panel lists.
 */
export const MAX_PARCELS = 6;
/** How fast a parcel rides, in tiles a second. */
export const BELT_SPEED = 0.6;

/** Where each parcel is along a belt that is `length` tiles long (0 is the far end, `length` the board), at `timeMs`. */
export function parcelPositions(open: number, timeMs: number, length: number): number[] {
  const n = Math.max(0, Math.min(MAX_PARCELS, Math.floor(open)));
  if (n === 0 || length <= 0) return [];
  const gap = length / n; // evenly spaced, so they never sit on top of each other
  const shift = ((timeMs / 1000) * BELT_SPEED) % length;
  return Array.from({ length: n }, (_, i) => (i * gap + shift) % length);
}

/** How many parcels the belt shows for a count of open pull requests (a long queue shows as a full belt, not a crowd). */
export function shownParcels(open: number): number {
  return Math.max(0, Math.min(MAX_PARCELS, Math.floor(open)));
}
