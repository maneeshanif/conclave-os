// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddDepartment } from '../components/AddDepartment';
import { OfficeBar } from '../components/OfficeBar';

afterEach(cleanup);

describe('adding a department from the world (S6-13b)', () => {
  it('asks for a name, and Create waits until there is one', () => {
    render(<AddDepartment add={vi.fn()} onDone={() => undefined} onCancel={() => undefined} />);
    const d = screen.getByRole('dialog', { name: /add a department/i });
    expect((within(d).getByRole('button', { name: /^create$/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText(/name/i), { target: { value: '   ' } });
    expect((within(d).getByRole('button', { name: /^create$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('makes the department and tells the page, which shows the new room', async () => {
    const add = vi.fn(async () => ({ key: 'sales-team', name: 'Sales Team', room: 20 }));
    const done = vi.fn();
    render(<AddDepartment add={add} onDone={done} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: ' Sales Team ' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('Sales Team'));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it('shows the reason when it cannot be made (a name in use, no room left) and stays open', async () => {
    const done = vi.fn();
    render(<AddDepartment add={vi.fn(async () => Promise.reject(new Error('The office has no room for another department (8 can be added).')))} onDone={done} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'One More' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText(/no room for another department/)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /^create$/i }) as HTMLButtonElement).disabled).toBe(false); // can try again
  });

  it('does not make it twice if Create is pressed again while it is working', async () => {
    let finish: () => void = () => undefined;
    const add = vi.fn(() => new Promise<{ key: string; name: string; room: number }>((r) => (finish = () => r({ key: 'a', name: 'A', room: 1 }))));
    render(<AddDepartment add={add} onDone={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'A' } });
    const create = screen.getByRole('button', { name: /^create$/i });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(add).toHaveBeenCalledTimes(1);
    finish();
  });

  it('can be cancelled', () => {
    const cancel = vi.fn();
    render(<AddDepartment add={vi.fn()} onDone={() => undefined} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancel).toHaveBeenCalled();
  });

  it('is reached from the Tools menu in the bar', () => {
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onAddDepartment={open} />);
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /add a department/i }));
    expect(open).toHaveBeenCalled();
  });
});
