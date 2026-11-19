import { describe, expect, it } from 'vitest';
import { BELT_SPEED, MAX_PARCELS, parcelPositions, shownParcels } from '../office/conveyor';

describe('the conveyor', () => {
  it('has one parcel for each open pull request, up to a full belt', () => {
    expect(parcelPositions(0, 0, 4)).toEqual([]);
    expect(parcelPositions(1, 0, 4)).toHaveLength(1);
    expect(parcelPositions(3, 0, 4)).toHaveLength(3);
    expect(parcelPositions(50, 0, 4)).toHaveLength(MAX_PARCELS);
    expect(shownParcels(50)).toBe(MAX_PARCELS);
    expect(shownParcels(-2)).toBe(0);
    expect(shownParcels(2.9)).toBe(2);
  });

  it('keeps every parcel on the belt, evenly spaced, and moving towards the board over time', () => {
    for (const t of [0, 700, 5000, 123456]) {
      const p = parcelPositions(4, t, 4);
      for (const x of p) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(4);
      }
      const sorted = [...p].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(1, 6);
    }
    const a = parcelPositions(1, 0, 10)[0]!;
    const b = parcelPositions(1, 1000, 10)[0]!;
    expect(b - a).toBeCloseTo(BELT_SPEED, 6);
  });

  it('shows nothing for a belt of no length', () => {
    expect(parcelPositions(3, 1000, 0)).toEqual([]);
  });
});
