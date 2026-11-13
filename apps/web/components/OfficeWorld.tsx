'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { zoneNotice, type OfficeMap } from '@conclave/shared';
import { API, type OfficeFacts, type OfficePlace } from '../lib/api';
import { WorldController } from '../office/controller';
import { applyPresence, type Member } from '../office/presence';
import type { Who } from '../office/scene';
import { OfficeBar, WelcomeCard, ZonePill, type Availability, type Person } from './OfficeBar';
import { WHERE, type OfficeClient } from './OfficeView';

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
  const [people, setPeople] = useState<Person[]>([]);
  const who = useRef(new Map<string, Who>());
  const mine = useRef<Availability>('available');
  const tellRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>(() => {
    try {
      const v = localStorage.getItem('conclave.office.availability');
      return v === 'busy' || v === 'away' ? v : 'available';
    } catch {
      return 'available';
    }
  });
  const choose = (a: Availability) => {
    setAvailability(a);
    mine.current = a;
    tellRef.current?.();
    try {
      localStorage.setItem('conclave.office.availability', a);
    } catch {
      // Not saved: it resets next visit.
    }
  };

  useEffect(() => {
    let stop = () => undefined;
    let cancelled = false;
    void (async () => {
      try {
        const facts = await client.office();
        if (cancelled || !box.current) return;
        const ctl = new WorldController(toMap(facts));
        const apply = (places: OfficePlace[]) => {
          ctl.setAgents(places.map((p) => ({ agentId: p.agentId, x: p.x, y: p.y })));
          who.current = new Map(facts.agents.map((a) => [a.id, { name: a.name, key: a.key, place: places.find((p) => p.agentId === a.id)?.place ?? 'lounge' }]));
          setPeople(facts.agents.map((a) => ({ id: a.id, name: a.name, where: WHERE[places.find((p) => p.agentId === a.id)?.place ?? 'lounge'] ?? '' })));
        };
        ctl.onZone((room) => setNotice(zoneNotice(room)));
        apply(await client.state());
        ctl.onDrawer((e) => onOpen(e.kind === 'open' ? e.id : null));
        const { startWorld } = await import('../office/scene');
        if (cancelled || !box.current) return;
        const world = startWorld({ parent: box.current, mapUrl: `${API}/api/office/map`, tilesUrl: '/office/tiles.png', peopleUrl: '/office/people.png', furnitureUrl: '/office/furniture.png', facts, ctl, who: () => who.current, myStatus: () => mine.current, onUseObject: (href) => router.push(href) });
        setView(ctl);
        const watch = new ResizeObserver(() => world.resize());
        watch.observe(box.current);
        const onVis = () => world.setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVis);
        const unlive = client.live((m) => {
          if (m.kind === 'office.changed') void client.state().then(apply);
        });
        // Presence: tell the others where you are, and draw the ones who are here. Only a signed-in session is sent anything.
        let others: Member[] = [];
        const link = client.presence?.((m) => {
          others = applyPresence(others, m);
          ctl.setOthers(others);
        });
        const tell = () => link?.send({ type: 'presence', x: ctl.me.tile.x, y: ctl.me.tile.y, availability: mine.current, handRaised: false });
        ctl.onMove(tell);
        tellRef.current = tell;
        const hello = setTimeout(tell, 500);
        stop = () => {
          watch.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          unlive();
          clearTimeout(hello);
          tellRef.current = null;
          link?.stop();
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
      <ZonePill text={notice} />
      {view ? (
        <OfficeBar
          people={people}
          availability={availability}
          onAvailability={choose}
          onOpenAgent={onOpen}
          onOverview={() => {
            view.overview(!whole);
            setWhole(!whole);
          }}
        />
      ) : null}
      <WelcomeCard />
      {view ? (
        <div className="absolute bottom-16 right-3 flex flex-col gap-1.5 sm:bottom-3">
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
