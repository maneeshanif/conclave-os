// A tiny pixel canvas and PNG writer, for the pictures the scripts draw in code (no outside art, nothing to credit).
import { deflateSync, crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  const c = {
    w,
    h,
    px,
    /** A filled rectangle; alpha 0 to 255. */
    rect(x, y, rw, rh, colour, alpha = 255) {
      const [r, g, b] = typeof colour === 'string' ? hex(colour) : colour;
      for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++)
        for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) {
          const o = (j * w + i) * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = alpha;
        }
    },
    /** A one pixel outline of a rectangle. */
    frame(x, y, rw, rh, colour) {
      c.rect(x, y, rw, 1, colour);
      c.rect(x, y + rh - 1, rw, 1, colour);
      c.rect(x, y, 1, rh, colour);
      c.rect(x + rw - 1, y, 1, rh, colour);
    },
    /** A filled circle (radius in pixels). */
    disc(cx, cy, r, colour, alpha = 255) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.4) c.rect(cx + i, cy + j, 1, 1, colour, alpha);
    },
    /** A one pixel ring. */
    ring(cx, cy, r, colour) {
      for (let a = 0; a < 720; a++) {
        const t = (a / 720) * Math.PI * 2;
        c.rect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1, colour);
      }
    },
    png() {
      const raw = Buffer.alloc((w * 4 + 1) * h);
      for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0;
        px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
      }
      const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = 6;
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
    },
  };
  return c;
}
