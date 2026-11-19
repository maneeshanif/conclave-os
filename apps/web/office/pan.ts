/**
 * Dragging the world to look around (jsm-hq's pan). Pure: it only decides whether a pointer press became a drag, and by how much to move
 * the view. A press that moves less than a few pixels is a click (and walks you there); a press that moves further is a drag and does not
 * walk you anywhere. The view comes back to you the next time you walk.
 */
export const DRAG_THRESHOLD = 8;

export class PanDrag {
  private down: { x: number; y: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private dragging = false;

  start(x: number, y: number): void {
    this.down = { x, y };
    this.last = { x, y };
    this.dragging = false;
  }

  /** The step to move the view by, in screen pixels (the opposite way the pointer went), or null if this is not a drag (yet). */
  move(x: number, y: number, zoom: number): { dx: number; dy: number } | null {
    if (!this.down || !this.last) return null;
    if (!this.dragging) {
      if (Math.hypot(x - this.down.x, y - this.down.y) < DRAG_THRESHOLD) return null;
      this.dragging = true; // the first step takes in everything since the press, so the world does not jump
      this.last = { ...this.down };
    }
    const step = { dx: -(x - this.last.x) / zoom + 0, dy: -(y - this.last.y) / zoom + 0 }; // + 0 turns -0 into 0
    this.last = { x, y };
    return step;
  }

  /** Ends the press. True if it was a drag, so the caller does not also treat it as a click. */
  end(): boolean {
    const was = this.dragging;
    this.down = null;
    this.last = null;
    this.dragging = false;
    return was;
  }

  get active(): boolean {
    return this.dragging;
  }
}

/** Where the view's centre goes after a drag step, kept inside the map so you cannot lose it. */
export function panned(c: { x: number; y: number }, step: { dx: number; dy: number }, mapPx: { w: number; h: number }): { x: number; y: number } {
  return { x: Math.min(mapPx.w, Math.max(0, c.x + step.dx)), y: Math.min(mapPx.h, Math.max(0, c.y + step.dy)) };
}
