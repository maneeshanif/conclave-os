// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficeView, type OfficeClient } from '../components/OfficeView';
import type { AgentDrawer, OfficeFacts, OfficePlace } from '../lib/api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const facts: OfficeFacts = {
  map: {
    width: 40,
    height: 24,
    tile: 32,
    rooms: [{ name: 'Outreach', kind: 'department', department: 'outreach', x: 0, y: 0, w: 5, h: 5, maxUsers: null, locked: false, silent: false, focusable: false }],
    desks: [],
    objects: [],
    entries: [],
    walls: [],
  },
  agents: [{ id: 'a1', key: 'scout', name: 'Scout', department: 'outreach', status: 'active', room: 'Outreach', desk: 1 }],
};
const drawer = (over: Partial<AgentDrawer> = {}): AgentDrawer => ({
  agent: { id: 'a1', key: 'scout', name: 'Scout', department: 'outreach', status: 'active' },
  run: { id: 'r1', status: 'running' },
  tasks: [{ id: 't1', title: 'Find leads', status: 'in_progress' }],
  terminal: { runId: 'r1', status: 'running', lines: [{ kind: 'call', text: '$ get_task {}' }, { kind: 'result', text: '✓ Find three clinics.' }, { kind: 'error', text: 'error (limit): Plan limit.' }] },
  ...over,
});
const client = (d: () => AgentDrawer): OfficeClient =>
  ({
    office: vi.fn(async () => facts),
    state: vi.fn(async (): Promise<OfficePlace[]> => []),
    team: vi.fn(async () => []),
    activity: vi.fn(async () => []),
    drawer: vi.fn(async () => d()),
    message: vi.fn(),
    live: vi.fn(() => () => undefined),
    presence: vi.fn(),
  }) as unknown as OfficeClient;

describe('the live terminal in the drawer (S6C-6)', () => {
  it('shows the last steps of the run in order, as text, in a terminal-looking block', async () => {
    render(<OfficeView client={client(() => drawer())} openId="a1" />);
    const term = await screen.findByLabelText('Scout terminal');
    expect(term.textContent).toBe('$ get_task {}✓ Find three clinics.error (limit): Plan limit.');
    expect(term.querySelector('img')).toBeNull();
  });

  it('shows no terminal for an agent with nothing to show, and escapes markup in a line', async () => {
    const { unmount } = render(<OfficeView client={client(() => drawer({ terminal: null, run: null }))} openId="a1" />);
    await screen.findByRole('region', { name: 'Scout drawer' });
    expect(screen.queryByLabelText('Scout terminal')).toBeNull();
    unmount();
    render(<OfficeView client={client(() => drawer({ terminal: { runId: 'r', status: 'running', lines: [{ kind: 'say', text: '<img src=x onerror=alert(1)>' }] } }))} openId="a1" />);
    expect((await screen.findByLabelText('Scout terminal')).querySelector('img')).toBeNull();
  });

  it('looks again while a run is going, so the terminal follows it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const c = client(() => drawer({ terminal: { runId: 'r1', status: 'running', lines: [{ kind: 'say', text: `step ${n++}` }] } }));
    render(<OfficeView client={c} openId="a1" />);
    await screen.findByLabelText('Scout terminal');
    const first = (c.drawer as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => expect((c.drawer as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(first));
    expect(screen.getByLabelText('Scout terminal').textContent).not.toBe('step 0');
  });

  it('does not keep looking when no run is going', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = client(() => drawer({ run: null }));
    render(<OfficeView client={c} openId="a1" />);
    await screen.findByLabelText('Scout terminal');
    const first = (c.drawer as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(7000);
    expect((c.drawer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(first);
  });
});
