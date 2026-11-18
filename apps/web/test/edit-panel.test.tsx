// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel, type EditTool } from '../components/EditPanel';
import { OfficeBar } from '../components/OfficeBar';
import { dragAction, grabs, tileAction } from '../office/edit';

afterEach(cleanup);

describe('the editing panel (S6B-9)', () => {
  it('lists every picture with its size, and picking one is the tool', () => {
    const pick = vi.fn();
    render(<EditPanel tool={null} message={null} onTool={pick} onDone={() => undefined} />);
    const panel = screen.getByRole('dialog', { name: /edit the office/i });
    fireEvent.click(within(panel).getByRole('button', { name: /sofa.*2 by 1/i }));
    expect(pick).toHaveBeenCalledWith({ kind: 'place', name: 'sofa', turn: 0 });
    fireEvent.click(within(panel).getByRole('button', { name: /^remove/i }));
    expect(pick).toHaveBeenLastCalledWith({ kind: 'remove' });
  });

  it('shows which tool is chosen, lets a chair be turned, and says what happened', () => {
    const pick = vi.fn();
    const tool: EditTool = { kind: 'place', name: 'chair', turn: 0 };
    const { rerender } = render(<EditPanel tool={tool} message="That would block the way to Outreach." onTool={pick} onDone={() => undefined} />);
    expect(screen.getByRole('button', { name: /^chair \(/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/block the way to Outreach/);
    fireEvent.click(screen.getByRole('button', { name: /turn/i }));
    expect(pick).toHaveBeenCalledWith({ kind: 'place', name: 'chair', turn: 90 });
    rerender(<EditPanel tool={{ kind: 'place', name: 'chair', turn: 270 }} message={null} onTool={pick} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /turn/i }));
    expect(pick).toHaveBeenLastCalledWith({ kind: 'place', name: 'chair', turn: 0 });
  });

  it('has a Done button, and is offered in the Tools menu', () => {
    const done = vi.fn();
    render(<EditPanel tool={null} message={null} onTool={() => undefined} onDone={done} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(done).toHaveBeenCalled();
    cleanup();
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onEdit={open} />);
    fireEvent.click(screen.getByRole('button', { name: /tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /edit the office/i }));
    expect(open).toHaveBeenCalled();
  });
});

describe('moving and undoing from the panel (S6C-2)', () => {
  it('has a Move tool and an Undo button that tells the page', () => {
    const pick = vi.fn();
    const undo = vi.fn();
    render(<EditPanel tool={null} message={null} onTool={pick} onDone={() => undefined} onUndo={undo} />);
    fireEvent.click(screen.getByRole('button', { name: /^move/i }));
    expect(pick).toHaveBeenCalledWith({ kind: 'move', id: null });
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(undo).toHaveBeenCalled();
  });

  it('says what to do next with the Move tool', () => {
    const { rerender } = render(<EditPanel tool={{ kind: 'move', id: null }} message={null} onTool={() => undefined} onDone={() => undefined} onUndo={() => undefined} />);
    expect(screen.getByText(/click the piece to move/i)).toBeTruthy();
    rerender(<EditPanel tool={{ kind: 'move', id: 7 }} message={null} onTool={() => undefined} onDone={() => undefined} onUndo={() => undefined} />);
    expect(screen.getByText(/now click where it goes/i)).toBeTruthy();
  });

  it('leaves Undo out when the page cannot undo', () => {
    render(<EditPanel tool={null} message={null} onTool={() => undefined} onDone={() => undefined} />);
    expect(screen.queryByRole('button', { name: /^undo$/i })).toBeNull();
  });
});

describe('what a click does while editing (S6B-9)', () => {
  const decor = [{ id: 7, x: 10, y: 4, w: 2, h: 1 }];
  it('places the picked piece on the tile, or removes the piece on the tile, and otherwise lets you walk', () => {
    expect(tileAction({ kind: 'place', name: 'plant', turn: 0 }, { x: 3, y: 5 }, decor)).toEqual({ kind: 'place', name: 'plant', x: 3, y: 5 });
    expect(tileAction({ kind: 'place', name: 'chair', turn: 90 }, { x: 3, y: 5 }, decor)).toEqual({ kind: 'place', name: 'chair', x: 3, y: 5, turn: 90 });
    expect(tileAction({ kind: 'remove' }, { x: 11, y: 4 }, decor)).toEqual({ kind: 'remove', id: 7 });
    expect(tileAction({ kind: 'remove' }, { x: 0, y: 0 }, decor)).toEqual({ kind: 'nothing', why: 'Click a piece of scenery to remove it.' });
    expect(tileAction(null, { x: 3, y: 5 }, decor)).toBeNull();
    // Move: the first click picks a piece up, the second puts it down.
    expect(tileAction({ kind: 'move', id: null }, { x: 10, y: 4 }, decor)).toEqual({ kind: 'pick', id: 7 });
    expect(tileAction({ kind: 'move', id: null }, { x: 0, y: 0 }, decor)).toEqual({ kind: 'nothing', why: 'Click the piece to move.' });
    expect(tileAction({ kind: 'move', id: 7 }, { x: 20, y: 9 }, decor)).toEqual({ kind: 'move', id: 7, x: 20, y: 9 });
  });

  it('has a door tool: a click on a tile asks for a door there, whatever is under it, and the panel has a Door button (S6C-2)', () => {
    expect(tileAction({ kind: 'door' }, { x: 7, y: 9 }, [])).toEqual({ kind: 'door', x: 7, y: 9 });
    expect(tileAction({ kind: 'door' }, { x: 7, y: 9 }, [{ id: 1, x: 7, y: 9, w: 1, h: 1 }])).toEqual({ kind: 'door', x: 7, y: 9 });
  });

  it('drags a piece with the Move tool: a press on a piece grabs it, and it lands keeping the spot it was held by (S6C-2)', () => {
    const decor = [{ id: 4, x: 10, y: 5, w: 3, h: 2 }];
    const move = { kind: 'move' as const, id: null };
    expect(grabs(move, { x: 11, y: 5 }, decor)).toBe(true);
    expect(grabs(move, { x: 20, y: 20 }, decor)).toBe(false); // empty floor: the press pans the view
    expect(grabs({ kind: 'remove' }, { x: 11, y: 5 }, decor)).toBe(false);
    expect(grabs(null, { x: 11, y: 5 }, decor)).toBe(false);
    // Held by its middle tile and dropped two tiles right and one down: the whole piece moves by that much.
    expect(dragAction(move, { x: 11, y: 5 }, { x: 13, y: 6 }, decor)).toEqual({ kind: 'move', id: 4, x: 12, y: 6 });
    expect(dragAction(move, { x: 11, y: 5 }, { x: 11, y: 5 }, decor)).toBeNull(); // not moved
    expect(dragAction(move, { x: 0, y: 0 }, { x: 3, y: 3 }, decor)).toBeNull(); // nothing was held
    expect(dragAction({ kind: 'remove' }, { x: 11, y: 5 }, { x: 13, y: 6 }, decor)).toBeNull();
  });
});
