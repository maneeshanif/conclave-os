import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readOfficeMap, type OfficeMap, type OfficeMapJson } from '@conclave/shared';
import { loadOffice } from './desks';

/**
 * Many worlds (S6-17). The headquarters is the company's office (office.tmj), where the departments sit. Every map in
 * company/worlds/<key>.tmj is a social world beside it: no departments, no numbered desks, just rooms, scenery and a door. People
 * meet and chat in a world, and the agents rest in its lounge. The key is a plain file name, never a path.
 */
export const HQ = 'hq';
const KEY = /^[a-z0-9][a-z0-9-]{0,29}$/;

/** A world key from a request: a plain key, or the headquarters if it is empty or not a plain key. */
export function worldKey(raw: string | undefined | null): string {
  return raw && KEY.test(raw) ? raw : HQ;
}

export interface WorldInfo {
  key: string;
  name: string;
  blurb: string;
}

const titleOf = (json: { properties?: { name: string; value: unknown }[] }, name: string, fallback: string): string => {
  const v = json.properties?.find((p) => p.name === name)?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};

/** The headquarters, then the extra worlds by title. Files that are not maps, or have a name that is not a plain key, are left out. */
export async function listWorlds(companyRoot: string): Promise<WorldInfo[]> {
  const out: WorldInfo[] = [];
  let files: string[] = [];
  try {
    files = await readdir(path.join(companyRoot, 'worlds'));
  } catch {
    // No worlds folder: only the headquarters.
  }
  for (const f of files) {
    const m = /^(.+)\.tmj$/.exec(f);
    if (!m || !KEY.test(m[1]!)) continue;
    try {
      const json = JSON.parse(await readFile(path.join(companyRoot, 'worlds', f), 'utf8')) as { properties?: { name: string; value: unknown }[] };
      out.push({ key: m[1]!, name: titleOf(json, 'title', m[1]!), blurb: titleOf(json, 'blurb', '') });
    } catch {
      // A file that is not a map is skipped.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return [{ key: HQ, name: 'Headquarters', blurb: 'The company office, where the departments sit.' }, ...out];
}

/** The raw map file of a world, or null if there is no such world. */
export async function worldFile(companyRoot: string, key: string): Promise<string | null> {
  const file = key === HQ ? path.join(companyRoot, 'office.tmj') : path.join(companyRoot, 'worlds', `${key}.tmj`);
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** A world's map, checked. The headquarters needs a room for every active department; a social world needs none. Throws OfficeMapError. */
export async function loadWorld(companyRoot: string, key: string): Promise<{ map: OfficeMap; json: OfficeMapJson; social: boolean } | null> {
  if (key === HQ) return { ...(await loadOffice(companyRoot)), social: false };
  const text = await worldFile(companyRoot, key);
  if (text === null) return null;
  const json = JSON.parse(text) as OfficeMapJson;
  return { map: readOfficeMap(json, { file: `company/worlds/${key}.tmj`, departments: [] }), json, social: true };
}
