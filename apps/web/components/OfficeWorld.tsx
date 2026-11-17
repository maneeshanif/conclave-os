'use client';

import { useEffect, useRef, useState } from 'react';
import { zoneNotice, type OfficeMap } from '@conclave/shared';
import { API, api, type OfficeFacts, type OfficePlace } from '../lib/api';
import { WorldController } from '../office/controller';
import { handoffRefreshMs } from '../office/places-refresh';
import { describeThing, placeTooltip, type Thing } from '../office/tooltips';
import { applyPresence, type Member } from '../office/presence';
import { addChat, nearbyPeople, type ChatLine } from '../office/chat';
import { ChatBubble } from './ChatBubble';
import type { WorldInfo } from '../lib/world';
import { readProfile, writeProfile, type Profile } from '../office/profile';
import type { Who } from '../office/scene';
import { AddAgent } from './AddAgent';
import { AddDepartment } from './AddDepartment';
import { CompanySwitcher } from './CompanySwitcher';
import { OfficeBar, WelcomeCard, ZonePill, type Availability, type Person } from './OfficeBar';
import { WHERE, type OfficeClient } from './OfficeView';

/** Strings of # and . from the server back into the grid of booleans the walking code uses. */
export const toMap = (facts: OfficeFacts): OfficeMap => ({ ...facts.map, walls: facts.map.walls.map((row) => [...row].map((c) => c === '#')) });

/**
 * The office as a world you can walk about (SPEC 12). Phaser is loaded only here, only in the browser, so the server render and
 * the plain list never pull it in. A hidden tab stops the drawing; a phone gets a smaller canvas (the list below is the main way in).
 */
