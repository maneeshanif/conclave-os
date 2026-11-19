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
import { needsYouRose } from '../office/mood';
import { notesFor, type Note } from '../office/notes';
import { currentEmote, showEmote, type EmoteMap } from '../office/emotes';
import { play, readSoundSettings, soundFor, speak, speakable, writeSoundSettings, type SoundSettings } from '../office/sound';
import { readProfile, writeProfile, type Profile } from '../office/profile';
import type { Who } from '../office/scene';
import { AddAgent } from './AddAgent';
import { AddDepartment } from './AddDepartment';
import { AddDesk } from './AddDesk';
import { EditPanel } from './EditPanel';
import { tileAction, type EditTool } from '../office/edit';
import { AnnouncementBanner, Megaphone } from './Megaphone';
import { CompanySwitcher } from './CompanySwitcher';
import { OfficeBar, WelcomeCard, ZonePill, type Availability, type Person } from './OfficeBar';
import { WHERE, type OfficeClient } from './OfficeView';
import { DemoSim, stepMs, type Speed } from '../office/demo';
import { dragAction, grabs } from '../office/edit';

/** Strings of # and . from the server back into the grid of booleans the walking code uses. */
export const toMap = (facts: OfficeFacts): OfficeMap => ({ ...facts.map, walls: facts.map.walls.map((row) => [...row].map((c) => c === '#')) });

/**
 * The office as a world you can walk about (SPEC 12). Phaser is loaded only here, only in the browser, so the server render and
 * the plain list never pull it in. A hidden tab stops the drawing; a phone gets a smaller canvas (the list below is the main way in).
 */
