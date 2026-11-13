import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readOfficeMap, type OfficeMapJson } from '@conclave/shared';

/**
 * S6-8b: the real /office page, served by the production build of the web app, in a desktop browser and on an Android Chrome
 * profile. The API is stood in for with fixtures built from the real map file, so this needs no database and no server.
 * It finds a canvas that is not blank, finds the plain list under it, and saves a screenshot of each.
 * Run with: pnpm run e2e:mobile (it builds the web app first).
 */
const PORT = 3218;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = 'http://127.0.0.1:3100';
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SHOTS = path.join(REPO, 'e2e-output');

function chromePath(): string {
  const root = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
  const p = path.join(root, 'chromium-1248', 'chrome-win64', 'chrome.exe');
  if (existsSync(p)) return p;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  throw new Error('No Chromium found. Set CHROME_PATH to a chrome executable.');
}

const tmj = readFileSync(path.join(REPO, 'company', 'office.tmj'), 'utf8');
const departments = readFileSync(path.join(REPO, 'company', 'departments.yaml'), 'utf8')
  .split(/\r?\n/)
  .flatMap((l) => {
    const m = /\{\s*key:\s*([a-z0-9-]+),.*active:\s*(true|false)/.exec(l);
    return m ? [{ key: m[1]!, active: m[2] === 'true' }] : [];
  });
const map = readOfficeMap(JSON.parse(tmj) as OfficeMapJson, { file: 'office.tmj', departments });
const { walls, ...rest } = map;
const desk = map.desks[0]!;
const lounge = map.rooms.find((r) => r.kind === 'lounge')!;
const facts = {
  map: { ...rest, walls: walls.map((row) => row.map((w) => (w ? '#' : '.')).join('')) },
  agents: [
    { id: '11111111-1111-4111-8111-111111111111', key: 'scout', name: 'Scout', department: desk.room, status: 'active', room: desk.room, desk: desk.slot },
    { id: '22222222-2222-4222-8222-222222222222', key: 'closer', name: 'Closer', department: null, status: 'active', room: null, desk: null },
  ],
};
const places = {
  places: [
    { agentId: facts.agents[0]!.id, key: 'scout', place: 'desk', reason: 'Working on a task.', x: desk.x, y: desk.y },
    { agentId: facts.agents[1]!.id, key: 'closer', place: 'lounge', reason: 'Idle.', x: lounge.x + 1, y: lounge.y + 1 },
  ],
};

let server: ChildProcess;
let browser: Browser;

/** pnpm starts next through a shell, so stopping the shell is not enough: also stop whatever still listens on the port. */
function stopServer() {
  if (server?.pid) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of out.split('\n')) {
    if (line.includes(`127.0.0.1:${PORT} `) && line.includes('LISTENING')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid) spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    }
  }
}

async function waitFor(url: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

async function stub(context: BrowserContext) {
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' } });
    const url = new URL(req.url());
    if (url.pathname === '/api/office') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(facts) });
    if (url.pathname === '/api/office/state') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(places) });
    if (url.pathname === '/api/office/map') return route.fulfill({ status: 200, headers: cors, body: tmj });
    if (url.pathname.startsWith('/api/office/agents/')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ agent: { ...facts.agents[0], id: facts.agents[0]!.id }, run: { id: 'r1', status: 'running' }, tasks: [{ id: 't1', title: 'Find leads', status: 'todo' }] }) });
    return route.fulfill({ status: 200, headers: cors, body: '[]' });
  });
}

/** How many different colours a canvas shows. A blank canvas shows one. Read by loading a screenshot of it back into a 2D canvas. */
async function colours(page: import('playwright-core').Page): Promise<number> {
  const png = await page.locator('[data-testid="office-world"] canvas').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 16) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  }, png.toString('base64'));
}

beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@conclave/web', 'exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(PORT)], { cwd: REPO, stdio: 'ignore', shell: process.platform === 'win32' });
  await waitFor(`${ORIGIN}/offline.html`);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 240_000);

afterAll(async () => {
  await browser?.close();
  stopServer();
});

const profiles = {
  desktop: { viewport: { width: 1280, height: 800 } },
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
} as const;

describe('the office page in a real browser (S6-8b)', () => {
  for (const [name, profile] of Object.entries(profiles)) {
    it(`${name}: draws a canvas that is not blank, and lists the rooms and agents under it`, async () => {
      const context = await browser.newContext(profile);
      await stub(context);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${ORIGIN}/office`);
      await page.locator('[data-testid="office-world"] canvas').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500); // a few frames
      // The welcome card shows the first time, and skipping it leaves the bar.
      await page.getByRole('dialog', { name: /welcome/i }).waitFor();
      writeFileSync(path.join(SHOTS, `office-${name}-welcome.png`), await page.screenshot());
      await page.getByRole('button', { name: /skip tutorial/i }).click();
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await colours(page)).toBeGreaterThan(3);
      const people = page.getByRole('button', { name: /people, 2 here/i });
      await people.waitFor();
      const world = await page.locator('[data-testid="office-world"]').boundingBox();
      const at = (await people.boundingBox())!;
      // On a phone the bar sits along the bottom of the map; on a desktop along the top.
      if (name === 'android') expect(at.y).toBeGreaterThan(world!.y + world!.height / 2);
      else expect(at.y).toBeLessThan(world!.y + world!.height / 2);
      await people.click();
      await page.getByRole('region', { name: 'People' }).getByText('Scout').waitFor();
      await page.getByRole('button', { name: /close people/i }).click();
      await page.getByRole('button', { name: /your status/i }).click();
      await page.getByRole('menuitemradio', { name: 'Busy' }).click();
      await page.getByRole('button', { name: /your status/i }).click();
      expect(await page.getByRole('menuitemradio', { name: 'Busy' }).getAttribute('aria-checked')).toBe('true');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /your status/i }).click();
      writeFileSync(path.join(SHOTS, `office-${name}-bar.png`), await page.screenshot());
      // The plain list is there too.
      await page.getByRole('heading', { name: lounge.name }).waitFor();
      await page.getByRole('button', { name: /Scout/ }).waitFor();
      // No sideways scroll on a phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      writeFileSync(path.join(SHOTS, `office-${name}.png`), await page.screenshot({ fullPage: true }));
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});
