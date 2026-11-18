'use client';

import { useCallback, useEffect, useState } from 'react';
import { API, api, type ConfigView, type SendSettings, type ToolCall } from '../lib/api';
import { Button } from './ui/button';

export interface SettingsClient {
  config(): Promise<ConfigView>;
  sends(): Promise<SendSettings>;
  toolCalls(): Promise<ToolCall[]>;
  putPolicy(p: { level?: 'H0' | 'H1'; rosterCap?: number; trialBudgetCapUsd?: number }): Promise<unknown>;
  putAgent(key: string, p: { selfWriting?: boolean; autonomy?: number }): Promise<unknown>;
  putGuestHours(hours: number): Promise<unknown>;
  putReleaseChannel(channel: 'stable' | 'beta' | 'nightly'): Promise<unknown>;
  putTaskWatchdog(on: boolean): Promise<unknown>;
  patchSends(p: Partial<Pick<SendSettings, 'windowHours' | 'windowCap' | 'emailDailyCap'>>): Promise<unknown>;
  delegate(op: 'register' | 'on' | 'off' | 'revoke'): Promise<unknown>;
  putMandate(rule: { kind: 'email.send'; minStep: number; maxStep: number }): Promise<unknown>;
  dropMandate(kind: string): Promise<unknown>;
}

const real: SettingsClient = {
  config: api.config,
  sends: api.sendSettings,
  toolCalls: api.toolCalls,
  putPolicy: api.putPolicy,
  putAgent: api.putConfigAgent,
  putGuestHours: api.putGuestHours,
  putReleaseChannel: api.putReleaseChannel,
  putTaskWatchdog: api.putTaskWatchdog,
  patchSends: api.patchSends,
  delegate: api.delegateOp,
  putMandate: api.putMandate,
  dropMandate: api.dropMandate,
};

const field = 'rounded border border-slate-300 px-2 py-1 text-sm';

/**
 * Settings (SPEC 12, rule 8): what a person may set is set here, not in code or SQL. Hiring, each agent's level and self-writing, the delegate and
 * its mandate, send limits, how long a guest link lasts, and a read of the tool-call log. Connectors are shown by name (they are chosen when the
 * server starts) and a key only as set or not set. Every change says what happened; a refusal shows the server's reason.
 */
