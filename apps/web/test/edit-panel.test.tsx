// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel, type EditTool } from '../components/EditPanel';
import { OfficeBar } from '../components/OfficeBar';
import { tileAction } from '../office/edit';

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

describe('what a click does while editing (S6B-9)', () => {
  const decor = [{ id: 7, x: 10, y: 4, w: 2, h: 1 }];
  it('places the picked piece on the tile, or removes the piece on the tile, and otherwise lets you walk', () => {
    expect(tileAction({ kind: 'place', name: 'plant', turn: 0 }, { x: 3, y: 5 }, decor)).toEqual({ kind: 'place', name: 'plant', x: 3, y: 5 });
    expect(tileAction({ kind: 'place', name: 'chair', turn: 90 }, { x: 3, y: 5 }, decor)).toEqual({ kind: 'place', name: 'chair', x: 3, y: 5, turn: 90 });
    expect(tileAction({ kind: 'remove' }, { x: 11, y: 4 }, decor)).toEqual({ kind: 'remove', id: 7 });
    expect(tileAction({ kind: 'remove' }, { x: 0, y: 0 }, decor)).toEqual({ kind: 'nothing', why: 'Click a piece of scenery to remove it.' });
    expect(tileAction(null, { x: 3, y: 5 }, decor)).toBeNull();
  });
});
