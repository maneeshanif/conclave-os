'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel, type PanelId } from '../lib/panels';
import { OfficeView, realOfficeClient } from './OfficeView';
import { OfficeWorld } from './OfficeWorld';
import { PanelContent } from './PanelContent';
import { PanelHost } from './PanelHost';

/**
 * The office is the screen (SPEC 12, S6-15a). The world fills the whole window with the bar, the zoom buttons and the panels floating over it.
 * Using an object, or opening the list of rooms and agents, opens a panel over it, kept in the address; walking up to an agent opens the
 * list on that agent. The list (every room, agent and object as plain buttons) is the way in for a keyboard or a screen reader, and it
 * becomes the page when the world cannot start. `base` is the page the office is served on.
 */
export function OfficeScreen({ base = '/' }: { base?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const state = parsePanel(params);
  const [worldFailed, setWorldFailed] = useState(false);
  // The world is started once and must not start again because the page changed, so the callbacks it is given never change.
  const routerRef = useRef(router);
  routerRef.current = router;
  const stateRef = useRef(state);
  stateRef.current = state;

  const show = useCallback(
    (id: string, ctx?: { dept?: string }) => {
      if (!(PANEL_IDS as readonly string[]).includes(id)) return;
      if (id !== 'run-log') return routerRef.current.push(panelHref({ id: id as PanelId, ...(ctx?.dept ? { dept: ctx.dept } : {}) }, base));
      // The terminal: show the run log of the newest task that has run, or the tasks panel if nothing has run (or the server is down).
      void api
        .tasks()
        .then((list) => list.find((t) => t.last_run_id))
        .catch(() => undefined)
        .then((t) => routerRef.current.push(t ? panelHref({ id: 'run-log', task: t.id }, base) : panelHref('tasks', base)));
    },
    [base],
  );
  const close = useCallback(() => routerRef.current.push(base), [base]);
  const openList = useCallback(() => routerRef.current.push(panelHref('rooms', base)), [base]);
  const walkTo = useCallback(
    (agentId: string | null) => {
      if (agentId) return routerRef.current.push(panelHref({ id: 'rooms', agent: agentId }, base));
      // Walking away closes the drawer it opened, but not something you opened yourself.
      if (stateRef.current?.id === 'rooms' && stateRef.current.agent) routerRef.current.push(base);
    },
    [base],
  );
  const failed = useCallback(() => setWorldFailed(true), []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-neutral-100">
      {worldFailed ? (
        <section role="region" aria-label="Rooms and agents" className="mx-auto h-full max-w-3xl overflow-auto p-4 sm:p-6">
          <h1 className="mb-4 text-xl font-semibold">Office</h1>
          <OfficeView client={realOfficeClient} onPanel={show} />
        </section>
      ) : (
        <OfficeWorld client={realOfficeClient} onOpen={walkTo} onPanel={show} onOpenList={openList} onFail={failed} />
      )}
      <PanelHost state={state} onClose={close} render={(s) => (s.id === 'rooms' ? <OfficeView client={realOfficeClient} openId={s.agent ?? null} onPanel={show} /> : PanelContent(s))} />
    </div>
  );
}