export function SettingsView({ client = real }: { client?: SettingsClient }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [sends, setSends] = useState<SendSettings | null>(null);
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState('');
  const [hours, setHours] = useState('');
  const [steps, setSteps] = useState({ min: '2', max: '3' });

  const load = useCallback(async () => {
    try {
      const [c, s, t] = await Promise.all([client.config(), client.sends(), client.toolCalls()]);
      setCfg(c);
      setSends(s);
      setCalls(t);
      setCap(String(c.hiring.rosterCap));
      setHours(String(c.guestLinkHours));
      setError(null);
    } catch (err) {
      setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, then looks again. A refusal shows the reason the server gave. */
  async function change(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setNote(`${what}: done.`);
    } catch (err) {
      setNote(`${what}: ${(err as Error).message}`);
    }
    await load();
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!cfg || !sends) return <p className="text-sm text-slate-500">Loading…</p>;
  const d = cfg.delegate;
  return (
    <div className="space-y-6 text-sm">
      {note ? (
        <p role="status" className="rounded bg-slate-100 px-2 py-1">
          {note}
        </p>
      ) : null}

      <section aria-label="Hiring">
        <h3 className="font-semibold">Hiring</h3>
        <p className="text-slate-600">
          {cfg.hiring.active} of {cfg.hiring.rosterCap} active agents. H0: every hire comes to you. H1: a hire inside the mandate starts on trial by itself.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label>
            Level{' '}
            <select aria-label="Hiring level" className={field} value={cfg.hiring.level} onChange={(e) => void change('Hiring level', () => client.putPolicy({ level: e.target.value as 'H0' | 'H1' }))}>
              <option value="H0">H0</option>
              <option value="H1">H1</option>
            </select>
          </label>
          <label>
            Roster cap <input aria-label="Roster cap" className={`${field} w-20`} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
          <Button type="button" variant="outline" onClick={() => void change('Roster cap', () => client.putPolicy({ rosterCap: Number(cap) }))}>
            Save cap
          </Button>
        </div>
      </section>

      <section aria-label="Agents">
        <h3 className="font-semibold">Agents</h3>
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs text-slate-500">
              <th>Agent</th>
              <th>Level</th>
              <th>May edit its own skills</th>
            </tr>
          </thead>
          <tbody>
            {cfg.agents.map((a) => (
              <tr key={a.key}>
                <td>
                  {a.name} <span className="text-xs text-slate-500">({a.department ?? 'none'}, {a.status})</span>
                </td>
                <td>
                  <select aria-label={`Level of ${a.name}`} className={field} value={a.autonomy} onChange={(e) => void change(`Level of ${a.name}`, () => client.putAgent(a.key, { autonomy: Number(e.target.value) }))}>
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" aria-label={`Self-writing for ${a.name}`} checked={a.selfWriting} onChange={(e) => void change(`Self-writing for ${a.name}`, () => client.putAgent(a.key, { selfWriting: e.target.checked }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Delegate">
        <h3 className="font-semibold">Delegate</h3>
        {!d.registered ? (
          <>
            <p className="text-slate-600">No delegate yet. It would clear routine approvals in your name, inside a limit you set.</p>
            <Button type="button" variant="outline" onClick={() => void change('Delegate', () => client.delegate('register'))}>
              Register a delegate
            </Button>
          </>
        ) : (
          <>
            <p className="text-slate-600">
              Fingerprint {d.fingerprint}. {d.revoked ? 'Revoked.' : d.active ? 'Switched on.' : 'Switched off.'} Follow-up emails you have decided by hand: {d.handDecisions['email.send'] ?? 0} of {d.handDecisionsNeeded} needed before a mandate.
            </p>
            {!d.revoked ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void change('Delegate', () => client.delegate(d.active ? 'off' : 'on'))}>
                  {d.active ? 'Switch off' : 'Switch on'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void change('Delegate', () => client.delegate('revoke'))}>
                  Revoke
                </Button>
              </div>
            ) : null}
            <p className="mt-2">Mandate: {Object.keys(d.mandate).length ? Object.entries(d.mandate).map(([k, v]) => `${k} steps ${(v as { minStep?: number }).minStep ?? 2} to ${(v as { maxStep?: number }).maxStep ?? 3}`).join('; ') : 'nothing yet'}</p>
            {!d.revoked ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label>
                  Follow-up steps from <input aria-label="First step" className={`${field} w-14`} value={steps.min} onChange={(e) => setSteps({ ...steps, min: e.target.value })} />
                </label>
                <label>
                  to <input aria-label="Last step" className={`${field} w-14`} value={steps.max} onChange={(e) => setSteps({ ...steps, max: e.target.value })} />
                </label>
                <Button type="button" variant="outline" onClick={() => void change('Mandate', () => client.putMandate({ kind: 'email.send', minStep: Number(steps.min), maxStep: Number(steps.max) }))}>
                  Allow
                </Button>
                {d.mandate['email.send'] ? (
                  <Button type="button" variant="outline" onClick={() => void change('Mandate', () => client.dropMandate('email.send'))}>
                    Remove
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section aria-label="Sending">
        <h3 className="font-semibold">Sending limits</h3>
        <p className="text-slate-600">
          {sends.sentInWindow} sent in the last {sends.windowHours} hours (limit {sends.windowCap}); {sends.sentToday} today (limit {sends.emailDailyCap}).
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {(['windowHours', 'windowCap', 'emailDailyCap'] as const).map((k) => (
            <label key={k}>
              {k === 'windowHours' ? 'Window (hours)' : k === 'windowCap' ? 'Per window' : 'Per day'}{' '}
              <input
                aria-label={k === 'windowHours' ? 'Window hours' : k === 'windowCap' ? 'Per window' : 'Per day'}
                className={`${field} w-20`}
                defaultValue={sends[k]}
                inputMode="numeric"
                onBlur={(e) => {
                  if (Number(e.target.value) !== sends[k]) void change('Sending limit', () => client.patchSends({ [k]: Number(e.target.value) }));
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section aria-label="Meetings">
        <h3 className="font-semibold">Client meetings</h3>
        <div className="flex items-center gap-2">
          <label>
            A guest link lasts (hours) <input aria-label="Guest link hours" className={`${field} w-20`} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <Button type="button" variant="outline" onClick={() => void change('Guest link hours', () => client.putGuestHours(Number(hours)))}>
            Save
          </Button>
        </div>
      </section>

      <section aria-label="Watchdog">
        <h3 className="font-semibold">Task watchdog</h3>
        <label className="flex items-center gap-2">
          <input type="checkbox" aria-label="Task watchdog" checked={cfg.taskWatchdog} onChange={(e) => void change('Task watchdog', () => client.putTaskWatchdog(e.target.checked))} />
          Put a wrongly stopped task back in line, once (stuck with no run, done with nothing to show, or waiting for an approval that is gone). Off by default.
        </label>
      </section>

      <section aria-label="Updates">
        <h3 className="font-semibold">Updates</h3>
        <p className="text-slate-600">Which releases you are offered. Stable is the steadiest; beta sees beta and stable; nightly sees everything. An update is only offered if it is newer and passes its smoke check.</p>
        <label>
          Channel{' '}
          <select aria-label="Release channel" className={field} value={cfg.releaseChannel} onChange={(e) => void change('Release channel', () => client.putReleaseChannel(e.target.value as 'stable' | 'beta' | 'nightly'))}>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
            <option value="nightly">nightly</option>
          </select>
        </label>
      </section>

      <section aria-label="Connectors">
        <h3 className="font-semibold">Connectors</h3>
        <p className="text-slate-600">Chosen when the server starts, so changing one takes a restart. Keys are never shown here.</p>
        <ul>
          <li>Code host: {cfg.connectors.git}</li>
          <li>Meetings: {cfg.connectors.meeting}</li>
          <li>Claude Agent key: {cfg.connectors.claudeAgentKey}</li>
          <li>http workers: {cfg.connectors.httpWorkers}</li>
        </ul>
      </section>

      <section aria-label="Tool calls">
        <h3 className="font-semibold">Recent tool calls</h3>
        {calls.length === 0 ? <p className="text-slate-500">No tool calls yet.</p> : null}
        <ul>
          {calls.map((c, i) => (
            <li key={i} className={c.decision === 'refused' ? 'text-amber-700' : undefined}>
              {c.agent ?? 'system'} · {c.tool} ({c.risk}) · {c.decision}
              {c.reason ? `: ${c.reason}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
