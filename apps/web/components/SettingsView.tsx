'use client';

import { useCallback, useEffect, useState } from 'react';
import { API, api, type ConfigView, type SendSettings, type ToolCall } from '../lib/api';
import { Button } from './ui/button';

export interface SettingsClient {
  config(): Promise<ConfigView>;
  sends(): Promise<SendSettings>;
  toolCalls(): Promise<ToolCall[]>;
  putPolicy(p: { level?: 'H0' | 'H1'; rosterCap?: number; trialBudgetCapUsd?: number }): Promise<unknown>;
  putAgent(key: string, p: { selfWriting?: boolean; autonomy?: number; runtime?: string; modelAlias?: string; trust?: string }): Promise<unknown>;
  /** A correction to what an agent has spent this month (A5): adds or takes off an amount, with a reason. Runs are never edited. */
  /** Switches which connector is used (no restart). Names only. */
  putConnectors(p: { git?: string; meeting?: string }): Promise<unknown>;
  /** Replaces the list of outside web pages that may open in a panel. */
  putEmbeddedTools(tools: { name: string; url: string }[]): Promise<unknown>;
  postSpend(key: string, p: { usd: number; reason: string }): Promise<unknown>;
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
  postSpend: api.postSpend,
  putConnectors: api.putConnectors,
  putEmbeddedTools: api.putEmbeddedTools,
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
  const [embed, setEmbed] = useState({ name: '', url: '' });
  const [fix, setFix] = useState({ key: '', usd: '', reason: '' });
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
              <th>Runtime</th>
              <th>Model</th>
              <th>Trust</th>
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
                  <select aria-label={`Runtime of ${a.name}`} className={field} value={a.runtime} onChange={(e) => void change(`Runtime of ${a.name}`, () => client.putAgent(a.key, { runtime: e.target.value }))}>
                    {cfg.stack.runtimes.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select aria-label={`Model of ${a.name}`} className={field} value={a.modelAlias} onChange={(e) => void change(`Model of ${a.name}`, () => client.putAgent(a.key, { modelAlias: e.target.value }))}>
                    {cfg.stack.models.filter((m) => m.on.includes(a.runtime) || m.name === a.modelAlias).map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                        {m.remote ? ' (leaves this machine)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select aria-label={`Trust of ${a.name}`} title="Low: for an agent that reads hostile input (inbound mail, untrusted pages). Its output reaches others as labelled data, its tools are the base set, and it cannot edit skills." className={field} value={a.trust} onChange={(e) => void change(`Trust of ${a.name}`, () => client.putAgent(a.key, { trust: e.target.value }))}>
                    <option value="standard">standard</option>
                    <option value="low">low (reads hostile input)</option>
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

      <section aria-label="Spend correction">
        <h3 className="font-semibold">Spend correction</h3>
        <p className="text-xs text-slate-500">Add or take off an amount from what an agent has spent this month, with a reason. The runs are not changed, and the correction is kept in the audit log.</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const usd = Number(fix.usd);
            if (!fix.key || !Number.isFinite(usd) || usd === 0 || fix.reason.trim().length < 3) {
              setNote('Spend correction: pick an agent, give an amount that is not zero, and say why.');
              return;
            }
            void change('Spend correction', () => client.postSpend(fix.key, { usd, reason: fix.reason.trim() })).then(() => setFix({ key: fix.key, usd: '', reason: '' }));
          }}
        >
          <select aria-label="Agent to correct" className={field} value={fix.key} onChange={(e) => setFix({ ...fix, key: e.target.value })}>
            <option value="">Agent…</option>
            {cfg.agents.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
          </select>
          <input aria-label="Amount in dollars (negative takes off)" className={field} inputMode="decimal" placeholder="-2.50" value={fix.usd} onChange={(e) => setFix({ ...fix, usd: e.target.value })} />
          <input aria-label="Why" className={field} placeholder="Why" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
          <button type="submit" className="rounded border border-slate-400 px-2 py-1">
            Correct
          </button>
        </form>
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
        <p className="text-slate-600">Switch which one is used here, with no restart. Sign-ins and keys are yours to add and are never shown.</p>
        <ul>
          <li>
            <label>
              Code host{' '}
              <select aria-label="Code host" className={field} value={cfg.connectors.git} onChange={(e) => void change('Code host', () => client.putConnectors({ git: e.target.value }))}>
                {cfg.connectors.options.git.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </li>
          <li>
            <label>
              Meeting rooms{' '}
              <select aria-label="Meeting connector" className={field} value={cfg.connectors.meeting} onChange={(e) => void change('Meeting connector', () => client.putConnectors({ meeting: e.target.value }))}>
                {cfg.connectors.options.meeting.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </li>
          <li>Claude Agent key: {cfg.connectors.claudeAgentKey}</li>
          <li>http workers: {cfg.connectors.httpWorkers}</li>
        </ul>
      </section>

      <section aria-label="Embedded tools">
        <h3 className="font-semibold">Embedded tools</h3>
        <p className="text-slate-600">Outside web pages (a board, a doc, a whiteboard) that open in a panel in the office. Only https addresses of public sites; each is shown in a sandbox.</p>
        <ul>
          {cfg.embeddedTools.map((t) => (
            <li key={t.name}>
              {t.name}: <code>{t.url}</code>{' '}
              <button type="button" aria-label={`Remove ${t.name}`} className="underline" onClick={() => void change(`Remove ${t.name}`, () => client.putEmbeddedTools(cfg.embeddedTools.filter((x) => x.name !== t.name)))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void change('Embedded tools', () => client.putEmbeddedTools([...cfg.embeddedTools, { name: embed.name, url: embed.url }])).then(() => setEmbed({ name: '', url: '' }));
          }}
        >
          <input aria-label="Tool name" className={field} placeholder="Name" value={embed.name} onChange={(e) => setEmbed({ ...embed, name: e.target.value })} />
          <input aria-label="Tool address" className={field} placeholder="https://…" value={embed.url} onChange={(e) => setEmbed({ ...embed, url: e.target.value })} />
          <button type="submit" className="rounded border border-slate-400 px-2 py-1">
            Add
          </button>
        </form>
      </section>

      <section aria-label="Diagnostics">
        <h3 className="font-semibold">Diagnostics</h3>
        <p className="text-slate-600">
          Server {cfg.diagnostics.node}, up {Math.floor(cfg.diagnostics.uptimeSeconds / 60)} min, {cfg.diagnostics.memoryMb} MB. Keys are shown as set or not set, never their value. Add one in <code>.env</code> and restart (see docs/KEYS-GUIDE.md).
        </p>
        <ul className="grid gap-1 md:grid-cols-2">
          {cfg.diagnostics.keys.map((k) => (
            <li key={k.name}>
              <code>{k.name}</code>: {k.set ? 'set' : 'not set'} <span className="text-slate-500">({k.for}{k.usedByCode ? '' : '; connector not written yet'})</span>
            </li>
          ))}
        </ul>
        {cfg.diagnostics.failedProbes.length ? (
          <div>
            <p className="font-medium">Agents kept out of the loop (their folder failed its check):</p>
            <ul>
              {cfg.diagnostics.failedProbes.map((p) => (
                <li key={p.key}>
                  {p.key}: {p.problems.join('; ')}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-slate-600">Every agent folder passed its last check.</p>
        )}
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
