import { describe, expect, it } from 'vitest';
import { OBJECT_TYPES, OBJECT_PANELS, panelFor, useObject } from '../src/office';

/** Every panel the office can open, each with the one thing in the office that opens it. */
const PLACES = {
  'approvals-desk': 'approvals',
  whiteboard: 'goals',
  screen: 'health',
  mailbox: 'inbox',
  jobboard: 'talent',
  'boardroom-table': 'boardroom',
  'task-board': 'tasks',
  'needs-you-board': 'needs-you',
  'brief-desk': 'brief',
  'pipeline-board': 'pipeline',
  'campaign-board': 'campaigns',
  'signal-radio': 'signals',
  'idea-wall': 'ideas',
  terminal: 'run-log',
  'dept-board': 'department-board',
  'dept-table': 'department-meeting',
} as const;

describe('what each object opens (S6-7, S6-12b)', () => {
  it('has a panel registered for every object type the map may use, and none for a type it may not', () => {
    for (const t of OBJECT_TYPES) expect(OBJECT_PANELS[t], t).toBeDefined();
    expect(Object.keys(OBJECT_PANELS).sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it('opens the right panel for each object', () => {
    for (const [type, panel] of Object.entries(PLACES)) expect(useObject(type).panel, type).toBe(panel);
    expect([...OBJECT_TYPES].sort()).toEqual(Object.keys(PLACES).sort());
  });

  it('has exactly one object type for each panel, so every panel has one place', () => {
    const panels = OBJECT_TYPES.map((t) => OBJECT_PANELS[t].panel);
    expect(new Set(panels).size).toBe(panels.length);
  });

  it('refuses a type it does not know', () => {
    expect(() => useObject('vending-machine')).toThrow(/vending-machine/);
    expect(panelFor('vending-machine')).toBeNull();
    expect(panelFor('__proto__')).toBeNull();
  });

  it('is ready for every panel that exists, and says "coming" only for the Talent room', () => {
    const coming = OBJECT_TYPES.filter((t) => !OBJECT_PANELS[t].ready).sort();
    expect(coming).toEqual(['jobboard']);
  });

  it('gives every panel a label a person can read', () => {
    for (const t of OBJECT_TYPES) expect(OBJECT_PANELS[t].label.length).toBeGreaterThan(2);
  });
});
