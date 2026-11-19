import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readOfficeMap, type OfficeMapJson } from '@conclave/shared';
import { createApp } from '../src/app';
import { Bus } from '../src/bus';
import { loadCompany } from '../src/company/loader';
import { withWorkspace } from '../src/db/tenant';
import { MemoryOsStore } from '../src/harness/os-tools';
import { RunTokens } from '../src/harness/run-tokens';
import { REPO_ROOT } from '../src/paths';
import type { System } from '../src/system';
import { LocalDispatcher } from '../src/workflows/dispatch';
import { testSystem } from './helpers/db';

/** The client meetings API and the room on the map (S10-3). */
let sys: System;
let app: ReturnType<typeof createApp>;
const ws = () => sys.workspace.id;
const sql = (q: string, p: unknown[] = []) => withWorkspace(sys.app, ws(), ({ client }) => client.query(q, p));
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  ({ sys } = await testSystem());
  app = createApp({ pool: sys.app, workspaceId: ws(), tokens: new RunTokens(), store: new MemoryOsStore(), bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })) });
}, 240_000);
afterAll(() => sys?.close());

describe('GET and POST /api/meetings (S10-3)', () => {
  it('starts empty, makes a meeting, and lists what the table holds with its live guest links counted', async () => {
    expect(await (await app.request('/api/meetings')).json()).toEqual({ meetings: [] });
    const made = await app.request('/api/meetings', { method: 'POST', headers: json, body: JSON.stringify({ title: 'Kickoff with Glow Clinic', startsAt: '2026-12-01T10:00:00.000Z' }) });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    await sql("insert into guest_links (workspace_id, meeting_id, token_hash, expires_at) values ($1, $2, 'h1', now() + interval '1 day'), ($1, $2, 'h2', now() - interval '1 day'), ($1, $2, 'h3', now() + interval '1 day')", [ws(), id]);
    await sql("update guest_links set revoked_at = now() where token_hash = 'h3'");
    const list = ((await (await app.request('/api/meetings')).json()) as { meetings: { id: string; title: string; status: string; invites: number; room: string | null }[] }).meetings;
    expect(list).toEqual([expect.objectContaining({ id, title: 'Kickoff with Glow Clinic', status: 'planned', invites: 1, room: null })]);
  });

  it('refuses a bad title, a bad time, extra fields and a deal that is not there', async () => {
    const post = (b: unknown) => app.request('/api/meetings', { method: 'POST', headers: json, body: JSON.stringify(b) });
    expect((await post({ title: '', startsAt: '2026-12-01T10:00:00.000Z' })).status).toBe(400);
    expect((await post({ title: 'x', startsAt: 'tomorrow' })).status).toBe(400);
    expect((await post({ title: 'x', startsAt: '2026-12-01T10:00:00.000Z', room: 'sneaky' })).status).toBe(400);
    expect((await post({ title: 'x', startsAt: '2026-12-01T10:00:00.000Z', dealId: randomUUID() })).status).toBe(400);
  });

  it('opens and closes a room through the connector, once, and says so plainly when it cannot', async () => {
    const id = ((await (await app.request('/api/meetings', { method: 'POST', headers: json, body: JSON.stringify({ title: 'Review', startsAt: '2026-12-02T10:00:00.000Z' }) })).json()) as { id: string }).id;
    const post = (p: string) => app.request(p, { method: 'POST', headers: json, body: '{}' });
    expect(await (await post(`/api/meetings/${id}/open`)).json()).toEqual({ room: `local-${id}`, already: false });
    expect(await (await post(`/api/meetings/${id}/open`)).json()).toEqual({ room: `local-${id}`, already: true });
    expect(await (await post(`/api/meetings/${id}/close`)).json()).toEqual({ closed: true });
    expect((await post(`/api/meetings/${id}/open`)).status).toBe(409);
    expect((await post(`/api/meetings/${randomUUID()}/open`)).status).toBe(409);
  });
});

describe('the client meeting room on the map (S10-3)', () => {
  it('has a Meeting Centre with a reception, a way in from the street, and a board in the reception that opens the Meetings panel', async () => {
    const root = path.join(REPO_ROOT, 'company');
    const company = await loadCompany(root);
    const map = readOfficeMap(JSON.parse(await readFile(path.join(root, 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) });
    const reception = map.rooms.find((r) => r.name === 'Meeting Centre: Reception')!;
    expect(reception).toBeTruthy();
    expect(map.entries.some((e) => e.name === 'meeting-lounge')).toBe(true);
    expect(map.rooms.filter((r) => r.name.startsWith('Meeting Centre: Room')).length).toBeGreaterThanOrEqual(8);
    const board = map.objects.find((o) => o.type === 'meetings-board')!;
    expect(board).toBeTruthy();
    expect(board.x >= reception.x && board.x < reception.x + reception.w && board.y >= reception.y && board.y < reception.y + reception.h).toBe(true);
  });

  it('gives a calendar file of the meetings: titles and times, no links, as a download', async () => {
    const res = await app.request('/api/meetings/calendar.ics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:Kickoff with Glow Clinic');
    expect(text).not.toMatch(/http|LOCATION|guest/i);
  });
});
