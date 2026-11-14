'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PANEL_LABELS, type PanelState } from '../lib/panels';
import { Button } from './ui/button';

/**
 * One panel over the world (SPEC 12): a side panel on the right from tablet width up, with the world still showing beside it,
 * and the whole screen on a phone. It closes with its button or Escape. It can be made wider. What is inside is given to it.
 */
export function PanelHost({ state, onClose, render }: { state: PanelState | null; onClose: () => void; render: (s: PanelState) => ReactNode }) {
  const [wide, setWide] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!state) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  if (!state) return null;
  const width = wide ? 'sm:w-[min(72rem,92vw)]' : 'sm:w-[min(42rem,56vw)]';
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-label={PANEL_LABELS[state.id]}
      tabIndex={-1}
      className={`fixed inset-0 z-40 flex flex-col overflow-hidden bg-white shadow-2xl outline-none sm:left-auto sm:border-l sm:border-neutral-200 ${width}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2">
        <h2 className="text-base font-semibold">{PANEL_LABELS[state.id]}</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="hidden h-8 px-2 text-xs sm:inline-flex" onClick={() => setWide(!wide)}>
            {wide ? 'Restore size' : 'Maximize'}
          </Button>
          <Button type="button" variant="outline" className="h-8 px-3 text-sm" aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{render(state)}</div>
    </aside>
  );
}
