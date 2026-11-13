import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createApp } from '../src/app';
import type { Auth } from '../src/auth';
import { Bus } from '../src/bus';
import { PresenceHub } from '../src/office/presence';
import { LocalDispatcher } from '../src/workflows/dispatch';

type Handlers = { onOpen?: (e: unknown, s: Socket) => void; onMessage?: (e: { data: unknown }, s: Socket) => void; onClose?: () => void };
interface Socket {
  sent: Record<string, unknown>[];
  send(m: string): void;
  close(): void;
}
const socket = (): Socket => ({
  sent: [],
  send(m) {
    this.sent.push(JSON.parse(m));
  },
  close() {},
});

/** A stand-in for sign-in: the cookie "s=<user>.<session>" is a session, anything else is signed out. */
const auth = {
  config: { webOrigin: 'http://localhost:3000' },
  handler: async () => new Response('x'),
  session: async (h: Headers) => {
    const m = /s=([^.;]+)\.([^;]+)/.exec(h.get('cookie') ?? '');
    return m ? { userId: m[1]!, sessionId: m[2]! } : null;
  },
} as unknown as Auth;

function setup(opts: { signedIn?: boolean; hub?: PresenceHub } = {}) {
  const handlers: Handlers[] = [];
  const upgrade = ((factory: (c: unknown) => Handlers) => async (c: { text: (s: string) => Response }) => {
    handlers.push(factory(c));
    return c.text('upgraded');
  }) as never;
  const hub = opts.hub ?? new PresenceHub();
  const app = createApp({ pool: {} as Pool, workspaceId: 'w', bus: new Bus(), dispatcher: new LocalDispatcher(async () => ({ status: 'no_task' })), upgradeWebSocket: upgrade, presence: hub, ...(opts.signedIn === false ? {} : { auth }) });
  /** Opens a socket for a session and returns it with a way to send what the browser would. */
  const open = async (user: string, session: string) => {
    const before = handlers.length;
    const res = await app.request('/events', { headers: { cookie: `s=${user}.${session}` } });
    expect(await res.text()).toBe('upgraded');
    const h = handlers[before]!;
    const s = socket();
    h.onOpen?.({}, s);
    return { s, say: (m: unknown) => h.onMessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) }, s), close: () => h.onClose?.() };
  };
  return { app, open, handlers, hub };
}
const move = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ type: 'presence', x, y, availability: 'available', handRaised: false, ...extra });
const presence = (s: Socket) => s.sent.filter((m) => String(m.kind).startsWith('presence'));

describe('presence over the socket (S6-9)', () => {
  it('lets two signed-in people see each other move, and not see themselves', async () => {
    const { open } = setup();
    const owner = await open('u1', 'a');
    const cofounder = await open('u2', 'b');
    owner.say(move(5, 6));
    expect(presence(cofounder.s)).toEqual([{ kind: 'presence', member: { id: 'a', name: 'Guest', x: 5, y: 6, availability: 'available', handRaised: false } }]);
    expect(presence(owner.s)).toEqual([]);
    cofounder.say(move(9, 9, { availability: 'busy', handRaised: true, name: 'Dana' }));
    expect(presence(owner.s)).toEqual([{ kind: 'presence', member: { id: 'b', name: 'Dana', x: 9, y: 9, availability: 'busy', handRaised: true } }]);
  });

  it('tells someone who arrives later who is already here', async () => {
    const { open } = setup();
    const a = await open('u1', 'a');
    a.say(move(1, 1));
    const b = await open('u2', 'b');
    expect(presence(b.s)).toEqual([{ kind: 'presence.all', members: [{ id: 'a', name: 'Guest', x: 1, y: 1, availability: 'available', handRaised: false }] }]);
  });

  it('shows the same person on two devices as two avatars', async () => {
    const { open } = setup();
    const laptop = await open('u1', 'laptop');
    const phone = await open('u1', 'phone');
    laptop.say(move(2, 2));
    expect((presence(phone.s)[0] as { member: { id: string } }).member.id).toBe('laptop');
  });

  it('takes away the avatar when someone leaves', async () => {
    const { open, hub } = setup();
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(3, 3));
    a.close();
    expect(presence(b.s).at(-1)).toEqual({ kind: 'presence.leave', id: 'a' });
    expect(hub.members()).toEqual([]);
  });

  it('keeps people who never moved out of the list', async () => {
    const { open, hub } = setup();
    await open('u1', 'a');
    expect(hub.members()).toEqual([]);
  });

  it('is rate limited: a burst of moves gets through once, and the next is allowed after the pause', async () => {
    let t = 1000;
    const { open } = setup({ hub: new PresenceHub({ minIntervalMs: 100, now: () => t }) });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    for (let i = 0; i < 20; i++) a.say(move(i, 0));
    expect(presence(b.s)).toHaveLength(1);
    t += 150;
    a.say(move(30, 0));
    expect(presence(b.s)).toHaveLength(2);
    expect((presence(b.s)[1] as { member: { x: number } }).member.x).toBe(30);
  });

  it('forwards presence and nothing else: extra fields are dropped, other messages and bad ones are ignored', async () => {
    let t = 0;
    const { open } = setup({ hub: new PresenceHub({ minIntervalMs: 0, now: () => (t += 1) }) });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(4, 4, { secret: 'tok', text: 'hello', html: '<script>' }));
    expect(JSON.stringify(presence(b.s)[0])).not.toMatch(/tok|hello|script/);
    const n = presence(b.s).length;
    a.say({ type: 'chat', text: 'hi' });
    a.say('not json');
    a.say(move(-1, 4));
    a.say(move(4, 99999));
    a.say(move(1.5, 2));
    a.say(move(4, 4, { availability: 'invisible' }));
    a.say(move(4, 4, { handRaised: 'yes' }));
    expect(presence(b.s)).toHaveLength(n);
  });

  it('keeps a name short and plain', async () => {
    let t = 0;
    const { open } = setup({ hub: new PresenceHub({ minIntervalMs: 0, now: () => (t += 1) }) });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(1, 1, { name: `  ${'x'.repeat(100)}  ` }));
    expect((presence(b.s)[0] as { member: { name: string } }).member.name.length).toBeLessThanOrEqual(30);
    a.say(move(2, 2, { name: '   ' }));
    expect((presence(b.s).at(-1) as { member: { name: string } }).member.name).toBe('Guest');
  });

  it('refuses a signed-out socket outright, and with login off nobody gets presence', async () => {
    const { app } = setup();
    expect((await app.request('/events')).status).toBe(401);
    expect((await app.request('/events', { headers: { cookie: 'junk=1' } })).status).toBe(401);
    const off = setup({ signedIn: false });
    const res = await off.app.request('/events');
    expect(await res.text()).toBe('upgraded');
    const h = off.handlers[0]!;
    const s = socket();
    h.onOpen?.({}, s);
    h.onMessage?.({ data: JSON.stringify(move(1, 1)) }, s);
    expect(off.hub.members()).toEqual([]);
  });
});
