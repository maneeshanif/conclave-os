'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface AgentClient {
  templates(): Promise<string[]>;
  propose(p: { department: string; template: string; name?: string }): Promise<{ approvalId: string; id: string }>;
}
export const realAgentClient: AgentClient = { templates: api.agentTemplates, propose: api.proposeAgent };

/**
 * Adding an agent (S6-13c): pick a department and a template, and optionally a name. This only makes a proposal; a person approves it
 * in Approvals, and only then is the agent added (the same way `pnpm agent:new` adds one). No code is written for the agent.
 */
export function AddAgent({
  client = realAgentClient,
  departments,
  onOpenApprovals,
  onCancel,
}: {
  client?: AgentClient;
  departments: { key: string; name: string }[];
  onOpenApprovals: () => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [department, setDepartment] = useState(departments[0]?.key ?? '');
  const [template, setTemplate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .templates()
      .then((t) => {
        if (!live) return;
        setTemplates(t);
        setTemplate(t[0] ?? '');
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [client]);

  async function propose() {
    if (busy || !department || !template) return;
    setBusy(true);
    setError(null);
    try {
      await client.propose({ department, template, ...(name.trim() ? { name: name.trim() } : {}) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white';
  return (
    <div role="dialog" aria-label="Add an agent" className="px-pop px-font absolute inset-x-3 top-14 z-40 mx-auto max-w-sm space-y-3 p-4">
      <h3 className="text-sm font-semibold">Add an agent</h3>
      {sent ? (
        <>
          <p className="text-sm text-neutral-200">Proposed. It is waiting for your approval; the agent is added only when you approve it.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={onCancel}>
              Close
            </button>
            <button type="button" className="px-btn px-3 py-1.5 text-sm" onClick={onOpenApprovals}>
              Open approvals
            </button>
          </div>
        </>
      ) : (
        <>
          {failed ? <p className="text-xs text-red-300">Cannot load the templates. Is the server running?</p> : null}
          <label className="block text-xs text-neutral-300">
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={field}>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-neutral-300">
            Template
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className={field}>
              {templates?.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-neutral-300">
            Name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={field} />
          </label>
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" disabled={busy || !department || !template} onClick={() => void propose()} className="px-btn px-3 py-1.5 text-sm">
              Propose
            </button>
          </div>
        </>
      )}
    </div>
  );
}
