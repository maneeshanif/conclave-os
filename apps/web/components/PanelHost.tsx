'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, loadPanelWidth, savePanelWidth } from '../lib/panel-width';
import { PANEL_LABELS, type PanelState } from '../lib/panels';
import { Button } from './ui/button';

/**
 * One panel over the world (SPEC 12): a side panel on the right from tablet width up, with the world still showing beside it,
 * and the whole screen on a phone. It closes with its button or Escape, can be dragged wider or narrower by its left edge
 * (double-click for the usual width; the width is remembered), or made as wide as it may be. What is inside is given to it.
 */
export function PanelHost({ state, onClose, render }: { state: PanelState | null; onClose: () => void; render: (s: PanelState) => ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [wide, setWide] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);

  // The remembered width, read after the first paint so the server render and the first paint agree.
  useEffect(() => {
    const saved = loadPanelWidth();
    if (saved) setWidth(clampPanelWidth(saved, window.innerWidth));
  }, []);

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

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The panel is pinned to the right, so dragging its left edge to the left makes it wider.
    setWide(false);
    setWidth(clampPanelWidth(drag.current.width + (drag.current.x - e.clientX), window.innerWidth));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    savePanelWidth(width);
  };
  const reset = () => {
    setWide(false);
    setWidth(DEFAULT_PANEL_WIDTH);
    savePanelWidth(DEFAULT_PANEL_WIDTH);
  };

  const shown = wide ? clampPanelWidth(Number.MAX_SAFE_INTEGER, window.innerWidth) : width;
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-label={PANEL_LABELS[state.id]}
      tabIndex={-1}
      style={{ '--panel-w': `${shown}px` } as React.CSSProperties}
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-white shadow-2xl outline-none sm:left-auto sm:w-[var(--panel-w)] sm:border-l sm:border-neutral-200"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize. Double-click for the usual width."
        className="absolute left-0 top-0 z-10 hidden h-full w-2 -translate-x-1 cursor-col-resize sm:block"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={reset}
      />
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2">
        <h2 className="text-base font-semibold">{PANEL_LABELS[state.id]}</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="hidden h-8 px-2 text-xs sm:inline-flex" onClick={() => (wide ? reset() : setWide(true))}>
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
