// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushToggle } from '../components/PushToggle';
import { urlBase64ToUint8Array, type PushClient, type PushState } from '../lib/push';

afterEach(cleanup);

const client = (initial: PushState, over: Partial<PushClient> = {}) => {
  let state = initial;
  return {
    state: vi.fn(async () => state),
    enable: vi.fn(async () => void (state = 'on')),
    disable: vi.fn(async () => void (state = 'off')),
    ...over,
  } satisfies PushClient;
};

describe('the notifications switch (S5-10)', () => {
  it('says what it will send, and only three things, when it is off; turns on; then offers to turn off', async () => {
    const c = client('off');
    render(<PushToggle client={c} />);
    expect((await screen.findByText(/three things only/i)).textContent).toMatch(/never the text of a post or a lead/i);
    fireEvent.click(screen.getByRole('button', { name: /turn on notifications/i }));
    await waitFor(() => expect(c.enable).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /turn off notifications/i }));
    await waitFor(() => expect(c.disable).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /turn on notifications/i })).toBeTruthy();
  });

  it('explains a blocked browser and an unsupported one, with no button', async () => {
    render(<PushToggle client={client('blocked')} />);
    expect(await screen.findByText(/blocked for this site/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    render(<PushToggle client={client('unsupported')} />);
    expect((await screen.findByText(/cannot get notifications/i)).textContent).toMatch(/home screen/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows why when turning on fails, and stays off', async () => {
    const c = client('off', { enable: vi.fn(async () => { throw new Error('Notifications were not allowed on this device.'); }) });
    render(<PushToggle client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn on notifications/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not allowed/i);
    expect(screen.getByRole('button', { name: /turn on notifications/i })).toBeTruthy();
  });

  it('does not double-send while a request is in flight', async () => {
    let release: () => void = () => undefined;
    const c = client('off', { enable: vi.fn(() => new Promise<void>((r) => (release = r))) });
    render(<PushToggle client={c} />);
    const b = await screen.findByRole('button', { name: /turn on notifications/i });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(c.enable).toHaveBeenCalledTimes(1);
    release();
  });
});

describe('the subscription key (S5-10)', () => {
  it('turns URL-safe base64 into bytes', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]); // URL-safe characters, no padding
  });
});

/** Runs public/sw.js against a fake worker scope. */
function worker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let focused = 0;
  const windows: { focus: () => void; navigate: (u: string) => void }[] = [];
  const self = {
    addEventListener: (t: string, f: (e: unknown) => void) => (handlers[t] = f),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void shown.push({ title, options })) },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow: vi.fn(async (u: string) => void opened.push(u)) },
    location: { origin: 'http://localhost:3000' },
  };
  vm.runInNewContext(readFileSync(path.join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8'), { self, caches: {}, fetch: vi.fn(), URL, Promise, console });
  return { handlers, shown, opened, navigated, windows, focused: () => focused, addWindow: () => windows.push({ focus: () => void focused++, navigate: (u) => void navigated.push(u) }) };
}
const pushEvent = (data: unknown) => {
  let p: Promise<unknown> = Promise.resolve();
  return { e: { data: { json: () => data }, waitUntil: (x: Promise<unknown>) => (p = x) }, done: () => p };
};

describe('the service worker handles push (S5-10)', () => {
  it('shows the title, the line and the tag it was sent, opening the page it names', async () => {
    const w = worker();
    const { e, done } = pushEvent({ title: 'An approval is waiting', body: 'Open Conclave OS to decide.', url: '/approvals', tag: 'approval' });
    w.handlers.push!(e);
    await done();
    expect(w.shown[0]).toMatchObject({ title: 'An approval is waiting', options: { body: 'Open Conclave OS to decide.', tag: 'approval', data: { url: '/approvals' } } });
  });

  it('falls back to the approvals page for any address that is not a path on this site', async () => {
    for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 42, undefined]) {
      const w = worker();
      const { e, done } = pushEvent({ title: 'T', body: 'b', url });
      w.handlers.push!(e);
      await done();
      expect(w.shown[0]!.options.data, String(url)).toEqual({ url: '/approvals' });
    }
  });

  it('shows something sensible for a message it cannot read', async () => {
    const w = worker();
    const e = { data: { json: () => { throw new Error('bad'); } }, waitUntil: vi.fn() };
    w.handlers.push!(e);
    expect(e.waitUntil).toHaveBeenCalled();
    expect(w.shown[0]).toMatchObject({ title: 'Conclave OS' });
  });

  it('on a tap, focuses an open window and goes to the page; with none open, opens one', async () => {
    const w = worker();
    w.addWindow();
    const close = vi.fn();
    let p: Promise<unknown> = Promise.resolve();
    w.handlers.notificationclick!({ notification: { close, data: { url: '/brief' } }, waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect(close).toHaveBeenCalled();
    expect(w.navigated).toEqual(['/brief']);
    expect(w.focused()).toBe(1);

    const none = worker();
    let q: Promise<unknown> = Promise.resolve();
    none.handlers.notificationclick!({ notification: { close: vi.fn(), data: { url: 'https://evil.example' } }, waitUntil: (x: Promise<unknown>) => (q = x) });
    await q;
    expect(none.opened).toEqual(['/approvals']);
  });
});
