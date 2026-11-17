// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeBar, WelcomeCard, ZonePill } from '../components/OfficeBar';

afterEach(cleanup);
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // not available: the card then shows every time, which the tests below allow for
  }
});

const people = [
  { id: 'a1', name: 'Scout', where: 'At its desk' },
  { id: 'a2', name: 'Closer', where: 'In the lounge' },
];

describe('the bar over the world (S6-8c2)', () => {
  it('shows how many are here, and a panel listing each one that opens that agent', () => {
    const open = vi.fn();
    render(<OfficeBar people={people} availability="available" onAvailability={() => undefined} onOpenAgent={open} onOverview={() => undefined} />);
    expect(screen.getByRole('button', { name: /people/i }).textContent).toMatch(/2/);
    expect(screen.queryByRole('region', { name: /people/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /people/i }));
    const panel = screen.getByRole('region', { name: /people/i });
    expect(within(panel).getByText('Scout')).toBeTruthy();
    expect(within(panel).getByText(/In the lounge/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Scout/ }));
    expect(open).toHaveBeenCalledWith('a1');
    fireEvent.click(within(panel).getByRole('button', { name: /close people/i }));
    expect(screen.queryByRole('region', { name: /people/i })).toBeNull();
  });

  it('has a status menu with the current one ticked, and choosing another tells the page', () => {
    const set = vi.fn();
    render(<OfficeBar people={[]} availability="busy" onAvailability={set} onOpenAgent={() => undefined} onOverview={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /your status/i }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Available', 'Busy', 'Away']);
    expect(items.find((i) => i.getAttribute('aria-checked') === 'true')!.textContent).toBe('Busy');
    fireEvent.click(items[2]!);
    expect(set).toHaveBeenCalledWith('away');
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('has a tools menu with "see the whole office"', () => {
    const o = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={o} />);
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /whole office/i }));
    expect(o).toHaveBeenCalled();
  });
});

