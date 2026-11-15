'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ago } from '../office/ago';

export type Availability = 'available' | 'busy' | 'away';
export interface Person {
  id: string;
  name: string;
  where: string;
  /** From the team card (S6-14b2): working, waiting, blocked, discussion, handoff or idle. */
  state?: string;
  since?: string | null;
  task?: string | null;
  forYou?: number;
}

const STATE_LABEL: Record<string, string> = { working: 'Working', waiting: 'Waiting for you', blocked: 'Blocked', discussion: 'In a discussion', handoff: 'Handing over', idle: 'Idle' };
const STATE_DOT: Record<string, string> = { working: 'bg-green-400', waiting: 'bg-amber-400', blocked: 'bg-red-400', discussion: 'bg-purple-400', handoff: 'bg-cyan-400', idle: 'bg-neutral-400' };

const STATUS: { id: Availability; label: string; dot: string }[] = [
  { id: 'available', label: 'Available', dot: 'bg-green-500' },
  { id: 'busy', label: 'Busy', dot: 'bg-red-500' },
  { id: 'away', label: 'Away', dot: 'bg-amber-400' },
];
const pill = 'rounded-xl bg-neutral-900/85 text-white shadow backdrop-blur';
const item = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-white/10';

/**
 * The bar over the world: who is here, a tools menu and your status. Floating groups on a desktop; on a phone the same controls
 * sit along the bottom edge. It only reports what you chose; the page decides what to do (SPEC 12).
 */
