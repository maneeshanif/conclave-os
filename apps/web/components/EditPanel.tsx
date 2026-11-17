'use client';

import { PICTURES, type EditTool } from '../office/edit';

export type { EditTool };

/** Editing the office (S6B-9): pick a piece and click the world to put it down, or pick Remove and click a piece to take it away. */
export function EditPanel({ tool, message, onTool, onDone, onUndo }: { tool: EditTool | null; message: string | null; onTool: (t: EditTool) => void; onDone: () => void; /** Undo the last change (S6C-2). Left out, there is no button. */ onUndo?: () => void }) {
  return (
    <div role="dialog" aria-label="Edit the office" className="px-pop px-font absolute right-3 top-14 z-40 w-64 space-y-2 p-3 text-sm sm:top-16">
      <h3 className="text-sm font-semibold">Edit the office</h3>
      <p className="text-xs text-neutral-300">Pick a piece, then click a tile. A change that would cut a room, a desk or the door off is refused.</p>
      <div className="grid max-h-56 grid-cols-2 gap-1 overflow-auto">
        {PICTURES.map((p) => (
          <button
            key={p.name}
            type="button"
            aria-pressed={tool?.kind === 'place' && tool.name === p.name}
            onClick={() => onTool({ kind: 'place', name: p.name, turn: 0 })}
            className={`rounded px-2 py-1 text-left text-xs hover:bg-white/10 ${tool?.kind === 'place' && tool.name === p.name ? 'bg-white/20' : ''}`}
          >
            {p.name} ({p.w} by {p.h})
          </button>
        ))}
      </div>
      {tool?.kind === 'place' && tool.name === 'chair' ? (
        <button type="button" className="px-btn px-2 py-1 text-xs" onClick={() => onTool({ ...tool, turn: (tool.turn + 90) % 360 })}>
          Turn ({tool.turn}°)
        </button>
      ) : null}
      {tool?.kind === 'move' ? <p className="text-xs text-neutral-300">{tool.id === null ? 'Click the piece to move.' : 'Now click where it goes.'}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" aria-pressed={tool?.kind === 'move'} className={`px-btn px-2 py-1 text-xs ${tool?.kind === 'move' ? 'ring-2 ring-white' : ''}`} onClick={() => onTool({ kind: 'move', id: null })}>
          Move
        </button>
        {onUndo ? (
          <button type="button" className="px-btn px-2 py-1 text-xs" onClick={onUndo}>
            Undo
          </button>
        ) : null}
        <button type="button" aria-pressed={tool?.kind === 'remove'} className={`px-btn px-2 py-1 text-xs ${tool?.kind === 'remove' ? 'ring-2 ring-white' : ''}`} onClick={() => onTool({ kind: 'remove' })}>
          Remove
        </button>
        <button type="button" className="px-btn px-2 py-1 text-xs" onClick={onDone}>
          Done
        </button>
      </div>
      {message ? (
        <p role="status" className="text-xs text-amber-200">
          {message}
        </p>
      ) : null}
    </div>
  );
}
