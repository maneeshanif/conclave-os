import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOfficeMap, type OfficeMapJson } from '@conclave/shared';
import { loadCompany } from '../src/company/loader';
import { REPO_ROOT } from '../src/paths';

/** The three company templates (S9-5): the OS is not Conclave-shaped. */
const dir = path.join(REPO_ROOT, 'templates', 'companies');

describe('the company templates (S9-5)', () => {
  it('ship three: the agency starter, a SaaS founder and a course creator', async () => {
    const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['starter', 'saas-founder', 'course-creator']));
  });

  for (const name of ['saas-founder', 'course-creator']) {
    it(`${name} loads, its map has a room for every active department, and it names no Conclave company text`, async () => {
      const root = path.join(dir, name);
      const company = await loadCompany(root);
      const active = company.departments.filter((d) => d.active);
      expect(active.map((d) => d.key)).toEqual(['chief-of-staff', 'lead-gen', 'outreach', 'research']);
      const map = readOfficeMap(JSON.parse(await readFile(path.join(root, 'office.tmj'), 'utf8')) as OfficeMapJson, { file: 'office.tmj', departments: company.departments.map((d) => ({ key: d.key, active: d.active })) });
      for (const d of active) {
        const room = map.rooms.find((r) => r.department === d.key)!;
        expect(room, d.key).toBeTruthy();
        expect(room.name, d.key).toBe(d.name); // the room is called what the department is called
        expect(map.desks.some((x) => x.room === room.name), `${d.key} has desks`).toBe(true);
      }
      for (const f of ['COMPANY.md', 'goals.yaml', 'departments.yaml', 'README.md']) expect((await readFile(path.join(root, f), 'utf8')).toLowerCase(), f).not.toMatch(/conclave|vespera|clinic|med spa/);
      expect(await readFile(path.join(root, 'COMPANY.md'), 'utf8')).toMatch(/TODO/);
    });
  }

  it('differ from each other and from the starter in what they call the rooms and what they aim at', async () => {
    const names = async (n: string) => (await loadCompany(path.join(dir, n))).departments.map((d) => d.name).join('|');
    expect(new Set([await names('starter'), await names('saas-founder'), await names('course-creator')]).size).toBe(3);
    expect(await readFile(path.join(dir, 'course-creator', 'goals.yaml'), 'utf8')).toMatch(/enrolments_per_week/);
    expect(await readFile(path.join(dir, 'saas-founder', 'goals.yaml'), 'utf8')).toMatch(/trial_signups_per_week/);
  });
});