export function OfficeBar(props: { people: Person[]; /** What just happened, newest first (S6-14b3). Left out, the panel has no feed. */ activity?: { id: string; at: string; text: string }[] | undefined; availability: Availability; onAvailability: (a: Availability) => void; onOpenAgent: (id: string) => void; onOverview: () => void; /** More controls next to the people button (the company switcher). */ extra?: ReactNode; /** Called from the Tools menu: the page shows the add-a-department dialog. */ onAddDepartment?: () => void; /** Called from the Tools menu: the page shows the add-an-agent dialog. */ onAddAgent?: () => void }) {
  const [menu, setMenu] = useState<'tools' | 'status' | null>(null);
  const [panel, setPanel] = useState(false);
  const current = STATUS.find((s) => s.id === props.availability)!;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 sm:inset-x-0 sm:bottom-auto sm:top-0 sm:items-start sm:p-3">
        <div className="pointer-events-auto flex gap-2">
          <div className={`flex ${pill}`}>
            <button type="button" aria-label={`People, ${props.people.length} here`} aria-expanded={panel} onClick={() => setPanel(!panel)} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span aria-hidden>👥</span>
              <span>{props.people.length}</span>
            </button>
          </div>
          {props.extra}
        </div>
        <div className="pointer-events-auto relative flex gap-2">
          <div className={`relative ${pill}`}>
            <button type="button" aria-haspopup="menu" aria-expanded={menu === 'tools'} onClick={() => setMenu(menu === 'tools' ? null : 'tools')} className="px-3 py-2 text-sm">
              Tools ▾
            </button>
            {menu === 'tools' ? (
              <div role="menu" className={`absolute bottom-full right-0 mb-2 w-52 p-1 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 ${pill}`}>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    props.onOverview();
                    setMenu(null);
                  }}
                >
                  See the whole office
                </button>
                {props.onAddDepartment ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={item}
                    onClick={() => {
                      props.onAddDepartment?.();
                      setMenu(null);
                    }}
                  >
                    Add a department…
                  </button>
                ) : null}
                {props.onAddAgent ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={item}
                    onClick={() => {
                      props.onAddAgent?.();
                      setMenu(null);
                    }}
                  >
                    Add an agent…
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={`relative ${pill}`}>
            <button type="button" aria-label="Your status" aria-haspopup="menu" aria-expanded={menu === 'status'} onClick={() => setMenu(menu === 'status' ? null : 'status')} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${current.dot}`} />
              <span>You</span>
            </button>
            {menu === 'status' ? (
              <div role="menu" aria-label="Change your status" className={`absolute bottom-full right-0 mb-2 w-44 p-1 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 ${pill}`}>
                {STATUS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s.id === props.availability}
                    className={item}
                    onClick={() => {
                      props.onAvailability(s.id);
                      setMenu(null);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {panel ? (
        <section role="region" aria-label="People" className={`absolute left-2 top-2 z-20 max-h-[85%] w-64 overflow-auto p-2 sm:left-3 sm:top-14 ${pill}`}>
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <h3 className="text-sm font-semibold">{props.people.length} here</h3>
            <button type="button" aria-label="Close people" className="rounded px-2 text-lg hover:bg-white/10" onClick={() => setPanel(false)}>
              ×
            </button>
          </div>
          <ul>
            {props.people.map((p) => (
              <li key={p.id}>
                <button type="button" className={`${item} flex-col items-start`} onClick={() => props.onOpenAgent(p.id)}>
                  <span className="flex w-full items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.state ? (
                      <span className="flex items-center gap-1 text-xs text-neutral-200">
                        <span className={`h-2 w-2 rounded-full ${STATE_DOT[p.state] ?? 'bg-neutral-400'}`} />
                        {STATE_LABEL[p.state] ?? p.state}
                        {p.since ? ` · ${ago(p.since)}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-300">{p.where}</span>
                    )}
                    {p.forYou ? <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-neutral-900">{p.forYou} for you</span> : null}
                  </span>
                  {p.task ? <span className="text-xs text-neutral-300">{p.task}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {props.activity ? (
            <div className="mt-2 border-t border-white/10 px-2 pt-2">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-300">Activity</h4>
              {props.activity.length === 0 ? (
                <p className="text-xs text-neutral-400">Nothing has happened yet.</p>
              ) : (
                <ul aria-label="Activity" className="space-y-1">
                  {props.activity.slice(0, 8).map((e) => (
                    <li key={e.id} className="text-xs text-neutral-200">
                      {e.text} <span className="text-neutral-400">{ago(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

/** A notice over the map about the room you are in. */
export function ZonePill({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="pointer-events-none absolute left-1/2 top-14 z-10 max-w-[90%] -translate-x-1/2 rounded-xl bg-red-800/90 px-4 py-2 text-center text-xs text-white shadow sm:top-16 sm:text-sm">
      {text}
    </p>
  );
}

const SEEN = 'conclave.office.welcome';
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    // Not saved: the card shows again next time, which is harmless.
  }
};

/** A short, skippable welcome the first time you open the office. */
export function WelcomeCard() {
  // Closed on the server and on first paint, then opened if you have not seen it: no mismatch between the two.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!seen()) setOpen(true);
  }, []);
  const [tour, setTour] = useState(false);
  if (!open) return null;
  const close = () => {
    remember();
    setOpen(false);
  };
  return (
    <div role="dialog" aria-label="Welcome to the office" className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-900/60 p-4">
      <div className="max-w-sm space-y-3 rounded-2xl bg-neutral-900 p-5 text-center text-white shadow-xl">
        <h2 className="text-lg font-semibold">Welcome to the office</h2>
        {tour ? (
          <>
            <ul className="space-y-1 text-left text-sm text-neutral-200">
              <li>Move with the arrow keys, or click where you want to go.</li>
              <li>Walk up to an agent to open its drawer and give it a task.</li>
              <li>Click an object (the approvals desk, the whiteboard) to open its page.</li>
              <li>The buttons at the edge zoom in and out.</li>
            </ul>
            <button type="button" onClick={close} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium">
              Got it
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-300">Your agents work here. See who is busy, who is waiting for you, and walk up to talk to one.</p>
            <div className="flex justify-center gap-3">
              <button type="button" onClick={() => setTour(true)} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium">
                Let&apos;s go!
              </button>
              <button type="button" onClick={close} className="px-4 py-2 text-sm text-neutral-300">
                Skip tutorial
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
