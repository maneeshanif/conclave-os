'use client';

import { useState } from 'react';

/** Adding a department (S6-13b): a name, and a room for it appears in the office. The page decides what happens when it is done. */
export function AddDepartment({ add, onDone, onCancel }: { add: (name: string) => Promise<unknown>; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await add(n);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="Add a department" className="px-pop px-font absolute inset-x-3 top-14 z-40 mx-auto max-w-sm space-y-3 p-4">
      <h3 className="text-sm font-semibold">Add a department</h3>
      <p className="text-xs text-neutral-300">It gets its own room with four desks, a board and a meeting table.</p>
      <label className="block text-xs text-neutral-300">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white" />
      </label>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={!name.trim() || busy} onClick={() => void create()} className="px-btn px-3 py-1.5 text-sm">
          Create
        </button>
      </div>
    </div>
  );
}
