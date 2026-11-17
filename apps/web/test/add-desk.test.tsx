// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddDesk } from '../components/AddDesk';
import { OfficeBar } from '../components/OfficeBar';

afterEach(cleanup);
const departments = [
  { key: 'outreach', name: 'Outreach', desks: 6 },
  { key: 'research', name: 'Research', desks: 9 },
];

describe('adding a desk to a department room (S6B-1)', () => {
  it('lists the departments with how many desks each has, and a full one cannot be picked', () => {
    render(<AddDesk departments={departments} add={vi.fn()} onDone={() => undefined} onCancel={() => undefined} />);
    const d = screen.getByRole('dialog', { name: /add a desk/i });
    const select = within(d).getByLabelText(/department/i) as HTMLSelectElement;
    expect(within(select).getByRole('option', { name: /Outreach.*6 of 9/ })).toBeTruthy();
    expect((within(select).getByRole('option', { name: /Research.*full/i }) as HTMLOptionElement).disabled).toBe(true);
    expect(select.value).toBe('outreach');
  });

  it('adds a desk to the department chosen and tells the page', async () => {
    const add = vi.fn(async () => ({ key: 'outreach', room: 'Outreach', desks: 7 }));
    const done = vi.fn();
    render(<AddDesk departments={departments} add={add} onDone={done} onCancel={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^add a desk$/i }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('outreach'));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it('shows the reason when the room is full, stays open, and does not add twice while it is working', async () => {
    let finish: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<{ key: string; room: string; desks: number }>((_r, rej) => (finish = () => rej(new Error('Outreach has no free desk spot left (9 at most).')))));
    render(<AddDesk departments={departments} add={slow} onDone={() => undefined} onCancel={() => undefined} />);
    const button = screen.getByRole('button', { name: /^add a desk$/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(slow).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText(/no free desk spot/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^add a desk$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so when every room is full, and has nothing to add', () => {
    render(<AddDesk departments={[{ key: 'research', name: 'Research', desks: 9 }]} add={vi.fn()} onDone={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByText(/every department room is full/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^add a desk$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is offered in the bar\'s Tools menu', () => {
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onAddDesk={open} />);
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /add a desk/i }));
    expect(open).toHaveBeenCalled();
  });
});
