import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD, PanDrag, panned } from '../office/pan';

describe('dragging the world (pan)', () => {
  it('treats a press that barely moves as a click, so it still walks you there', () => {
    const d = new PanDrag();
    d.start(100, 100);
    expect(d.move(103, 102, 1)).toBeNull();
    expect(d.active).toBe(false);
    expect(d.end()).toBe(false);
  });

  it('becomes a drag past the threshold, moves the view the opposite way, and is not a click', () => {
    const d = new PanDrag();
    d.start(100, 100);
    // The first step takes in everything since the press: no jump.
    expect(d.move(100 + DRAG_THRESHOLD + 2, 100, 1)).toEqual({ dx: -(DRAG_THRESHOLD + 2), dy: 0 });
    expect(d.move(130, 120, 1)).toEqual({ dx: -(130 - (100 + DRAG_THRESHOLD + 2)), dy: -20 });
    expect(d.active).toBe(true);
    expect(d.end()).toBe(true);
    expect(d.active).toBe(false);
  });

  it('scales a step by the zoom, so the world follows the pointer at any zoom', () => {
    const d = new PanDrag();
    d.start(0, 0);
    expect(d.move(40, 0, 2)).toEqual({ dx: -20, dy: 0 });
  });

  it('does nothing without a press, and a second press starts fresh', () => {
    const d = new PanDrag();
    expect(d.move(5, 5, 1)).toBeNull();
    expect(d.end()).toBe(false);
    d.start(0, 0);
    d.move(50, 0, 1);
    d.end();
    d.start(10, 10);
    expect(d.move(12, 10, 1)).toBeNull();
  });

  it('keeps the centre of the view inside the map', () => {
    expect(panned({ x: 100, y: 100 }, { dx: -500, dy: 20 }, { w: 640, h: 480 })).toEqual({ x: 0, y: 120 });
    expect(panned({ x: 600, y: 400 }, { dx: 300, dy: 300 }, { w: 640, h: 480 })).toEqual({ x: 640, y: 480 });
  });
});
