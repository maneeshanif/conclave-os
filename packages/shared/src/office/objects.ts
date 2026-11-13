export const OBJECT_TYPES = ['approvals-desk', 'whiteboard', 'screen', 'mailbox', 'jobboard', 'boardroom-table'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

/**
 * What each thing in the office opens (SPEC 12). One registry used by the world (a click or "use" on the object) and by the plain
 * screens (the same panels from a list), so the two always agree. `ready` says whether the page exists yet; the world shows
 * a not-ready object as "coming" rather than a dead link.
 */
export interface ObjectPanel {
  panel: string;
  label: string;
  href: string;
  ready: boolean;
}

export const OBJECT_PANELS: Record<ObjectType, ObjectPanel> = {
  'approvals-desk': { panel: 'approvals', label: 'Approvals inbox', href: '/approvals', ready: true },
  whiteboard: { panel: 'goals', label: 'Goal ladder', href: '/goals', ready: true },
  screen: { panel: 'health', label: 'Health dashboard', href: '/health', ready: true },
  mailbox: { panel: 'inbox', label: 'Inbox', href: '/inbox', ready: true },
  jobboard: { panel: 'talent', label: 'Talent room', href: '/talent', ready: false },
  'boardroom-table': { panel: 'boardroom', label: 'Boardroom', href: '/boardroom', ready: false },
};

/** The panel for an object type, or null for a type we do not know. */
export function panelFor(type: string): ObjectPanel | null {
  return Object.hasOwn(OBJECT_PANELS, type) ? OBJECT_PANELS[type as ObjectType] : null;
}

/** Using an object opens its panel. An unknown type is a mistake in the map, not something to ignore. */
export function useObject(type: string): ObjectPanel {
  const p = panelFor(type);
  if (!p) throw new Error(`The office has no panel for an object of type "${type}". Known types: ${OBJECT_TYPES.join(', ')}`);
  return p;
}