describe('the notice for a room (S6-8c2)', () => {
  it('shows the words it is given, and nothing when there are none', () => {
    const { rerender } = render(<ZonePill text="Quiet room: no bubbles open here." />);
    expect(screen.getByRole('status').textContent).toMatch(/quiet room/i);
    rerender(<ZonePill text={null} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the welcome card (S6-8c2)', () => {
  it('shows the first time, and "skip" closes it for good', () => {
    const { unmount } = render(<WelcomeCard />);
    expect(screen.getByRole('dialog', { name: /welcome/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(<WelcomeCard />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"let us go" shows a short list of the controls and then closes', () => {
    render(<WelcomeCard />);
    fireEvent.click(screen.getByRole('button', { name: /let.s go/i }));
    expect(screen.getByText(/arrow keys/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('quick reactions from the bar (S6-18)', () => {
  const base = { people: [], availability: 'available' as const, onAvailability: () => undefined, onOpenAgent: () => undefined, onOverview: () => undefined };

  it('opens a row of emoji and sends the one you pick', () => {
    const send = vi.fn();
    render(<OfficeBar {...base} onEmote={send} />);
    fireEvent.click(screen.getByRole('button', { name: /react/i }));
    const row = screen.getByRole('menu', { name: /reactions/i });
    const buttons = within(row).getAllByRole('menuitem');
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    fireEvent.click(buttons[1]!);
    expect(send).toHaveBeenCalledWith(buttons[1]!.textContent);
    expect(screen.queryByRole('menu', { name: /reactions/i })).toBeNull();
  });

  it('is left out when the page cannot send one', () => {
    render(<OfficeBar {...base} />);
    expect(screen.queryByRole('button', { name: /react/i })).toBeNull();
  });
});

describe('the list of rooms and agents from the bar (S6-15a)', () => {
  it('has a button for it, next to the people button, that tells the page to open it', () => {
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onOpenList={open} />);
    fireEvent.click(screen.getByRole('button', { name: /rooms and agents/i }));
    expect(open).toHaveBeenCalled();
  });

  it('is left out when the page has no list to open', () => {
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} />);
    expect(screen.queryByRole('button', { name: /rooms and agents/i })).toBeNull();
  });
});

describe('your name and look from the bar (S6-15b)', () => {
  const base = { people: [], availability: 'available' as const, onAvailability: () => undefined, onOpenAgent: () => undefined, onOverview: () => undefined };

  it('opens a picker with a name box and the six looks, and reports a change', () => {
    const change = vi.fn();
    render(<OfficeBar {...base} profile={{ name: 'Guest', look: 0 }} onProfile={change} />);
    fireEvent.click(screen.getByRole('button', { name: /your look/i }));
    const dialog = screen.getByRole('dialog', { name: /your look/i });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(6);
    expect((within(dialog).getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getAllByRole('radio')[3]!);
    expect(change).toHaveBeenLastCalledWith({ name: 'Guest', look: 3 });
    fireEvent.change(within(dialog).getByLabelText(/name/i), { target: { value: '  Sam ' } });
    fireEvent.blur(within(dialog).getByLabelText(/name/i));
    expect(change).toHaveBeenLastCalledWith({ name: 'Sam', look: 0 });
  });

  it('is left out when the page has no profile to change', () => {
    render(<OfficeBar {...base} />);
    expect(screen.queryByRole('button', { name: /your look/i })).toBeNull();
  });
});

describe('the team cards in the People panel (S6-14b2)', () => {
  const cards = [
    { id: 'a1', name: 'Scout', where: 'At its desk', state: 'working', since: new Date(Date.now() - 3 * 60_000).toISOString(), task: 'Write the follow-up', forYou: 0 },
    { id: 'a2', name: 'Closer', where: 'At the approvals desk', state: 'waiting', since: new Date(Date.now() - 2 * 3_600_000).toISOString(), task: null, forYou: 2 },
    { id: 'a3', name: 'Ranger', where: 'In the lounge', state: 'blocked', since: null, task: 'Needs a price', forYou: 0 },
    { id: 'a4', name: 'Idler', where: 'In the lounge', state: 'idle', since: null, task: null, forYou: 0 },
  ];
  const open = () => {
    render(<OfficeBar people={cards} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /people/i }));
    return screen.getByRole('region', { name: /people/i });
  };

  it('shows each agent\'s state, how long, and what it is on', () => {
    const panel = open();
    const scout = within(panel).getByRole('button', { name: /Scout/ });
    expect(scout.textContent).toMatch(/Working/);
    expect(scout.textContent).toMatch(/3 min/);
    expect(scout.textContent).toMatch(/Write the follow-up/);
    expect(within(panel).getByRole('button', { name: /Ranger/ }).textContent).toMatch(/Blocked.*Needs a price|Needs a price.*Blocked/s);
    expect(within(panel).getByRole('button', { name: /Idler/ }).textContent).toMatch(/Idle/);
  });

  it('says how many things are waiting for you from an agent, and only when there are some', () => {
    const panel = open();
    const closer = within(panel).getByRole('button', { name: /Closer/ });
    expect(closer.textContent).toMatch(/Waiting for you/);
    expect(closer.textContent).toMatch(/2 for you/);
    expect(closer.textContent).toMatch(/2 h/);
    expect(within(panel).getByRole('button', { name: /Scout/ }).textContent).not.toMatch(/for you/);
  });

  it('still lists someone with only a name and a place, as before', () => {
    render(<OfficeBar people={[{ id: 'x', name: 'Plain', where: 'In the lounge' }]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /people/i }));
    expect(within(screen.getByRole('region', { name: /people/i })).getByRole('button', { name: /Plain/ }).textContent).toMatch(/In the lounge/);
  });
});

describe('how long ago (S6-14b2)', () => {
  it('says it plainly, in the largest sensible unit', async () => {
    const { ago } = await import('../office/ago');
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(ago('2026-11-16T11:59:58Z', now)).toBe('just now');
    expect(ago('2026-11-16T11:59:15Z', now)).toBe('45 s');
    expect(ago('2026-11-16T11:57:00Z', now)).toBe('3 min');
    expect(ago('2026-11-16T10:00:00Z', now)).toBe('2 h');
    expect(ago('2026-11-14T12:00:00Z', now)).toBe('2 d');
    expect(ago('2026-11-16T12:05:00Z', now)).toBe('just now'); // a clock a little ahead is not "-5 min"
    expect(ago('nonsense', now)).toBe('');
  });
});

describe('the activity feed in the People panel (S6-14b3)', () => {
  const events = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, at: new Date(Date.now() - (i + 1) * 60_000).toISOString(), kind: 'run.started', text: `Event ${i}.` }));
  const open = (activity?: typeof events) => {
    render(<OfficeBar people={[]} activity={activity} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /people/i }));
    return screen.getByRole('region', { name: /people/i });
  };

  it('lists the latest events, newest first, each with how long ago, and no more than eight', () => {
    const feed = within(open(events)).getByRole('list', { name: /activity/i });
    const items = within(feed).getAllByRole('listitem');
    expect(items).toHaveLength(8);
    expect(items[0]!.textContent).toMatch(/Event 0\./);
    expect(items[0]!.textContent).toMatch(/1 min/);
    expect(items[7]!.textContent).toMatch(/Event 7\./);
  });

  it('says so when nothing has happened, and shows no feed at all for a client without one', () => {
    expect(within(open([])).getByText(/nothing has happened yet/i)).toBeTruthy();
    cleanup();
    expect(within(open(undefined)).queryByText(/activity/i)).toBeNull();
  });
});