export function OfficeWorld({ client, onOpen, onPanel, onOpenList, onFail }: { client: OfficeClient; onOpen: (agentId: string | null) => void; onPanel: (id: string, ctx?: { dept?: string }) => void; onOpenList?: () => void; onFail?: () => void }) {
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
  const [announcement, setAnnouncement] = useState<{ name: string; text: string } | null>(null);
  const [pinned, setPinned] = useState<{ text: string; by: string } | null>(null);
  const [megaphone, setMegaphone] = useState(false);
  // Editing the office (S6B-9). It survives the reload that follows a change, so you can keep going.
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<EditTool | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const editRef = useRef<{ editing: boolean; tool: EditTool | null }>({ editing: false, tool: null });
  editRef.current = { editing, tool };
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('conclave.edit');
      if (saved) {
        const v = JSON.parse(saved) as { tool: EditTool | null };
        setEditing(true);
        setTool(v.tool);
      }
    } catch {
      // Not editing.
    }
  }, []);
  const useTile = (tile: { x: number; y: number }, decor: { id: number; x: number; y: number; w: number; h: number }[]): boolean => {
    const { editing: on, tool: t } = editRef.current;
    if (!on) return false;
    const action = tileAction(t, tile, decor);
    if (!action) {
      setEditMessage('Pick a piece or Remove first.');
      return true;
    }
    if (action.kind === 'nothing') {
      setEditMessage(action.why);
      return true;
    }
    if (action.kind === 'pick') {
      setTool({ kind: 'move', id: action.id });
      setEditMessage('Now click where it goes.');
      return true;
    }
    const done = action.kind === 'place' ? api.placeDecor({ name: action.name, x: action.x, y: action.y, ...(action.turn ? { turn: action.turn } : {}) }) : action.kind === 'move' ? api.moveDecor(action.id, { x: action.x, y: action.y }) : action.kind === 'door' ? api.toggleDoor({ x: action.x, y: action.y }) : action.kind === 'grow' ? api.growRoom({ x: action.x, y: action.y, side: action.side }) : api.removeDecor(action.id);
    void done.then(
      () => {
        try {
          sessionStorage.setItem('conclave.edit', JSON.stringify({ tool: t?.kind === 'move' ? { kind: 'move', id: null } : t }));
        } catch {
          // The next load is not in edit mode.
        }
        window.location.reload();
      },
      (err: Error) => setEditMessage(err.message),
    );
    return true;
  };
  // A piece dragged from one tile to another with the Move tool: one change on the server, refused with its reason if it is not allowed.
  const dropPiece = (from: { x: number; y: number }, to: { x: number; y: number }, decor: { id: number; x: number; y: number; w: number; h: number }[]): boolean => {
    const { editing: on, tool: t } = editRef.current;
    const action = on ? dragAction(t, from, to, decor) : null;
    if (!action) return false;
    void api.moveDecor(action.id, { x: action.x, y: action.y }).then(
      () => {
        try {
          sessionStorage.setItem('conclave.edit', JSON.stringify({ tool: { kind: 'move', id: null } }));
        } catch {
          // The next load is not in edit mode.
        }
        window.location.reload();
      },
      (err: Error) => setEditMessage(err.message),
    );
    return true;
  };
  const [following, setFollowing] = useState<string | null>(null);
  const followRef = useRef<(id: string | null) => void>(() => undefined);
  // Demo mode: the office acts out a day on this screen only. Nothing is written or asked of the server while it runs.
  const [demo, setDemo] = useState<{ on: boolean; speed: Speed }>({ on: false, speed: 1 });
  const demoOn = useRef(false);
  const reloadTeam = useRef<() => void>(() => undefined);
  // The conveyor beside the review board: one parcel for each open pull request, looked at again now and then.
  const openPulls = useRef(0);
  useEffect(() => {
    const look = () => void api.pulls().then((list) => (openPulls.current = list.filter((p) => p.status === 'open').length)).catch(() => undefined);
    look();
    const timer = setInterval(look, 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    demoOn.current = demo.on;
    if (!demo.on) {
      reloadTeam.current(); // back to what is really happening
      return;
    }
    const sim = new DemoSim([...who.current.keys()]);
    const tick = () => {
      sim.tick();
      states.current = sim.states();
    };
    tick();
    const timer = setInterval(tick, stepMs(demo.speed));
    return () => clearInterval(timer);
  }, [demo.on, demo.speed]);
  const sendMega = useRef<(kind: 'announce' | 'pin', text: string) => void>(() => undefined);
  const forYouBefore = useRef<number | null>(null);
  const notes = useRef<Note[]>([]);
  // Sound starts off, is kept in this browser, and is read after the first paint so the server render and the first paint agree.
  const [sound, setSound] = useState<SoundSettings>({ effects: false, voice: false });
  const soundRef = useRef(sound);
  useEffect(() => {
    const s = readSoundSettings();
    soundRef.current = s;
    setSound(s);
  }, []);
  const changeSound = (s: SoundSettings) => {
    soundRef.current = s;
    setSound(s);
    writeSoundSettings(s);
    play('pop', s);
  };
  const hear = (event: string) => {
    const name = soundFor(event);
    if (name) play(name, soundRef.current);
  };
  const emotes = useRef<EmoteMap>(new Map());
  const sendEmote = useRef<(emote: string) => void>(() => undefined);
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
  const [addingDesk, setAddingDesk] = useState(false);
  const [deskCounts, setDeskCounts] = useState<{ key: string; name: string; desks: number }[]>([]);
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
        setDeskCounts(facts.map.rooms.flatMap((r) => (r.department ? [{ key: r.department, name: r.name, desks: facts.map.desks.filter((d) => d.room === r.name).length }] : [])));
        // While someone is handing a task on they stand beside a colleague's desk; they go back by themselves, so look again soon.
        let again: ReturnType<typeof setTimeout> | undefined;
        // The cards (state, how long, task, what waits for you) come from the server's own reading, the same one the world's placement uses.
        const loadTeam = () =>
          client.team?.().then((team) => {
            if (demoOn.current) return; // the demo is drawing the people for now
            states.current = new Map(team.map((m) => [m.id, m.state] as [string, string]));
            const waiting = team.reduce((n, m) => n + (m.forYou ?? 0), 0);
            if (needsYouRose(forYouBefore.current, waiting)) hear('needs-you');
            forYouBefore.current = waiting;
            setPeople(team.map((t) => ({ id: t.id, name: t.name, where: WHERE[who.current.get(t.id)?.place ?? 'lounge'] ?? '', state: t.state, since: t.since, task: t.task, forYou: t.forYou })));
          }).catch(() => undefined);
        reloadTeam.current = () => void loadTeam();
        // The sticky notes on the plan wall come from the tasks, and are looked at again when a task changes.
        const loadNotes = () => void api.tasks().then((list) => (notes.current = notesFor(list))).catch(() => undefined);
        void loadNotes();
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
        ctl.onZone((room) => {
          setNotice(zoneNotice(room));
          if (room) hear('enter-room');
        });
        ctl.onMove(() => hear('step'));
        apply(await client.state());
        ctl.onDrawer((e) => onOpen(e.kind === 'open' ? e.id : null));
        const { startWorld } = await import('../office/scene');
        if (cancelled || !box.current) return;
        const world = startWorld({ parent: box.current, mapUrl: `${API}/api/office/map`, tilesUrl: '/office/tiles.png', peopleUrl: '/office/people.png', furnitureUrl: '/office/furniture.png', objectsUrl: '/office/objects.png', decorBase: '/office/decor', agentsUrl: '/office/agents.png', stateOf: (id) => states.current.get(id), notesOf: () => notes.current, emoteOf: (id) => currentEmote(emotes.current, id, Date.now()), facts, ctl, who: () => who.current, myStatus: () => mine.current, myLook: () => profileRef.current.look, myName: () => profileRef.current.name, onUseObject: onPanel, onTile: (t, d) => useTile(t, d), openPulls: () => openPulls.current, grabs: (t, d) => editRef.current.editing && grabs(editRef.current.tool, t, d), onDrag: (a, b, d) => dropPiece(a, b, d), onHover: setHover });
        setView(ctl);
        const watch = new ResizeObserver(() => world.resize());
        watch.observe(box.current);
        const onVis = () => world.setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVis);
        const unlive = client.live((m) => {
          if (m.kind === 'office.changed') void client.state().then(apply);
          if (m.kind === 'department.changed' || m.kind === 'approval.changed') void loadActivity();
          if (m.kind === 'task.changed') loadNotes();
        });
        // Presence: tell the others where you are, and draw the ones who are here. Only a signed-in session is sent anything.
        let others: Member[] = [];
        followRef.current = (id) => {
          ctl.follow(id);
          setFollowing(ctl.followingId);
        };
        const watchNear = () => {
          setFollowing((was) => (was === ctl.followingId ? was : ctl.followingId));
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
          if (m.kind === 'chat' && typeof m.text === 'string') {
            hear('chat');
            const line = speakable(typeof m.name === 'string' ? m.name : 'Someone', m.text, soundRef.current);
            if (line) speak(line);
          }
          if (m.kind === 'emote') hear('emote');
          if (m.kind === 'announce' && typeof m.text === 'string') {
            const name = typeof m.name === 'string' ? m.name : 'Someone';
            setAnnouncement({ name, text: m.text });
            setTimeout(() => setAnnouncement((cur) => (cur && cur.text === m.text ? null : cur)), 9000);
            hear('needs-you');
            const line = speakable(name, m.text, soundRef.current);
            if (line) speak(line);
          }
          if (m.kind === 'pin' && typeof m.text === 'string') setPinned(m.text ? { text: m.text, by: typeof m.by === 'string' ? m.by : 'Someone' } : null);
          if (m.kind === 'emote' && typeof m.id === 'string' && typeof m.emote === 'string') emotes.current = showEmote(emotes.current, m.id, m.emote, Date.now());
          watchNear();
        });
        const nearTimer = setInterval(watchNear, 300);
        sendMega.current = (kind, text) => {
          link?.send({ type: kind, text });
          if (kind === 'pin') setPinned(text ? { text, by: profileRef.current.name } : null);
          if (kind === 'announce') {
            setAnnouncement({ name: 'You', text });
            setTimeout(() => setAnnouncement(null), 9000);
          }
        };
        sendEmote.current = (emote) => {
          link?.send({ type: 'emote', emote });
          emotes.current = showEmote(emotes.current, 'me', emote, Date.now());
        };
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
          onAddDesk={() => setAddingDesk(true)}
          onMegaphone={() => setMegaphone(true)}
          onEdit={() => setEditing(true)}
          onAddAgent={() => setAddingAgent(true)}
          profile={profile}
          onProfile={changeProfile}
          onOpenList={onOpenList}
          onSettings={() => onPanel('settings')}
          onBoards={() => onPanel('boards')}
          demo={demo}
          onDemo={setDemo}
          onEmote={(e) => {
            hear('emote');
            sendEmote.current(e);
          }}
          sound={sound}
          onSound={changeSound}
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
      <AnnouncementBanner announcement={announcement} pinned={pinned} />
      {editing ? (
        <EditPanel
          onUndo={() => {
            void api.undoEdit().then(
              () => window.location.reload(),
              (err: Error) => setEditMessage(err.message),
            );
          }}
          tool={tool}
          message={editMessage}
          onTool={(t) => {
            setTool(t);
            setEditMessage(null);
          }}
          onDone={() => {
            setEditing(false);
            setTool(null);
            try {
              sessionStorage.removeItem('conclave.edit');
            } catch {
              // Nothing to clear.
            }
          }}
        />
      ) : null}
      {megaphone ? <Megaphone pinned={pinned} onSend={(k, t) => sendMega.current(k, t)} onClose={() => setMegaphone(false)} /> : null}
      {addingDesk ? <AddDesk departments={deskCounts} add={api.addDesk} onDone={() => window.location.reload()} onCancel={() => setAddingDesk(false)} /> : null}
      {adding ? <AddDepartment add={api.addDepartment} onDone={() => window.location.reload()} onCancel={() => setAdding(false)} /> : null}
      {hover && factsRef.current ? <Tooltip hover={hover} facts={factsRef.current} who={who.current} hereIn={inRoom.current} status={mine.current} box={box.current} /> : null}
      <ChatBubble near={near} lines={lines} onSend={(t) => sendChat.current(t)} onFollow={(id) => followRef.current(id)} following={following} />
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
