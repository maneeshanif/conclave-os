/**
 * The list of other people in the office, kept from the server's presence messages (S6-9). Pure: it takes the list and a message
 * and gives back the new list, ignoring anything that is not about presence or is malformed.
 */
export type Availability = 'available' | 'busy' | 'away';
export interface Member {
  id: string;
  name: string;
  x: number;
  y: number;
  availability: Availability;
  handRaised: boolean;
}

const isMember = (v: unknown): v is Member => {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.name === 'string' && Number.isInteger(m.x) && Number.isInteger(m.y) && (m.availability === 'available' || m.availability === 'busy' || m.availability === 'away') && typeof m.handRaised === 'boolean';
};

export function applyPresence(list: Member[], msg: { kind: string; [key: string]: unknown }): Member[] {
  if (msg.kind === 'presence') {
    if (!isMember(msg.member)) return list;
    const m = msg.member;
    return list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
  }
  if (msg.kind === 'presence.all') {
    if (!Array.isArray(msg.members) || !msg.members.every(isMember)) return list;
    return msg.members;
  }
  if (msg.kind === 'presence.leave') {
    if (typeof msg.id !== 'string' || !list.some((x) => x.id === msg.id)) return list;
    return list.filter((x) => x.id !== msg.id);
  }
  return list;
}
