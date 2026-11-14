'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel, type PanelId } from '../lib/panels';
import { OfficeView, realOfficeClient } from './OfficeView';
import { OfficeWorld } from './OfficeWorld';
import { PanelContent } from './PanelContent';
import { PanelHost } from './PanelHost';

/**
 * The office with its panels (SPEC 12). The world above the plain list; using an object (in the world or in the list) opens its
 * panel over the office, kept in the address; walking up to an agent opens its drawer in the list. `base` is the page the office
 * is served on.
 */
export function OfficeScreen({ base = '/' }: { base?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const state = parsePanel(params);
  const show = useCallback(
    (id: string) => {
      if (!(PANEL_IDS as readonly string[]).includes(id)) return;
      if (id !== 'run-log') return router.push(panelHref(id as PanelId, base));
      // The terminal: show the run log of the newest task that has run, or the tasks panel if nothing has run (or the server is down).
      void api
        .tasks()
        .then((list) => list.find((t) => t.last_run_id))
        .catch(() => undefined)
        .then((t) => router.push(t ? panelHref({ id: 'run-log', task: t.id }, base) : panelHref('tasks', base)));
    },
    [router, base],
  );
  const close = useCallback(() => router.push(base), [router, base]);
  return (
    <div className="space-y-6">
      <OfficeWorld client={realOfficeClient} onOpen={setOpen} onPanel={show} />
      <OfficeView client={realOfficeClient} openId={open} onPanel={show} />
      <PanelHost state={state} onClose={close} render={PanelContent} />
    </div>
  );
}
