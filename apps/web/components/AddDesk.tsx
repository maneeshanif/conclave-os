'use client';

import { useState } from 'react';

const MAX = 9;

/** Adding a desk (S6B-1): pick a department and its room gets the next desk, up to nine. The page decides what happens when it is done. */
export function AddDesk({ departments, add, onDone, onCancel }: { departments: { key: string; name: string; desks: number }[]; add: (key: string) => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const open = departments.filter((d) => d.desks < MAX);
  const [key, setKey] = useState(open[0]?.key ?? departments[0]?.key ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      await add(key);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="Add a desk" className="px-pop px-font absolute inset-x-3 top-14 z-40 mx-auto max-w-sm space-y-3 p-4">
      <h3 className="text-sm font-semibold">Add a desk</h3>
      <p className="text-xs text-neutral-300">A department room holds up to nine desks. The next one goes in the next free spot.</p>
      {open.length === 0 ? <p className="text-xs text-amber-300">Every department room is full.</p> : null}
      <label className="block text-xs text-neutral-300">
        Department
        <select value={key} onChange={(e) => setKey(e.target.value)} className="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white">
          {departments.map((d) => (
            <option key={d.key} value={d.key} disabled={d.desks >= MAX}>
              {d.name} ({d.desks >= MAX ? 'full' : `${d.desks} of ${MAX}`})
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={open.length === 0 || busy || !key} onClick={() => void go()} className="px-btn px-3 py-1.5 text-sm">
          Add a desk
        </button>
      </div>
    </div>
  );
}
