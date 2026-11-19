/** The names written on the walls and over the street (S6B-2): every department by name, every room, every district. Pure. */
export interface SignRoom {
  name: string;
  kind: string;
  department: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Sign {
  text: string;
  /** In tiles: the middle of the sign. */
  x: number;
  y: number;
  department: boolean;
  /** A district banner over the street, not a sign on a room's wall. */
  banner: boolean;
}

/** "Campus Green: Cafe" is the Cafe of the Campus Green district. */
const split = (name: string): [string | null, string] => {
  const i = name.indexOf(': ');
  return i < 0 ? [null, name] : [name.slice(0, i), name.slice(i + 2)];
};

export const signText = (name: string): string => split(name)[1].toUpperCase();

export function signsFor(rooms: SignRoom[]): Sign[] {
  const out: Sign[] = [];
  const groups = new Map<string, SignRoom[]>();
  for (const r of rooms) {
    const [district] = split(r.name);
    if (district) groups.set(district, [...(groups.get(district) ?? []), r]);
    // Too small to hold a sign: a pod. The room is still named in its tooltip.
    if (r.w < 4) continue;
    out.push({ text: signText(r.name), x: r.x + r.w / 2, y: r.y + 0.6, department: r.kind === 'department', banner: false });
  }
  for (const [district, list] of groups) {
    const x0 = Math.min(...list.map((r) => r.x));
    const x1 = Math.max(...list.map((r) => r.x + r.w));
    const y0 = Math.min(...list.map((r) => r.y));
    out.push({ text: district.toUpperCase(), x: (x0 + x1) / 2, y: y0 - 2, department: false, banner: true });
  }
  return out;
}
