// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthView, type HealthClient } from '../components/HealthView';
import type { HealthOverview } from '../lib/api';

afterEach(cleanup);

const overview = (over: Partial<HealthOverview> = {}): HealthOverview => ({
  generatedAt: '2026-11-13T12:00:00Z',
  windowHours: 24,
  killSwitch: { on: false, at: null },
  queue: { todo: 0, in_progress: 0, blocked: 0 },
  agents: [],
  breakers: [],
  pauses: [],
  reaper: null,
  database: { sizeBytes: 12 * 1024 * 1024 },
  reroutes: [],
  ...over,
});
const agent = (over = {}) => ({ id: 'a1', key: 'prospector', name: 'Prospector', runs: 4, failed: 1, failureRate: 0.25, spentThisMonth: 1.5, budget: 5, overBudget: false, ...over });
const client = (o: HealthOverview | Error) =>
  ({
    overview: vi.fn(async () => (o instanceof Error ? Promise.reject(o) : o)),
    setKillSwitch: vi.fn(async () => undefined),
    resetBreaker: vi.fn(async () => undefined),
    liftPause: vi.fn(async () => undefined),
  }) satisfies HealthClient;

describe('the Health page (S3-7)', () => {
  it('says all is well, plainly, when nothing is wrong', async () => {
    render(<HealthView client={client(overview())} />);
    expect(await screen.findByText(/nothing needs attention/i)).toBeTruthy();
    expect(screen.getByText(/no runs in the last 24 hours/i)).toBeTruthy();
    expect(screen.getByText(/12 MB/)).toBeTruthy();
    expect(screen.getByText(/has not run since the server started/i)).toBeTruthy();
  });

  it('shows the queue and each agent with its failure rate and spend', async () => {
    render(<HealthView client={client(overview({ queue: { todo: 3, in_progress: 1, blocked: 2 }, agents: [agent()] }))} />);
    expect(await screen.findByText('Prospector')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText(/\$1\.50 of \$5\.00/)).toBeTruthy();
    expect(screen.getByLabelText('queue').textContent).toMatch(/3 waiting/);
    expect(screen.getByLabelText('queue').textContent).toMatch(/2 blocked/);
  });

  it('flags an agent that is over its budget', async () => {
    render(<HealthView client={client(overview({ agents: [agent({ spentThisMonth: 6, overBudget: true })] }))} />);
    expect(await screen.findByText(/over budget/i)).toBeTruthy();
    expect(screen.queryByText(/nothing needs attention/i)).toBeNull();
  });

  it('shows an open breaker and resets it on request', async () => {
    const c = client(overview({ breakers: [{ key: 'os:add_lead', failures: 3, lastError: 'connection refused', openedAt: null, openUntil: '2026-11-13T12:05:00Z' }] }));
    render(<HealthView client={c} />);
    expect(await screen.findByText('os:add_lead')).toBeTruthy();
    expect(screen.getByText(/connection refused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reset os:add_lead/i }));
    await waitFor(() => expect(c.resetBreaker).toHaveBeenCalledWith('os:add_lead'));
    await waitFor(() => expect(c.overview).toHaveBeenCalledTimes(2)); // reloaded
  });

  it('shows a paused runtime and lifts the pause on request', async () => {
    const c = client(overview({ pauses: [{ runtime: 'claude-cli', label: 'Claude Code', until: '2026-11-13T17:00:00Z', reason: 'usage limit' }] }));
    render(<HealthView client={c} />);
    expect(await screen.findByText(/Claude Code is paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /lift pause/i }));
    await waitFor(() => expect(c.liftPause).toHaveBeenCalledWith('claude-cli'));
  });

  it('turns the kill switch on after a confirm, and off without one', async () => {
    const c = client(overview());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<HealthView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn the kill switch on/i }));
    await waitFor(() => expect(c.setKillSwitch).toHaveBeenCalledWith(true));
    expect(confirm).toHaveBeenCalled();
    cleanup();
    const on = client(overview({ killSwitch: { on: true, at: '2026-11-13T11:00:00Z' } }));
    confirm.mockClear();
    render(<HealthView client={on} />);
    expect(await screen.findByText(/kill switch is on/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /turn the kill switch off/i }));
    await waitFor(() => expect(on.setKillSwitch).toHaveBeenCalledWith(false));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('does not turn the switch on if the confirm is declined', async () => {
    const c = client(overview());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<HealthView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn the kill switch on/i }));
    expect(c.setKillSwitch).not.toHaveBeenCalled();
  });

  it('lists the work that was moved to another engine, and why', async () => {
    render(<HealthView client={client(overview({ reroutes: [{ agent: 'prospector', from: 'claude-cli', to: 'openai-agents', reason: 'paused', at: '2026-11-13T11:00:00Z' }] }))} />);
    expect(await screen.findByText(/prospector moved from claude-cli to openai-agents/i)).toBeTruthy();
    expect(screen.getByText(/plan limit/i)).toBeTruthy();
  });

  it('shows the last reaper pass', async () => {
    render(<HealthView client={client(overview({ reaper: { at: '2026-11-13T11:59:00Z', reaped: 2, requeued: 1, blocked: 0 } }))} />);
    expect(await screen.findByText(/failed 2 silent runs/i)).toBeTruthy();
  });

  it('says so, with the address, when the server cannot be reached', async () => {
    render(<HealthView client={client(new Error('Failed to fetch'))} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot reach the server/i);
  });
});
