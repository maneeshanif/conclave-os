'use client';

import { useState } from 'react';

/** The megaphone (S6B-7): say something to everyone in the town, or pin it where everyone sees it, now and when they arrive. */
export function Megaphone({ pinned, onSend, onClose }: { pinned: { text: string; by: string } | null; onSend: (kind: 'announce' | 'pin', text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const t = text.trim();
  return (
    <div role="dialog" aria-label="Megaphone" className="px-pop px-font absolute inset-x-3 top-14 z-40 mx-auto max-w-sm space-y-3 p-4">
      <h3 className="text-sm font-semibold">Megaphone</h3>
      <p className="text-xs text-neutral-300">Everyone in the town sees it. An announcement shows for a few seconds; a pinned message stays until it is cleared.</p>
      <label className="block text-xs text-neutral-300">
        Message
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={200} rows={2} className="mt-1 w-full rounded-md bg-neutral-800 px-2 py-1.5 text-sm text-white" />
      </label>
      {pinned ? (
        <p className="text-xs text-neutral-300">
          Pinned by {pinned.by}: {pinned.text}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {pinned ? (
          <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={() => onSend('pin', '')}>
            Clear the pin
          </button>
        ) : null}
        <button type="button" className="px-3 py-1.5 text-sm text-neutral-300" onClick={onClose}>
          Close
        </button>
        <button type="button" disabled={!t} className="px-btn px-3 py-1.5 text-sm" onClick={() => onSend('pin', t)}>
          Pin it
        </button>
        <button
          type="button"
          disabled={!t}
          className="px-btn px-3 py-1.5 text-sm"
          onClick={() => {
            onSend('announce', t);
            setText('');
          }}
        >
          Announce
        </button>
      </div>
    </div>
  );
}

/** What everyone sees: the latest announcement across the top, and the pinned message under it. */
export function AnnouncementBanner({ announcement, pinned }: { announcement: { name: string; text: string } | null; pinned: { text: string; by: string } | null }) {
  if (!announcement && !pinned) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-20 mx-auto flex max-w-xl flex-col items-center gap-1 px-3 sm:top-16">
      {announcement ? (
        <p role="alert" className="px-pop px-font px-4 py-2 text-center text-sm">
          <span className="font-bold">{announcement.name}:</span> {announcement.text}
        </p>
      ) : null}
      {pinned ? (
        <p className="px-pill px-font px-3 py-1 text-center text-xs">
          📌 {pinned.text} <span className="text-neutral-300">(pinned by {pinned.by})</span>
        </p>
      ) : null}
    </div>
  );
}
