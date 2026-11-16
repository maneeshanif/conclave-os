'use client';

import { useEffect, useState } from 'react';
import { api, type CompanyList, type CompanySummary } from '../lib/api';
import { currentCompany, setCurrentCompany } from '../lib/company';

export interface CompanyClient {
  list(): Promise<CompanyList>;
  create(c: { name: string; template: string }): Promise<CompanySummary>;
}
const real: CompanyClient = { list: api.companies, create: api.createCompany };

const pill = 'px-pill px-font';
const item = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-white/10';

/**
 * Which company you are working in (S6-13a): shows it, lists the others to switch to, and makes a new one from a template. The page
 * decides what switching does (it reloads, so every panel, the world and the live socket start again in the new company).
 */
export function CompanySwitcher({ client = real, onSwitch }: { client?: CompanyClient; onSwitch: (id: string) => void }) {
  const [data, setData] = useState<CompanyList | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .list()
      .then((d) => {
        if (!live) return;
        setData(d);
        setTemplate(d.templates[0] ?? '');
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [client]);

  const mine = currentCompany() ?? data?.companies.find((c) => c.isDefault)?.id ?? null;
  const here = data?.companies.find((c) => c.id === mine);

  function choose(c: CompanySummary) {
    setOpen(false);
    if (c.id === mine) return;
    setCurrentCompany(c.isDefault ? null : c.id);
    onSwitch(c.id);
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const c = await client.create({ name: name.trim(), template });
      setCurrentCompany(c.id);
      onSwitch(c.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`relative ${pill}`}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Company: ${here?.name ?? '…'}`} onClick={() => setOpen(!open)} className="max-w-40 truncate px-3 py-2 text-sm">
        {here?.name ?? 'Company'} ▾
      </button>
      {open ? (
        <div role="menu" className={`absolute bottom-full left-0 z-30 mb-2 w-60 p-1 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 ${pill}`}>
          {failed ? <p className="px-3 py-2 text-sm text-red-300">Cannot load the companies. Is the server running?</p> : null}
          {data?.companies.map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === mine} className={item} onClick={() => choose(c)}>
              {c.name}
            </button>
          ))}
          {data ? (
            <button
              type="button"
              role="menuitem"
              className={`${item} border-t border-white/10`}
              onClick={() => {
                setOpen(false);
                setForm(true);
              }}
            >
              + New company…
            </button>
          ) : null}
        </div>
      ) : null}
      {form ? (
        <div role="dialog" aria-label="New company" className="px-pop px-font absolute left-0 top-full z-40 mt-2 w-72 space-y-3 p-4">
          <h3 className="text-sm font-semibold">New company</h3>
          <label className="block text-xs text-neutral-300">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white" />
          </label>
          <label className="block text-xs text-neutral-300">
            Template
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white">
              {data?.templates.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={() => setForm(false)}>
              Cancel
            </button>
            <button type="button" disabled={!name.trim() || busy} onClick={() => void create()} className="px-btn px-3 py-1.5 text-sm">
              Create
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