export function OfficeWorld({ client, onOpen, onPanel, onOpenList, onFail, world: worldKey = 'hq', onWorld }: { client: OfficeClient; world?: string; onWorld?: (key: string) => void; onOpen: (agentId: string | null) => void; onPanel: (id: string, ctx?: { dept?: string }) => void; onOpenList?: () => void; onFail?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [view, setView] = useState<WorldController | null>(null);
  const [whole, setWhole] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const who = useRef(new Map<string, Who>());
  const mine = useRef<Availability>('available');
  const states = useRef(new Map<string, string>());
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  useEffect(() => {
    void client.worlds?.().then(setWorlds).catch(() => undefined);
  }, [client]);
  const [near, setNear] = useState<{ id: string; name: string }[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const sendChat = useRef<(text: string) => void>(() => undefined);
  const [profile, setProfile] = useState<Profile>({ name: 'Guest', look: 0 });
  const profileRef = useRef(profile);
  useEffect(() => {
    try {
      const p = readProfile(localStorage);
      profileRef.current = p;
      setProfile(p);
    } catch {
      // Not readable: the defaults stand.
    }
  }, []);
  const changeProfile = (p: Profile) => {
    profileRef.current = p;
    setProfile(p);
    try {
      writeProfile(localStorage, p);
    } catch {
      // Not saved: it resets next visit.
    }
    tellRef.current?.();
  };
  const tellRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ id: string; at: string; text: string }[] | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [hover, setHover] = useState<{ thing: Thing; x: number; y: number } | null>(null);
  const factsRef = useRef<OfficeFacts | null>(null);
  const inRoom = useRef<(room: string) => string[]>(() => []);
  const [addingAgent, setAddingAgent] = useState(false);
  const [departments, setDepartments] = useState<{ key: string; name: string }[]>([]);
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
        factsRef.current = facts;
        const ctl = new WorldController(toMap(facts));
        setDepartments(facts.map.rooms.flatMap((r) => (r.department ? [{ key: r.department, name: r.name }] : [])));
        // While someone is handing a task on they stand beside a colleague's desk; they go back by themselves, so look again soon.
        let again: ReturnType<typeof setTimeout> | undefined;
        // The cards (state, how long, task, what waits for you) come from the server's own reading, the same one the world's placement uses.
        const loadTeam = () =>
          client.team?.().then((team) => {
            states.current = new Map(team.map((m) => [m.id, m.state] as [string, string]));
            setPeople(team.map((t) => ({ id: t.id, name: t.name, where: WHERE[who.current.get(t.id)?.place ?? 'lounge'] ?? '', state: t.state, since: t.since, task: t.task, forYou: t.forYou })));
          }).catch(() => undefined);
        const loadActivity = () => client.activity?.().then(setActivity).catch(() => undefined);
        void loadActivity();
        const apply = (places: OfficePlace[]) => {
          void loadActivity();
          if (again) clearTimeout(again);
          const ms = handoffRefreshMs(places);
          if (ms) again = setTimeout(() => void client.state().then(apply).catch(() => undefined), ms);
          ctl.setAgents(places.map((p) => ({ agentId: p.agentId, x: p.x, y: p.y })));
          who.current = new Map(facts.agents.map((a) => [a.id, { name: a.name, key: a.key, place: places.find((p) => p.agentId === a.id)?.place ?? 'lounge', reason: places.find((p) => p.agentId === a.id)?.reason, room: a.room }]));
          inRoom.current = (room) => {
            const r = facts.map.rooms.find((x) => x.name === room);
            if (!r) return [];
            return facts.agents.filter((a) => { const p = places.find((q) => q.agentId === a.id); return !!p && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }).map((a) => a.name);
          };
          void loadTeam();
          setPeople((cur) => (cur.some((p) => p.state) ? cur : facts.agents.map((a) => ({ id: a.id, name: a.name, where: WHERE[places.find((p) => p.agentId === a.id)?.place ?? 'lounge'] ?? '' }))));
        };
        ctl.onZone((room) => setNotice(zoneNotice(room)));
        apply(await client.state());
        ctl.onDrawer((e) => onOpen(e.kind === 'open' ? e.id : null));
        const { startWorld } = await import('../office/scene');
        if (cancelled || !box.current) return;
        const world = startWorld({ parent: box.current, mapUrl: `${API}/api/office/map${worldKey === 'hq' ? '' : `?world=${worldKey}`}`, tilesUrl: '/office/tiles.png', peopleUrl: '/office/people.png', furnitureUrl: '/office/furniture.png', objectsUrl: '/office/objects.png', decorBase: '/office/decor', agentsUrl: '/office/agents.png', stateOf: (id) => states.current.get(id), facts, ctl, who: () => who.current, myStatus: () => mine.current, myLook: () => profileRef.current.look, myName: () => profileRef.current.name, onUseObject: onPanel, onHover: setHover });
        setView(ctl);
        const watch = new ResizeObserver(() => world.resize());
        watch.observe(box.current);
        const onVis = () => world.setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVis);
        const unlive = client.live((m) => {
          if (m.kind === 'office.changed') void client.state().then(apply);
          if (m.kind === 'department.changed' || m.kind === 'approval.changed') void loadActivity();
        });
        // Presence: tell the others where you are, and draw the ones who are here. Only a signed-in session is sent anything.
        let others: Member[] = [];
        const watchNear = () => {
          const people = ctl.others();
          setNear((was) => {
            const ids = nearbyPeople(ctl.me.position, people, was.map((n) => n.id));
            return ids.length === was.length && ids.every((id, i) => id === was[i]!.id) ? was : ids.map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? 'Guest' }));
          });
        };
        const link = client.presence?.((m) => {
          others = applyPresence(others, m);
          ctl.setOthers(others);
          setLines((cur) => addChat(cur, m));
          watchNear();
        });
        const nearTimer = setInterval(watchNear, 300);
        sendChat.current = (text) => {
          link?.send({ type: 'chat', text });
          setLines((cur) => addChat(cur, { kind: 'chat', id: 'me', name: profileRef.current.name, text, at: Date.now() }, true));
        };
        const tell = () => link?.send({ type: 'presence', x: ctl.me.tile.x, y: ctl.me.tile.y, availability: mine.current, handRaised: false, name: profileRef.current.name, look: profileRef.current.look });
        ctl.onMove(tell);
        tellRef.current = tell;
        const hello = setTimeout(tell, 500);
        stop = () => {
          watch.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          unlive();
          clearTimeout(hello);
          clearInterval(nearTimer);
          if (again) clearTimeout(again);
          tellRef.current = null;
          link?.stop();
          world.destroy();
        };
      } catch (err) {
        setFailed((err as Error).message);
        failRef.current?.();
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [client, onOpen, onPanel]);

  // The world could not start: the page shows the list of rooms and agents instead (S6-15a).
  if (failed) return null;
  const btn = 'flex h-9 w-9 items-center justify-center rounded-md bg-neutral-900/80 text-lg text-white hover:bg-neutral-900';
  return (
    <div className="absolute inset-0">
      <div ref={box} data-testid="office-world" aria-hidden="true" className="h-full w-full overflow-hidden" />
      <ZonePill text={notice} />
      {view ? (
        <OfficeBar
          people={people}
          activity={activity}
          availability={availability}
          onAvailability={choose}
          onOpenAgent={onOpen}
          extra={<CompanySwitcher onSwitch={() => window.location.reload()} />}
          onAddDepartment={() => setAdding(true)}
          onAddAgent={() => setAddingAgent(true)}
          profile={profile}
          onProfile={changeProfile}
          onOpenList={onOpenList}
          worlds={worlds}
          world={worldKey}
          onWorld={onWorld}
          onOverview={() => {
            view.overview(!whole);
            setWhole(!whole);
          }}
        />
      ) : null}
      {addingAgent ? (
        <AddAgent
          departments={departments}
          onCancel={() => setAddingAgent(false)}
          onOpenApprovals={() => {
            setAddingAgent(false);
            onPanel('approvals');
          }}
        />
      ) : null}
      {adding ? <AddDepartment add={api.addDepartment} onDone={() => window.location.reload()} onCancel={() => setAdding(false)} /> : null}
      {hover && factsRef.current ? <Tooltip hover={hover} facts={factsRef.current} who={who.current} hereIn={inRoom.current} status={mine.current} box={box.current} /> : null}
      <ChatBubble near={near} lines={lines} onSend={(t) => sendChat.current(t)} />
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

/** The tooltip over the world (S6-14b1): what the pointer is on, in the same words the list uses. */
function Tooltip({ hover, facts, who, hereIn, status, box }: { hover: { thing: Thing; x: number; y: number }; facts: OfficeFacts; who: Map<string, Who>; hereIn: (room: string) => string[]; status: Availability; box: HTMLElement | null }) {
  const text = describeThing(hover.thing, { facts, who, hereIn, myStatus: status });
  if (!text) return null;
  const at = placeTooltip(hover.x, hover.y, 220, 56, box?.clientWidth ?? 640, box?.clientHeight ?? 384);
  return (
    <div role="tooltip" style={{ left: at.left, top: at.top }} className="pointer-events-none absolute z-20 max-w-[220px] rounded-lg bg-neutral-900/95 px-3 py-2 text-xs text-white shadow-lg">
      <p className="font-semibold">{text.title}</p>
      <p className="text-neutral-200">{text.line}</p>
    </div>
  );
}
