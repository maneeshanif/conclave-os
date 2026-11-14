'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
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
      if ((PANEL_IDS as readonly string[]).includes(id)) router.push(panelHref(id as PanelId, base));
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
