/** How wide the side panel is, and keeping what you chose (S6-14b4). */
export const DEFAULT_PANEL_WIDTH = 672;
const KEY = 'conclave.panelWidth';
const MIN = 360;
const MAX = 1152;

/** A whole number of pixels between a usable least and most of the screen (at most 92% of it). */
export function clampPanelWidth(px: number, viewport: number): number {
  return Math.floor(Math.max(MIN, Math.min(px, MAX, viewport * 0.92)));
}

export function loadPanelWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= MIN && v <= MAX ? Math.floor(v) : null;
  } catch {
    return null;
  }
}

export function savePanelWidth(px: number): void {
  try {
    localStorage.setItem(KEY, String(px));
  } catch {
    // Not saved: the next visit starts at the usual width.
  }
}
