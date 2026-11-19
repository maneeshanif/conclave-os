// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanelHost } from '../components/PanelHost';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, loadPanelWidth, savePanelWidth } from '../lib/panel-width';

// jsdom has no PointerEvent; a mouse event carries the coordinates the drag needs.
const win = window as unknown as { PointerEvent?: unknown; MouseEvent: unknown };
if (!win.PointerEvent) win.PointerEvent = win.MouseEvent;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // not available
  }
});
afterEach(cleanup);

describe('how wide the panel may be (S6-14b4)', () => {
  it('keeps a width between a usable least and most of the screen', () => {
    expect(clampPanelWidth(10, 1440)).toBe(360);
    expect(clampPanelWidth(5000, 1440)).toBe(1152); // never more than this, however big the screen
    expect(clampPanelWidth(5000, 1000)).toBe(920); // and never more than 92% of a smaller one
    expect(clampPanelWidth(700, 1440)).toBe(700);
    expect(clampPanelWidth(500.7, 1440)).toBe(500);
  });

  it('remembers a width in the browser, and ignores anything that is not a sensible number', () => {
    expect(loadPanelWidth()).toBeNull();
    savePanelWidth(640);
    expect(loadPanelWidth()).toBe(640);
    for (const bad of ['abc', '-5', '99999', '12', '']) {
      localStorage.setItem('conclave.panelWidth', bad);
      expect(loadPanelWidth(), bad).toBeNull();
    }
    expect(DEFAULT_PANEL_WIDTH).toBeGreaterThan(360);
  });
});

describe('dragging the edge of the panel (S6-14b4)', () => {
  const open = () => render(<PanelHost state={{ id: 'goals' }} onClose={() => undefined} render={() => <p>inside</p>} />);
  const width = () => parseInt(/--panel-w:\s*(\d+)px/.exec(screen.getByRole('dialog').getAttribute('style') ?? '')?.[1] ?? '0', 10);

  it('has a handle on the left edge, for wider screens only', () => {
    open();
    const h = screen.getByRole('separator', { name: /resize panel/i });
    expect(h.className).toMatch(/hidden/);
    expect(h.className).toMatch(/sm:block/);
    expect(width()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('makes the panel wider when dragged left, narrower when dragged right, within the limits', () => {
    open();
    const h = screen.getByRole('separator', { name: /resize panel/i });
    fireEvent.pointerDown(h, { clientX: 800, pointerId: 1, button: 0 });
    fireEvent.pointerMove(h, { clientX: 700, pointerId: 1 });
    expect(width()).toBe(DEFAULT_PANEL_WIDTH + 100);
    fireEvent.pointerMove(h, { clientX: 900, pointerId: 1 });
    expect(width()).toBe(DEFAULT_PANEL_WIDTH - 100);
    fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
    expect(width()).toBe(360);
    fireEvent.pointerMove(h, { clientX: -5000, pointerId: 1 });
    expect(width()).toBeLessThanOrEqual(Math.floor(window.innerWidth * 0.92));
    fireEvent.pointerUp(h, { pointerId: 1 });
  });

  it('stops following the pointer once it is let go', () => {
    open();
    const h = screen.getByRole('separator', { name: /resize panel/i });
    fireEvent.pointerDown(h, { clientX: 800, pointerId: 1, button: 0 });
    fireEvent.pointerMove(h, { clientX: 750, pointerId: 1 });
    fireEvent.pointerUp(h, { pointerId: 1 });
    const w = width();
    fireEvent.pointerMove(h, { clientX: 400, pointerId: 1 });
    expect(width()).toBe(w);
  });

  it('goes back to the usual width on a double click', () => {
    open();
    const h = screen.getByRole('separator', { name: /resize panel/i });
    fireEvent.pointerDown(h, { clientX: 800, pointerId: 1, button: 0 });
    fireEvent.pointerMove(h, { clientX: 650, pointerId: 1 });
    fireEvent.pointerUp(h, { pointerId: 1 });
    expect(width()).not.toBe(DEFAULT_PANEL_WIDTH);
    fireEvent.doubleClick(h);
    expect(width()).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('keeps the chosen width for next time', () => {
    const first = open();
    const h = screen.getByRole('separator', { name: /resize panel/i });
    fireEvent.pointerDown(h, { clientX: 800, pointerId: 1, button: 0 });
    fireEvent.pointerMove(h, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(h, { pointerId: 1 });
    first.unmount();
    open();
    expect(width()).toBe(DEFAULT_PANEL_WIDTH + 100);
  });

  it('can still be maximised and restored', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /maximi[sz]e/i }));
    expect(width()).toBeGreaterThan(DEFAULT_PANEL_WIDTH);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    expect(width()).toBe(DEFAULT_PANEL_WIDTH);
  });
});
