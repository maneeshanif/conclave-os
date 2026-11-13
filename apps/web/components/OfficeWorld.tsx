'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { OfficeMap } from '@conclave/shared';
import { API, type OfficeFacts, type OfficePlace } from '../lib/api';
import { WorldController } from '../office/controller';
import type { OfficeClient } from './OfficeView';

/** Strings of # and . from the server back into the grid of booleans the walking code uses. */
export const toMap = (facts: OfficeFacts): OfficeMap => ({ ...facts.map, walls: facts.map.walls.map((row) => [...row].map((c) => c === '#')) });

/**
 * The office as a world you can walk about (SPEC 12). Phaser is loaded only here, only in the browser, so the server render and
 * the plain list never pull it in. A hidden tab stops the drawing; a phone gets a smaller canvas (the list below is the main way in).
 */
export function OfficeWorld({ client, onOpen }: { client: OfficeClient; onOpen: (agentId: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<WorldController | null>(null);
  const [whole, setWhole] = useState(false);

  useEffect(() => {
    let stop = () => undefined;
    let cancelled = false;
    void (async () => {
      try {
        const facts = await client.office();
        if (cancelled || !box.current) return;
        const ctl = new WorldController(toMap(facts));
        const names = new Map(facts.agents.map((a) => [a.id, a.name]));
        const apply = (places: OfficePlace[]) => ctl.setAgents(places.map((p) => ({ agentId: p.agentId, x: p.x, y: p.y })));
        apply(await client.state());
        ctl.onDrawer((e) => onOpen(e.kind === 'open' ? e.id : null));
        const { startWorld } = await import('../office/scene');
        if (cancelled || !box.current) return;
        const world = startWorld({ parent: box.current, mapUrl: `${API}/api/office/map`, tilesUrl: '/office/tiles.png', facts, ctl, names: () => names, onUseObject: (href) => router.push(href) });
        setView(ctl);
        const watch = new ResizeObserver(() => world.resize());
        watch.observe(box.current);
        const onVis = () => world.setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVis);
        const unlive = client.live((m) => {
          if (m.kind === 'office.changed') void client.state().then(apply);
        });
        stop = () => {
          watch.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          unlive();
          world.destroy();
        };
      } catch (err) {
        setFailed((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [client, onOpen, router]);

  if (failed) return <p className="text-sm text-neutral-500">The world could not start ({failed}). The list below has everything.</p>;
  const btn = 'flex h-9 w-9 items-center justify-center rounded-md bg-neutral-900/80 text-lg text-white hover:bg-neutral-900';
  return (
    <div className="relative">
      <div ref={box} data-testid="office-world" aria-hidden="true" className="h-60 w-full overflow-hidden rounded-md border border-neutral-200 sm:h-96" />
      {view ? (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          <button type="button" aria-label="Zoom in" className={btn} onClick={() => view.zoomIn()}>
            +
          </button>
          <button type="button" aria-label="Zoom out" className={btn} onClick={() => view.zoomOut()}>
            −
          </button>
          <button
            type="button"
            aria-label={whole ? 'Back to close up' : 'See the whole office'}
            aria-pressed={whole}
            className={btn}
            onClick={() => {
              view.overview(!whole);
              setWhole(!whole);
            }}
          >
            ⌗
          </button>
        </div>
      ) : null}
    </div>
  );
}
