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
