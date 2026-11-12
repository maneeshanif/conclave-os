import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * S1-11: the approvals page on an Android Chrome profile (Pixel 7 sized, touch, mobile user agent), served by the real
 * production build of the web app. The API is stood in for with fixtures, so this needs no database and no server.
 * Run with: pnpm run e2e:mobile (it builds the web app first).
 */
const PORT = 3217;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = 'http://127.0.0.1:3100';
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

function chromePath(): string {
  const root = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
  for (const rev of ['chromium-1248']) {
    const p = path.join(root, rev, 'chrome-win64', 'chrome.exe');
    if (existsSync(p)) return p;
  }
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  throw new Error('No Chromium found. Set CHROME_PATH to a chrome executable.');
}

const email = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'email.send',
  status: 'pending',
  agent_id: null,
  agent_key: 'outreach-outreach-rep',
  task_id: null,
  payload: {
    leadId: 'l1',
    to: 'dana@a-very-long-clinic-name-example.test',
    subject: 'A homepage concept for Glow Aesthetic Clinic and Wellness Studio',
    body: 'Hi Dana, I looked at your booking page and it asks people to phone first, which many visitors will not do. '.repeat(4),
    step: 1,
  },
  edited_payload: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  result: null,
  created_at: '2026-11-12T10:00:00Z',
  lead: { id: 'l1', business_name: 'Glow Aesthetic Clinic and Wellness Studio', website: 'https://glow-aesthetic-clinic-and-wellness-studio.example.test/booking', email: 'dana@a-very-long-clinic-name-example.test', stage: 'new', notes: 'Booking page asks for a phone call first. Verified.' },
};

let server: ChildProcess;
let browser: Browser;
let page: Page;
const decisions: unknown[] = [];

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

beforeAll(async () => {
  server = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@conclave/web', 'exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(PORT)], { cwd: REPO, stdio: 'ignore', shell: process.platform === 'win32' });
  await waitFor(`${ORIGIN}/offline.html`);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  });
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' };
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (req.url().includes('/decide')) {
      decisions.push(JSON.parse(req.postData() ?? '{}'));
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ id: email.id, status: 'approved' }) });
    }
    if (req.url().includes('/api/approvals')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(decisions.length ? [] : [email]) });
    return route.fulfill({ status: 200, headers: cors, body: '[]' });
  });
  page = await context.newPage();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  stopServer();
});

describe('the approvals page on an Android phone (S1-11)', () => {
  it('fits the screen with nothing to scroll sideways, however long the names are', async () => {
    await page.goto(`${ORIGIN}/approvals`);
    await page.getByRole('button', { name: 'Approve' }).waitFor();
    const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(m.scroll).toBeLessThanOrEqual(m.inner);
  });

  it('keeps every control inside the screen and big enough to tap', async () => {
    for (const name of ['Approve', 'Reject']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box, name).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(412);
      expect(box!.height, `${name} tap target`).toBeGreaterThanOrEqual(36);
    }
    for (const label of ['Subject', 'Message']) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box!.x + box!.width, label).toBeLessThanOrEqual(412);
    }
  });

  it('can be installed: a manifest is linked and the shell worker takes over', async () => {
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = (await (await fetch(new URL(href!, ORIGIN))).json()) as { start_url: string; display: string };
    expect(manifest).toMatchObject({ start_url: '/approvals', display: 'standalone' });
    const active = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
    expect(active).toBe(`${ORIGIN}/sw.js`);
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#171717');
  });

  it('approves with a tap', async () => {
    await page.getByRole('button', { name: 'Approve' }).tap();
    await page.getByText('Nothing is waiting for you.').waitFor();
    expect(decisions).toEqual([{ approved: true }]);
  });

  it('still opens, on the offline page, when the laptop cannot be reached', async () => {
    await page.context().setOffline(true);
    await page.goto(`${ORIGIN}/approvals`).catch(() => undefined);
    await page.getByText('Cannot reach Conclave OS').waitFor({ timeout: 10_000 });
    await page.context().setOffline(false);
  });
});
