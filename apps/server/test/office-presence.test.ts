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

const chats = (s: Socket) => s.sent.filter((m) => m.kind === 'chat') as { kind: 'chat'; id: string; name: string; text: string; at: number }[];

describe('talking to someone near you (S6-15c)', () => {
  const ticking = () => {
    let t = 0;
    return new PresenceHub({ minIntervalMs: 0, chatIntervalMs: 500, now: () => (t += 1000) });
  };

  it('reaches only the people within range, not the sender and not anyone far away', async () => {
    const { open } = setup({ hub: ticking() });
    const a = await open('u1', 'a');
    const near = await open('u2', 'b');
    const far = await open('u3', 'c');
    a.say(move(10, 10, { name: 'Ana' }));
    near.say(move(12, 11));
    far.say(move(30, 20));
    a.say({ type: 'chat', text: 'hello there' });
    expect(chats(near.s)).toMatchObject([{ id: 'a', name: 'Ana', text: 'hello there' }]);
    expect(chats(far.s)).toEqual([]);
    expect(chats(a.s)).toEqual([]);
  });

  it('ignores a message from someone who has not said where they are, and signed-out sockets never hear anything', async () => {
    const { open } = setup({ hub: ticking() });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    b.say(move(1, 1));
    a.say({ type: 'chat', text: 'where am i' }); // a never sent a position
    expect(chats(b.s)).toEqual([]);
    // With no login in front of the socket, nothing is shared at all.
    const off = setup({ signedIn: false });
    await off.app.request('/events');
    const h = off.handlers[0]!;
    const sock = socket();
    h.onOpen?.({}, sock);
    h.onMessage?.({ data: JSON.stringify(move(1, 1)) }, sock);
    h.onMessage?.({ data: JSON.stringify({ type: 'chat', text: 'hi' }) }, sock);
    expect(off.hub.members()).toEqual([]);
    expect(chats(sock)).toEqual([]);
  });

  it('cuts a long message short, strips control characters and markup brackets, and drops an empty one', async () => {
    const { open } = setup({ hub: ticking() });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(5, 5));
    b.say(move(5, 6));
    a.say({ type: 'chat', text: 'x'.repeat(900) });
    a.say({ type: 'chat', text: '<b>hi</b>\u0007  there' });
    a.say({ type: 'chat', text: '    ' });
    a.say({ type: 'chat', text: 42 });
    const got = chats(b.s);
    expect(got).toHaveLength(2);
    expect(got[0]!.text).toHaveLength(300);
    expect(got[1]!.text).toBe('bhi/b there');
  });

  it('is rate limited per person, and the next message is allowed after the pause', async () => {
    let t = 1000;
    const { open } = setup({ hub: new PresenceHub({ minIntervalMs: 0, chatIntervalMs: 500, now: () => t }) });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(5, 5));
    b.say(move(5, 6));
    for (let i = 0; i < 10; i++) a.say({ type: 'chat', text: `m${i}` });
    expect(chats(b.s)).toHaveLength(1);
    t += 600;
    a.say({ type: 'chat', text: 'later' });
    expect(chats(b.s).map((c) => c.text)).toEqual(['m0', 'later']);
  });

  it('forwards the text and who it is from, and nothing else a client adds', async () => {
    const { open } = setup({ hub: ticking() });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(5, 5));
    b.say(move(5, 6));
    a.say({ type: 'chat', text: 'hi', secret: 'tok', to: 'everyone' });
    expect(JSON.stringify(chats(b.s))).not.toMatch(/tok|everyone/);
  });
});

describe('presence over the socket (S6-9)', () => {
  it('lets two signed-in people see each other move, and not see themselves', async () => {
    const { open } = setup();
    const owner = await open('u1', 'a');
    const cofounder = await open('u2', 'b');
    owner.say(move(5, 6));
    expect(presence(cofounder.s)).toEqual([{ kind: 'presence', member: { id: 'a', name: 'Guest', look: 0, x: 5, y: 6, availability: 'available', handRaised: false } }]);
    expect(presence(owner.s)).toEqual([]);
    cofounder.say(move(9, 9, { availability: 'busy', handRaised: true, name: 'Dana' }));
    expect(presence(owner.s)).toEqual([{ kind: 'presence', member: { id: 'b', name: 'Dana', look: 0, x: 9, y: 9, availability: 'busy', handRaised: true } }]);
  });

  it('tells someone who arrives later who is already here', async () => {
    const { open } = setup();
    const a = await open('u1', 'a');
    a.say(move(1, 1));
    const b = await open('u2', 'b');
    expect(presence(b.s)).toEqual([{ kind: 'presence.all', members: [{ id: 'a', name: 'Guest', look: 0, x: 1, y: 1, availability: 'available', handRaised: false }] }]);
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

  it('carries a look from 0 to 5 and keeps the last good one when a bad one comes (S6-15b)', async () => {
    let t = 0;
    const { open } = setup({ hub: new PresenceHub({ minIntervalMs: 0, now: () => (t += 1) }) });
    const a = await open('u1', 'a');
    const b = await open('u2', 'b');
    a.say(move(1, 1));
    expect((presence(b.s).at(-1) as { member: { look: number } }).member.look).toBe(0); // none sent: the first look
    a.say(move(1, 1, { look: 4 }));
    expect((presence(b.s).at(-1) as { member: { look: number } }).member.look).toBe(4);
    for (const bad of [6, -1, 2.5, 'x', null]) {
      a.say(move(2, 2, { look: bad }));
      expect((presence(b.s).at(-1) as { member: { look: number } }).member.look).toBe(4);
    }
    a.say(move(3, 3)); // nothing sent: the last look stays
    expect((presence(b.s).at(-1) as { member: { look: number } }).member.look).toBe(4);
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
