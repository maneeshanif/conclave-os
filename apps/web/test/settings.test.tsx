// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView, type SettingsClient } from '../components/SettingsView';
import type { ConfigView, SendSettings, ToolCall } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const cfg = (over: Partial<ConfigView> = {}): ConfigView => ({
  hiring: { level: 'H0', rosterCap: 20, trialBudgetCapUsd: 5, active: 7 },
  guestLinkHours: 48,
  agents: [
    { key: 'wren', name: 'Wren', department: 'outreach', status: 'active', autonomy: 1, selfWriting: false, runtime: 'claude-cli' },
    { key: 'kofi', name: 'Kofi', department: 'engineering', status: 'active', autonomy: 0, selfWriting: true, runtime: 'codex' },
  ],
  delegate: { registered: false, active: false, revoked: false, fingerprint: null, mandate: {}, handDecisions: {}, handDecisionsNeeded: 20 },
  connectors: { git: 'local', meeting: 'local', claudeAgentKey: 'not set', httpWorkers: 0 },
  ...over,
});
const sends: SendSettings = { killSwitch: false, windowHours: 5, windowCap: 30, emailDailyCap: 100, sentInWindow: 4, sentToday: 9 };
const calls: ToolCall[] = [{ tool: 'send_email', risk: 'unknown', decision: 'refused', reason: 'no such tool', at: '2026-11-20T10:00:00Z', agent: 'wren' }];
const client = (c: ConfigView | Error = cfg(), over: Partial<SettingsClient> = {}): SettingsClient & Record<string, ReturnType<typeof vi.fn>> =>
  ({
    config: vi.fn(async () => (c instanceof Error ? Promise.reject(c) : c)),
    sends: vi.fn(async () => sends),
    toolCalls: vi.fn(async () => calls),
    putPolicy: vi.fn(async () => ({})),
    putAgent: vi.fn(async () => ({})),
    putGuestHours: vi.fn(async () => ({})),
    patchSends: vi.fn(async () => ({})),
    delegate: vi.fn(async () => ({})),
    putMandate: vi.fn(async () => ({})),
    dropMandate: vi.fn(async () => ({})),
    ...over,
  }) as never;

describe('the Settings panel', () => {
  it('shows what can be set: hiring, each agent, the delegate, sending, meetings, connectors by name and the tool calls', async () => {
    render(<SettingsView client={client()} />);
    const hiring = await screen.findByLabelText('Hiring');
    expect(hiring.textContent).toMatch(/7 of 20 active agents/);
    expect(within(screen.getByLabelText('Agents')).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByLabelText('Delegate').textContent).toMatch(/No delegate yet/);
    expect(screen.getByLabelText('Sending').textContent).toMatch(/4 sent in the last 5 hours \(limit 30\); 9 today \(limit 100\)/);
    expect(screen.getByLabelText('Connectors').textContent).toMatch(/Code host: local/);
    expect(screen.getByLabelText('Connectors').textContent).toMatch(/Claude Agent key: not set/);
    expect(screen.getByLabelText('Tool calls').textContent).toMatch(/wren · send_email \(unknown\) · refused: no such tool/);
  });

  it('changes the hiring level, the roster cap, an agent\'s level and its self-writing, each through its own call, and looks again', async () => {
    const c = client();
    render(<SettingsView client={c} />);
    await screen.findByLabelText('Hiring');
    fireEvent.change(screen.getByLabelText('Hiring level'), { target: { value: 'H1' } });
    await waitFor(() => expect(c.putPolicy).toHaveBeenCalledWith({ level: 'H1' }));
    fireEvent.change(screen.getByLabelText('Roster cap'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cap' }));
    await waitFor(() => expect(c.putPolicy).toHaveBeenCalledWith({ rosterCap: 12 }));
    fireEvent.change(screen.getByLabelText('Level of Wren'), { target: { value: '2' } });
    await waitFor(() => expect(c.putAgent).toHaveBeenCalledWith('wren', { autonomy: 2 }));
    fireEvent.click(screen.getByLabelText('Self-writing for Wren'));
    await waitFor(() => expect(c.putAgent).toHaveBeenCalledWith('wren', { selfWriting: true }));
    expect((c.config as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(3);
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('registers a delegate, and with one registered switches it on, sets and removes its mandate, and shows how many decisions you have made by hand', async () => {
    const c1 = client();
    const { unmount } = render(<SettingsView client={c1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register a delegate' }));
    await waitFor(() => expect(c1.delegate).toHaveBeenCalledWith('register'));
    unmount();
    const withDelegate = cfg({ delegate: { registered: true, active: false, revoked: false, fingerprint: 'abcd1234abcd1234', mandate: { 'email.send': { kind: 'email.send', minStep: 2, maxStep: 3 } }, handDecisions: { 'email.send': 23 }, handDecisionsNeeded: 20 } });
    const c2 = client(withDelegate);
    render(<SettingsView client={c2} />);
    const del = await screen.findByLabelText('Delegate');
    expect(del.textContent).toMatch(/abcd1234abcd1234/);
    expect(del.textContent).toMatch(/23 of 20 needed/);
    expect(del.textContent).toMatch(/email\.send steps 2 to 3/);
    fireEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(c2.delegate).toHaveBeenCalledWith('on'));
    fireEvent.change(screen.getByLabelText('Last step'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(c2.putMandate).toHaveBeenCalledWith({ kind: 'email.send', minStep: 2, maxStep: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(c2.dropMandate).toHaveBeenCalledWith('email.send'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(c2.delegate).toHaveBeenCalledWith('revoke'));
  });

  it('shows the server\'s reason when a change is refused, and changes nothing on screen', async () => {
    const c = client(cfg({ delegate: { registered: true, active: false, revoked: false, fingerprint: 'f', mandate: {}, handDecisions: { 'email.send': 3 }, handDecisionsNeeded: 20 } }), { putMandate: vi.fn(async () => Promise.reject(new Error('You have decided email.send by hand 3 times. The delegate may take over a kind only after 20.'))) });
    render(<SettingsView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/only after 20/);
  });

  it('changes a guest-link lifetime and a sending limit, and says plainly when the server cannot be reached', async () => {
    const c = client();
    const { unmount } = render(<SettingsView client={c} />);
    await screen.findByLabelText('Meetings');
    fireEvent.change(screen.getByLabelText('Guest link hours'), { target: { value: '24' } });
    fireEvent.click(within(screen.getByLabelText('Meetings')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(c.putGuestHours).toHaveBeenCalledWith(24));
    const daily = screen.getByLabelText('Per day');
    fireEvent.change(daily, { target: { value: '50' } });
    fireEvent.blur(daily);
    await waitFor(() => expect(c.patchSends).toHaveBeenCalledWith({ emailDailyCap: 50 }));
    unmount();
    render(<SettingsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from a link and from the bar', () => {
    expect(PANEL_IDS as readonly string[]).toContain('settings');
    expect(panelHref('settings')).toBe('/?panel=settings');
    expect(parsePanel('?panel=settings')).toEqual({ id: 'settings' });
  });
});
