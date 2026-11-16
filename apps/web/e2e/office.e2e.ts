import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
const door = map.entries.find((e) => e.name === 'door') ?? map.entries[0]!;
const facts = {
  map: { ...rest, walls: walls.map((row) => row.map((w) => (w ? '#' : '.')).join('')) },
  agents: [
    { id: '11111111-1111-4111-8111-111111111111', key: 'scout', name: 'Scout', department: desk.room, status: 'active', room: desk.room, desk: desk.slot },
    { id: '22222222-2222-4222-8222-222222222222', key: 'closer', name: 'Closer', department: null, status: 'active', room: null, desk: null },
  ],
};
const places = {
  places: [
    { agentId: facts.agents[0]!.id, key: 'scout', place: 'desk', reason: 'Working on a task.', x: door.x + 2, y: door.y },
    { agentId: facts.agents[1]!.id, key: 'closer', place: 'lounge', reason: 'Idle.', x: lounge.x + 1, y: lounge.y + 1 },
  ],
};

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let made = false;
const officeCompany: (string | null)[] = [];
const departmentPosted: { name: string }[] = [];
const agentProposed: { department: string; template: string }[] = [];
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

/** The list of rooms and agents is a panel over the world, opened from the bar. */
async function openList(page: import('playwright-core').Page) {
  await page.getByRole('button', { name: 'Rooms and agents' }).click();
  await page.getByRole('dialog', { name: 'Rooms and agents' }).waitFor();
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
    if (url.pathname === '/api/companies' && req.method() === 'GET') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ companies: [{ id: COMPANY_A, slug: 'local', name: 'First Co', isDefault: true }, ...(made ? [{ id: COMPANY_B, slug: 'new-one', name: 'New One', isDefault: false }] : [])], templates: ['starter'] }) });
    if (url.pathname === '/api/companies' && req.method() === 'POST') {
      made = true;
      return route.fulfill({ status: 201, headers: cors, body: JSON.stringify({ id: COMPANY_B, slug: 'new-one', name: 'New One', isDefault: false }) });
    }
    if (url.pathname === '/api/departments/chief-of-staff/board') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ department: { key: 'chief-of-staff', name: 'Chief of Staff' }, agents: [{ key: 'scout', name: 'Scout', status: 'active' }], tasks: [{ id: 't1', title: 'Plan the week', status: 'in_progress', priority: 3, blocked_reason: null, created_at: '2026-11-15T10:00:00Z', assignee_key: 'scout', assignee_name: 'Scout' }] }) });
    if (url.pathname === '/api/departments/chief-of-staff/channel') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ messages: [{ id: 'm1', author: 'agent:scout', body: 'Starting on the plan.', created_at: '2026-11-15T10:00:00Z' }] }) });
    if (url.pathname === '/api/office/activity') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ events: [{ id: 'e1', at: new Date(Date.now() - 120_000).toISOString(), kind: 'run.started', text: 'Scout started a run.' }] }) });
    if (url.pathname === '/api/office/team') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ team: [{ id: facts.agents[0]!.id, key: 'scout', name: 'Scout', department: null, state: 'working', since: new Date(Date.now() - 180_000).toISOString(), task: 'Plan the week', forYou: 2 }, { id: facts.agents[1]!.id, key: 'closer', name: 'Closer', department: null, state: 'idle', since: null, task: null, forYou: 0 }] }) });
    if (url.pathname === '/api/office/agent-templates') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ templates: ['researcher', 'writer'] }) });
    if (url.pathname === '/api/office/agent-proposals' && req.method() === 'POST') {
      agentProposed.push(JSON.parse(req.postData() ?? '{}') as { department: string; template: string });
      return route.fulfill({ status: 201, headers: cors, body: JSON.stringify({ approvalId: 'ap1', id: 'outreach-researcher' }) });
    }
    if (url.pathname === '/api/departments' && req.method() === 'POST') {
      departmentPosted.push(JSON.parse(req.postData() ?? '{}') as { name: string });
      return route.fulfill({ status: 201, headers: cors, body: JSON.stringify({ key: 'sales', name: 'Sales', room: 20 }) });
    }
    if (url.pathname === '/api/office') officeCompany.push(req.headers()['x-company'] ?? null);
    if (url.pathname === '/api/office') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(facts) });
    if (url.pathname === '/api/office/state') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(places) });
    if (url.pathname === '/api/office/map') return route.fulfill({ status: 200, headers: cors, body: tmj });
    if (url.pathname === '/api/goals') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ current_rung: null, rungs: [], departments: [] }) });
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
      await page.goto(`${ORIGIN}/`);
      await page.locator('[data-testid="office-world"] canvas').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500); // a few frames
      // The welcome card shows the first time, and skipping it leaves the bar.
      await page.getByRole('dialog', { name: /welcome/i }).waitFor();
      writeFileSync(path.join(SHOTS, `office-${name}-welcome.png`), await page.screenshot());
      await page.getByRole('button', { name: /skip tutorial/i }).click();
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await colours(page)).toBeGreaterThan(3);
      // Hovering over the world says what is under the pointer (the wording for each thing is covered by the unit tests).
      const stage = (await page.locator('[data-testid="office-world"]').boundingBox())!;
      await page.mouse.move(stage.x + stage.width / 2 - 20, stage.y + stage.height / 2 - 20);
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await page.getByRole('tooltip').waitFor({ timeout: 10_000 }).catch(async (e) => {
        writeFileSync(path.join(SHOTS, `office-${name}-tooltip-fail.png`), await page.screenshot());
        throw e;
      });
      writeFileSync(path.join(SHOTS, `office-${name}-tooltip.png`), await page.screenshot());
      await page.mouse.move(2, 2);
      const people = page.getByRole('button', { name: /people, 2 here/i });
      await people.waitFor();
      const world = await page.locator('[data-testid="office-world"]').boundingBox();
      const at = (await people.boundingBox())!;
      // On a phone the bar sits along the bottom of the map; on a desktop along the top.
      if (name === 'android') expect(at.y).toBeGreaterThan(world!.y + world!.height / 2);
      else expect(at.y).toBeLessThan(world!.y + world!.height / 2);
      await people.click();
      const peoplePanel = page.getByRole('region', { name: 'People' });
      await peoplePanel.getByText('Scout', { exact: true }).waitFor();
      await peoplePanel.getByText(/Working/).waitFor();
      await peoplePanel.getByText('Plan the week').waitFor();
      await peoplePanel.getByText('2 for you').waitFor();
      await peoplePanel.getByRole('list', { name: 'Activity' }).getByText(/Scout started a run./).waitFor();
      writeFileSync(path.join(SHOTS, `office-${name}-team.png`), await page.screenshot());
      await page.getByRole('button', { name: /close people/i }).click();
      await page.getByRole('button', { name: /your status/i }).click();
      await page.getByRole('menuitemradio', { name: 'Busy' }).click();
      await page.getByRole('button', { name: /your status/i }).click();
      expect(await page.getByRole('menuitemradio', { name: 'Busy' }).getAttribute('aria-checked')).toBe('true');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /your status/i }).click();
      writeFileSync(path.join(SHOTS, `office-${name}-bar.png`), await page.screenshot());
      // The world fills the window, and the plain list is one button away.
      const stage0 = (await page.locator('[data-testid="office-world"]').boundingBox())!;
      expect(stage0.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
      expect(stage0.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
      await openList(page);
      await page.getByRole('heading', { name: lounge.name }).waitFor();
      await page.getByRole('button', { name: /Scout/ }).waitFor();
      writeFileSync(path.join(SHOTS, `office-${name}-list.png`), await page.screenshot());
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      // No sideways scroll on a phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      // The company you are in is shown, and a new one can be made and switched to: after that every request names it.
      made = false;
      officeCompany.length = 0;
      await page.getByRole('button', { name: /company: first co/i }).click();
      await page.getByRole('menuitem', { name: /new company/i }).click();
      const dialog = page.getByRole('dialog', { name: 'New company' });
      await dialog.getByLabel('Name').fill('New One');
      writeFileSync(path.join(SHOTS, `office-${name}-company.png`), await page.screenshot());
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('button', { name: /company: new one/i }).waitFor({ timeout: 15_000 });
      expect(officeCompany.at(-1)).toBe(COMPANY_B);
      await page.evaluate(() => localStorage.removeItem('conclave.company'));
      await page.reload();
      await page.getByRole('button', { name: /company: first co/i }).waitFor({ timeout: 15_000 });
      // A department can be added from the Tools menu.
      departmentPosted.length = 0;
      await page.getByRole('button', { name: /tools/i }).click();
      await page.getByRole('menuitem', { name: /add a department/i }).click();
      const adding = page.getByRole('dialog', { name: 'Add a department' });
      await adding.getByLabel('Name').fill('Sales');
      writeFileSync(path.join(SHOTS, `office-${name}-add-department.png`), await page.screenshot());
      await adding.getByRole('button', { name: 'Create', exact: true }).click();
      await vi.waitFor(() => expect(departmentPosted).toEqual([{ name: 'Sales' }]), { timeout: 15_000 });
      await page.getByRole('button', { name: /people/i }).waitFor({ timeout: 15_000 }); // the page reloads to show the new room
      // An agent can be proposed from the Tools menu; it waits for approval, and the dialog leads to Approvals.
      agentProposed.length = 0;
      await page.getByRole('button', { name: /tools/i }).click();
      await page.getByRole('menuitem', { name: /add an agent/i }).click();
      const agentDialog = page.getByRole('dialog', { name: 'Add an agent' });
      await agentDialog.getByRole('option', { name: 'researcher' }).waitFor({ state: 'attached' });
      writeFileSync(path.join(SHOTS, `office-${name}-add-agent.png`), await page.screenshot());
      await agentDialog.getByRole('button', { name: 'Propose', exact: true }).click();
      await agentDialog.getByText(/waiting for your approval/i).waitFor();
      expect(agentProposed).toHaveLength(1);
      expect(agentProposed[0]!.template).toBe('researcher');
      await agentDialog.getByRole('button', { name: /open approvals/i }).click();
      await page.getByRole('dialog', { name: 'Approvals' }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      // Each department room has its own board and channel, opened for that department.
      await openList(page);
      const room = page.getByRole('heading', { name: 'Chief of Staff', exact: true }).locator('xpath=ancestor::section[1]');
      await room.getByRole('button', { name: 'Board', exact: true }).click();
      const boardPanel = page.getByRole('dialog', { name: 'Department board' });
      await boardPanel.getByText('Plan the week').waitFor();
      expect(page.url()).toMatch(/panel=department-board&dept=chief-of-staff/);
      writeFileSync(path.join(SHOTS, `office-${name}-board.png`), await page.screenshot());
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await openList(page);
      await room.getByRole('button', { name: 'Channel', exact: true }).click();
      await page.getByRole('dialog', { name: 'Department channel' }).getByText('Starting on the plan.').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      // Using an object opens its panel over the office: beside the world on a desktop, the whole screen on a phone.
      await openList(page);
      await page.getByRole('button', { name: 'Approvals inbox' }).click();
      const panel = page.getByRole('dialog', { name: 'Approvals' });
      await panel.waitFor();
      const box = (await panel.boundingBox())!;
      const vp = page.viewportSize()!;
      if (name === 'android') expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
      else {
        expect(box.width).toBeLessThan(vp.width * 0.7);
        expect((await page.locator('[data-testid="office-world"]').boundingBox())!.width).toBeGreaterThan(100); // the world is still there
      }
      expect(page.url()).toMatch(/panel=approvals/);
      writeFileSync(path.join(SHOTS, `office-${name}-panel.png`), await page.screenshot());
      // On a desktop the left edge of the panel can be dragged to make it wider.
      if (name === 'desktop') {
        const edge = page.getByRole('separator', { name: /resize panel/i });
        const eb = (await edge.boundingBox())!;
        await page.mouse.move(eb.x + eb.width / 2, eb.y + 200);
        await page.mouse.down();
        await page.mouse.move(eb.x + eb.width / 2 - 150, eb.y + 200, { steps: 5 });
        await page.mouse.up();
        const wider = (await page.getByRole('dialog', { name: 'Approvals' }).boundingBox())!;
        expect(wider.width).toBeGreaterThan(box.width + 100);
      }
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      expect(page.url()).not.toMatch(/panel=/);
      // A link with the panel in it opens the panel on load.
      await page.goto(`${ORIGIN}/?panel=goals`);
      await page.getByRole('dialog', { name: 'Goals' }).waitFor({ timeout: 10_000 }).catch(async () => {
        throw new Error(`no Goals panel. url=${page.url()} errors=${errors.join(' | ')} text=${(await page.locator('body').innerText()).slice(0, 300)}`);
      });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      // Nothing outside the office: no link to another page on the home page, and an old route leads back here with its panel open.
      expect(await page.locator('a[href]').count()).toBe(0);
      await page.goto(`${ORIGIN}/approvals`);
      await page.getByRole('dialog', { name: 'Approvals' }).waitFor({ timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/');
      expect(page.url()).toMatch(/panel=approvals/);
      writeFileSync(path.join(SHOTS, `office-${name}.png`), await page.screenshot({ fullPage: true }));
      expect(errors).toEqual([]);
      await context.close();
    }, 180_000);
  }
});
