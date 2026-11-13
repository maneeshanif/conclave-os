import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { availabilityColour, directionOf, frameIndex, lookFor, placeColour, pose, roomTint } from '../office/art';

const dir = path.resolve(import.meta.dirname, '..', 'public', 'office');

/** A minimal decoder for the PNGs our own script writes (RGBA, no filtering). */
function decode(file: string) {
  const b = readFileSync(path.join(dir, file));
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  expect(b[25]).toBe(6);
  let idat = Buffer.alloc(0);
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    const type = b.subarray(o + 4, o + 8).toString();
    if (type === 'IDAT') idat = Buffer.concat([idat, b.subarray(o + 8, o + 8 + len)]);
    o += 12 + len;
  }
  const raw = inflateSync(idat);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(0);
    raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  }
  return { w, h, px };
}
const cellHasArt = (img: { w: number; px: Buffer }, x: number, y: number) => {
  for (let j = y; j < y + 32; j++) for (let i = x; i < x + 32; i++) if (img.px[(j * img.w + i) * 4 + 3]! > 0) return true;
  return false;
};

describe('the art we draw (S6-8c3)', () => {
  it('has a people sheet of six looks by three frames by four directions, with something drawn in every frame', () => {
    const img = decode('people.png');
    expect([img.w, img.h]).toEqual([32 * 18, 32 * 4]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 18; c++) expect(cellHasArt(img, c * 32, r * 32), `row ${r} col ${c}`).toBe(true);
  });

  it('has a furniture strip of five pieces, each drawn', () => {
    const img = decode('furniture.png');
    expect([img.w, img.h]).toEqual([32 * 5, 32]);
    for (let c = 0; c < 5; c++) expect(cellHasArt(img, c * 32, 0), `piece ${c}`).toBe(true);
  });

  it('keeps a licence file that names every art file and where it came from', () => {
    const notes = readFileSync(path.join(dir, 'ART.md'), 'utf8');
    const files = readdirSync(dir).filter((f) => f !== 'ART.md');
    expect(files.sort()).toEqual(['furniture.png', 'people.png', 'tiles.png']);
    for (const f of files) expect(notes, f).toContain(f);
    expect(notes).toMatch(/drawn here/i);
    expect(notes).toMatch(/no third-party/i);
  });
});

describe('picking the picture (S6-8c3)', () => {
  it('gives you look 0 and each agent a look from 1 to 5 that never changes', () => {
    expect(lookFor(null)).toBe(0);
    const a = lookFor('prospector');
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(5);
    expect(lookFor('prospector')).toBe(a);
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'scout', 'closer'].map(lookFor));
    expect(spread.size).toBeGreaterThan(2);
  });

  it('faces the way it is moving, mostly along the longer axis, and keeps its facing when still', () => {
    expect(directionOf(0, 1, 'up')).toBe('down');
    expect(directionOf(0, -1, 'down')).toBe('up');
    expect(directionOf(-1, 0, 'down')).toBe('left');
    expect(directionOf(1, 0.2, 'down')).toBe('right');
    expect(directionOf(0.1, -2, 'left')).toBe('up');
    expect(directionOf(0, 0, 'left')).toBe('left');
  });

  it('stands still on frame 0 and alternates the two walking frames as it travels', () => {
    expect(pose(false, 0)).toBe(0);
    const seen = new Set([0, 0.26, 0.51, 0.76, 1.01].map((d) => pose(true, d)));
    expect([...seen].sort()).toEqual([1, 2]);
  });

  it('finds the frame in the sheet: row by direction, six looks of three frames across', () => {
    expect(frameIndex(0, 'down', 0)).toBe(0);
    expect(frameIndex(2, 'down', 1)).toBe(2 * 3 + 1);
    expect(frameIndex(0, 'left', 0)).toBe(18);
    expect(frameIndex(5, 'up', 2)).toBe(18 * 3 + 5 * 3 + 2);
  });

  it('colours the status dot from where the agent is, and from your availability', () => {
    expect(new Set(['desk', 'approvals', 'boardroom', 'lounge'].map(placeColour)).size).toBe(4);
    expect(new Set((['available', 'busy', 'away'] as const).map(availabilityColour)).size).toBe(3);
    expect(placeColour('somewhere new')).toMatch(/^#/);
  });

  it('tints rooms by what they are: locked, quiet, the Boardroom, the lounge; plain halls stay clear', () => {
    const room = { name: 'R', kind: 'department', department: null, x: 0, y: 0, w: 2, h: 2, maxUsers: null, locked: false, silent: false, focusable: false } as const;
    expect(roomTint({ ...room, locked: true })).not.toEqual(roomTint({ ...room, silent: true }));
    expect(roomTint({ ...room, kind: 'boardroom' })).not.toBeNull();
    expect(roomTint({ ...room, kind: 'lounge' })).not.toBeNull();
    expect(roomTint({ ...room, kind: 'hall' })).toBeNull();
    expect(roomTint(room)!.alpha).toBeLessThan(0.4);
  });
});
