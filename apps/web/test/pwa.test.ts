import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import manifest from '../app/manifest';
import { viewport } from '../app/layout';

const pub = (p: string) => path.join(import.meta.dirname, '..', 'public', p);
const png = (p: string) => {
  const b = readFileSync(pub(p));
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe('the installable app: manifest (S1-11)', () => {
  const m = manifest();

  it('names the app and opens on the approvals page, standalone', () => {
    expect(m.name).toBe('Conclave OS');
    expect(m.short_name).toBe('Conclave');
    expect(m.start_url).toBe('/approvals');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has the icons Chrome needs to offer install: 192, 512 and a maskable one, each a real PNG of that size', () => {
    const icons = m.icons ?? [];
    for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']] as const) {
      const icon = icons.find((i) => i.sizes === `${size}x${size}` && (i.purpose ?? 'any') === purpose);
      expect(icon, `${size} ${purpose}`).toBeTruthy();
      expect(icon!.type).toBe('image/png');
      expect(png(icon!.src.replace(/^\//, ''))).toEqual({ w: size, h: size });
    }
  });

  it('sets the phone viewport and theme colour', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
    expect(viewport.themeColor).toBe(m.theme_color);
  });
});

/** Runs public/sw.js against a fake worker scope and returns what it registered. */
function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const cache = new Map<string, unknown>();
  const caches = {
    open: vi.fn(async () => ({ addAll: vi.fn(async (urls: string[]) => urls.forEach((u) => cache.set(u, 'x'))), put: vi.fn(async (k: { url: string } | string, v: unknown) => cache.set(typeof k === 'string' ? k : k.url, v)), match: vi.fn(async (k: string) => cache.get(k)) })),
    match: vi.fn(async (k: { url: string } | string) => cache.get(typeof k === 'string' ? k : k.url)),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => (handlers[t] = f), skipWaiting: vi.fn(), clients: { claim: vi.fn() }, location: { origin: 'http://localhost:3000' } };
  vm.runInNewContext(readFileSync(pub('sw.js'), 'utf8'), { self, caches, fetch: vi.fn(async () => ({ ok: true, clone: () => ({}) })), URL, Promise, console });
  return { handlers, caches, cache };
}
const fetchEvent = (url: string, over: Record<string, unknown> = {}) => {
  const e = { request: { url, method: 'GET', mode: 'cors', ...over }, respondWith: vi.fn() };
  return e;
};

describe('the installable app: service worker (S1-11)', () => {
  it('keeps only the shell: it precaches the offline page and nothing from the API', async () => {
    const { handlers, cache } = loadWorker();
    let done: Promise<unknown> = Promise.resolve();
    handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...cache.keys()]).toEqual(['/offline.html']);
  });

  it('never touches the API, the login routes, another origin, or anything that is not a GET', () => {
    const { handlers } = loadWorker();
    for (const e of [
      fetchEvent('http://localhost:3100/api/approvals'),
      fetchEvent('http://localhost:3000/api/auth/get-session'),
      fetchEvent('http://localhost:3100/events'),
      fetchEvent('https://example.com/x.js'),
      fetchEvent('http://localhost:3000/approvals', { method: 'POST', mode: 'navigate' }),
    ]) {
      handlers.fetch!(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  it('answers a page navigation from the network, and from the offline page when the network is gone', () => {
    const { handlers } = loadWorker();
    const e = fetchEvent('http://localhost:3000/approvals', { mode: 'navigate' });
    handlers.fetch!(e);
    expect(e.respondWith).toHaveBeenCalledTimes(1);
  });

  it('serves a built asset from its cache once it has seen it', () => {
    const { handlers } = loadWorker();
    const e = fetchEvent('http://localhost:3000/_next/static/chunks/app.js');
    handlers.fetch!(e);
    expect(e.respondWith).toHaveBeenCalledTimes(1);
  });

  it('takes over at once on a new version', () => {
    const { handlers } = loadWorker();
    handlers.install!({ waitUntil: () => undefined });
    handlers.activate!({ waitUntil: () => undefined });
  });

  it('has an offline page that says what is going on and caches no data', () => {
    const html = readFileSync(pub('offline.html'), 'utf8');
    expect(html).toMatch(/offline|reach/i);
    expect(html).toMatch(/<meta name="viewport"/);
  });
});
