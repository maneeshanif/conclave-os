'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API, api, type VideoIdea } from '../lib/api';
import { Button } from './ui/button';
import { Textarea } from './ui/field';

export interface IdeasClient {
  ideas(stage?: string): Promise<VideoIdea[]>;
  add(idea: string, kind: 'line' | 'voice'): Promise<unknown>;
  shelve(id: string): Promise<unknown>;
  unshelve(id: string): Promise<unknown>;
  toBrief(id: string): Promise<unknown>;
}

const real: IdeasClient = { ideas: api.videoIdeas, add: api.addVideoIdea, shelve: (id) => api.moveVideoIdea(id, 'shelve'), unshelve: (id) => api.moveVideoIdea(id, 'unshelve'), toBrief: (id) => api.moveVideoIdea(id, 'brief') };

const TABS = [
  { stage: 'idea', label: 'Ideas' },
  { stage: 'brief', label: 'Briefs' },
  { stage: 'shelved', label: 'Shelved' },
] as const;

const webAddress = (u: string) => /^https?:\/\//i.test(u) && URL.canParse(u);

/** The Video Ideas inbox (SPEC 8, 12): a box to drop an idea into, from a phone or the desk, and what is in it. Text is shown as text. */
export function IdeasView({ client = real }: { client?: IdeasClient }) {
  const [tab, setTab] = useState<string>('idea');
  const [rows, setRows] = useState<VideoIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(false);
  const busy = useRef(false);

  const load = useCallback(
    async (stage: string) => {
      try {
        setRows(await client.ideas(stage));
        setError(null);
      } catch (err) {
        setError(`Cannot reach the server at ${API}. Is \`pnpm dev\` running? (${(err as Error).message})`);
      }
    },
    [client],
  );
  useEffect(() => {
    setRows(null);
    void load(tab);
  }, [load, tab]);

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      after?.();
      await load(tab);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy.current = false;
    }
  }

  return (
    <section aria-labelledby="ideas-title" className="space-y-4">
      <h1 id="ideas-title" className="text-xl font-semibold">
        Video ideas
      </h1>
      <div className="space-y-2">
        <label htmlFor="new-idea" className="text-sm font-medium">
          New idea
        </label>
        <Textarea id="new-idea" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="A line, a link, or what you said out loud" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> This is a voice note (pasted transcript)
          </label>
          <Button
            onClick={() => {
              const t = text.trim();
              if (!t) return;
              void act(() => client.add(t, voice ? 'voice' : 'line'), () => {
                setText('');
                setVoice(false);
              });
            }}
          >
            Add idea
          </Button>
        </div>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.stage} role="tab" aria-selected={t.stage === tab} onClick={() => setTab(t.stage)} className={`rounded-md border px-3 py-1.5 text-sm ${t.stage === tab ? 'border-neutral-900 bg-neutral-100 font-medium' : 'border-neutral-300'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="text-sm text-neutral-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-neutral-600">No ideas yet{tab === 'idea' ? '. Add the first one above.' : ' here.'}</p>}
      <ul className="space-y-3">
        {rows?.map((i) => (
          <li key={i.id}>
            <article className="space-y-2 rounded-md border border-neutral-200 p-3">
              <p className="text-xs text-neutral-500">
                {i.kind === 'voice' ? 'Voice note' : i.kind === 'link' ? 'Link' : 'Idea'} · {i.source === 'hook_scout' ? 'from the Hook Scout' : 'from you'} · {new Date(i.createdAt).toLocaleDateString()}
              </p>
              {i.url && webAddress(i.url) ? (
                <a href={i.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">
                  {i.url}
                </a>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-900">{i.idea}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {i.stage === 'idea' && <Button onClick={() => void act(() => client.toBrief(i.id))}>Turn into a brief</Button>}
                {i.stage === 'idea' && (
                  <Button variant="outline" onClick={() => void act(() => client.shelve(i.id))}>
                    Shelve
                  </Button>
                )}
                {i.stage === 'shelved' && (
                  <Button variant="outline" onClick={() => void act(() => client.unshelve(i.id))}>
                    Bring back
                  </Button>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
