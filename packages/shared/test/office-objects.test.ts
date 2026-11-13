import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OBJECT_TYPES, OBJECT_PANELS, panelFor, useObject } from '../src/office';

const web = path.resolve(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'app');

describe('what each object opens (S6-7)', () => {
  it('has a panel registered for every object type the map may use, and none for a type it may not', () => {
    for (const t of OBJECT_TYPES) expect(OBJECT_PANELS[t], t).toBeDefined();
    expect(Object.keys(OBJECT_PANELS).sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it('opens the right panel for each object', () => {
    expect(useObject('approvals-desk')).toMatchObject({ panel: 'approvals', href: '/approvals' });
    expect(useObject('whiteboard')).toMatchObject({ panel: 'goals', href: '/goals' });
    expect(useObject('screen')).toMatchObject({ panel: 'health', href: '/health' });
    expect(useObject('mailbox')).toMatchObject({ panel: 'inbox', href: '/inbox' });
    expect(useObject('jobboard')).toMatchObject({ panel: 'talent' });
    expect(useObject('boardroom-table')).toMatchObject({ panel: 'boardroom' });
  });

  it('refuses a type it does not know', () => {
    expect(() => useObject('vending-machine')).toThrow(/vending-machine/);
    expect(panelFor('vending-machine')).toBeNull();
  });

  it('only calls a panel ready if its page exists in the web app, so the plain screens and the world agree', () => {
    for (const t of OBJECT_TYPES) {
      const p = OBJECT_PANELS[t];
      const exists = existsSync(path.join(web, p.href.replace(/^\//, ''), 'page.tsx'));
      expect(p.ready, `${t} -> ${p.href}`).toBe(exists);
    }
  });

  it('gives every panel a label a person can read', () => {
    for (const t of OBJECT_TYPES) expect(OBJECT_PANELS[t].label.length).toBeGreaterThan(2);
  });
});
