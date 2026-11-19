import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOfficeMap, type OfficeMapJson } from '@conclave/shared';
import { loadCompany } from '../src/company/loader';
import { REPO_ROOT } from '../src/paths';

/** The Engineering and Product rooms (S7-10): switched on in the shipped company, each with a room and desks on the map, and seeded agents. */
const root = path.join(REPO_ROOT, 'company');

describe('the Engineering and Product rooms (S7-10)', () => {
  it('are active departments with a room on the map and a desk for every seeded agent', async () => {
    const company = await loadCompany(root);
    const map = readOfficeMap(JSON.parse(await readFile(path.join(root, 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) });
    for (const key of ['engineering', 'product']) {
      expect(company.departments.find((d) => d.key === key)?.active, key).toBe(true);
      const room = map.rooms.find((r) => r.department === key);
      expect(room, key).toBeTruthy();
      const desks = map.desks.filter((d) => d.room === room!.name);
      const agents = company.agents.filter((a) => a.role.department === key);
      expect(agents.length, key).toBeGreaterThan(0);
      expect(desks.length, key).toBeGreaterThanOrEqual(agents.length);
      expect(map.objects.some((o) => o.type === 'dept-board' && o.x >= room!.x && o.x < room!.x + room!.w && o.y >= room!.y && o.y < room!.y + room!.h), `${key} board`).toBe(true);
    }
  });

  it('seed a Tech Lead, a coder and a code reviewer in Engineering, the coder and reviewer on the codex runtime with a shell, nothing else with one', async () => {
    const company = await loadCompany(root);
    const eng = company.agents.filter((a) => a.role.department === 'engineering');
    expect(eng.map((a) => a.role.template).sort()).toEqual(['code-reviewer', 'coder', 'lead']);
    for (const a of eng.filter((x) => x.role.template !== 'lead')) expect(a.role.runtime).toBe('codex');
    expect(company.agents.filter((a) => a.role.department === 'product').length).toBeGreaterThanOrEqual(1);
    for (const a of company.agents.filter((x) => !['coder', 'code-reviewer'].includes(x.role.template ?? ''))) expect(a.role.runtime, a.role.id).not.toBe('codex');
  });

  it('has a deployments board in the Engineering room, which opens the Deployments panel', async () => {
    const company = await loadCompany(root);
    const map = readOfficeMap(JSON.parse(await readFile(path.join(root, 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) });
    const room = map.rooms.find((r) => r.department === 'engineering')!;
    const board = map.objects.find((o) => o.type === 'deploy-board' && o.x >= room.x && o.x < room.x + room.w && o.y >= room.y && o.y < room.y + room.h);
    expect(board).toBeTruthy();
  });
});
