'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatLine } from '../office/chat';

/**
 * The bubble that opens when someone is near you (S6-15c): who you are talking with, the lines, and a box to type in. Text only.
 * It is not there when nobody is near. The arrow keys stay in the box, so typing does not walk you around the office.
 */
export function ChatBubble({ near, lines, onSend }: { near: { id: string; name: string }[]; lines: ChatLine[]; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [lines.length]);
  if (!near.length) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  return (
    <section role="region" aria-label="Chat" className="px-pop px-font pointer-events-auto absolute bottom-16 left-1/2 z-10 w-[min(22rem,calc(100%-1rem))] -translate-x-1/2 p-3 text-sm sm:bottom-4">
      <p className="mb-2 text-xs text-neutral-300">Talking with {near.map((n) => n.name).join(', ')}</p>
      <div role="log" aria-live="polite" className="mb-2 max-h-32 space-y-1 overflow-auto">
        {lines.slice(-20).map((l, i) => (
          <p key={`${l.at}-${i}`} className={l.mine ? 'text-sky-200' : ''}>
            <span className="font-medium">{l.mine ? 'You' : l.name}: </span>
            {l.text}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label="Message"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-white placeholder:text-neutral-400"
          placeholder="Say something"
        />
        <button type="submit" className="px-btn px-3 py-1.5">
          Send
        </button>
      </form>
    </section>
  );
}
