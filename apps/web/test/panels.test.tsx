// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelHost } from '../components/PanelHost';
import { LEGACY_ROUTES, PANEL_IDS, PANEL_LABELS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

describe('the list of panels and their addresses (S6-12a)', () => {
  it('has a panel for each page that used to be a route, a tasks panel and a run log', () => {
    expect([...PANEL_IDS].sort()).toEqual(['approvals', 'brief', 'campaigns', 'goals', 'health', 'ideas', 'inbox', 'needs-you', 'pipeline', 'run-log', 'signals', 'tasks']);
    for (const id of PANEL_IDS) expect(PANEL_LABELS[id].length, id).toBeGreaterThan(2);
  });

  it('puts the open panel in the address, so it can be linked to', () => {
    expect(panelHref('approvals')).toBe('/?panel=approvals');
    expect(panelHref({ id: 'run-log', task: '123e4567-e89b-12d3-a456-426614174000' })).toBe('/?panel=run-log&task=123e4567-e89b-12d3-a456-426614174000');
    expect(panelHref('goals', '/office')).toBe('/office?panel=goals');
    expect(panelHref({ id: 'goals', task: '123e4567-e89b-12d3-a456-426614174000' })).toBe('/?panel=goals'); // only the run log takes a task
  });

  it('reads the open panel back from an address, and nothing else', () => {
    expect(parsePanel('?panel=goals')).toEqual({ id: 'goals' });
    expect(parsePanel(new URLSearchParams('panel=needs-you'))).toEqual({ id: 'needs-you' });
    expect(parsePanel('?panel=run-log&task=123e4567-e89b-12d3-a456-426614174000')).toEqual({ id: 'run-log', task: '123e4567-e89b-12d3-a456-426614174000' });
    expect(parsePanel('')).toBeNull();
    expect(parsePanel('?panel=vending-machine')).toBeNull();
    expect(parsePanel('?panel=__proto__')).toBeNull();
    expect(parsePanel('?panel=run-log')).toBeNull(); // a run log needs a task
    expect(parsePanel('?panel=run-log&task=<script>')).toBeNull();
  });

  it('maps each old route to its panel, and only those', () => {
    expect(LEGACY_ROUTES).toEqual({
      '/approvals': 'approvals',
      '/action-items': 'needs-you',
      '/brief': 'brief',
      '/inbox': 'inbox',
      '/pipeline': 'pipeline',
      '/campaigns': 'campaigns',
      '/goals': 'goals',
      '/signals': 'signals',
      '/ideas': 'ideas',
      '/health': 'health',
    });
  });
});

describe('the panel over the world (S6-12a)', () => {
  const render_ = (id: string) => <p>contents of {id}</p>;

  it('shows nothing when nothing is open', () => {
    render(<PanelHost state={null} onClose={() => undefined} render={(s) => render_(s.id)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the panel that is open, with its name, and closes from the button and from Escape', () => {
    const close = vi.fn();
    render(<PanelHost state={{ id: 'approvals' }} onClose={close} render={(s) => render_(s.id)} />);
    const d = screen.getByRole('dialog', { name: PANEL_LABELS.approvals });
    expect(d.textContent).toMatch(/contents of approvals/);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('is full screen at phone width and a side panel from tablet width up, so the world stays beside it', () => {
    render(<PanelHost state={{ id: 'goals' }} onClose={() => undefined} render={(s) => render_(s.id)} />);
    const cls = screen.getByRole('dialog').className;
    expect(cls).toMatch(/\binset-0\b/); // phone: the whole screen
    expect(cls).toMatch(/sm:left-auto/); // wider: pinned to the right edge
    expect(cls).toMatch(/sm:w-/); // wider: a width, not the whole screen
  });

  it('can be made wider and narrower again', () => {
    render(<PanelHost state={{ id: 'goals' }} onClose={() => undefined} render={(s) => render_(s.id)} />);
    const before = screen.getByRole('dialog').className;
    fireEvent.click(screen.getByRole('button', { name: /maximi[sz]e/i }));
    expect(screen.getByRole('dialog').className).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: /restore|smaller/i }));
    expect(screen.getByRole('dialog').className).toBe(before);
  });

  it('puts the keyboard focus in the panel when it opens', () => {
    render(<PanelHost state={{ id: 'goals' }} onClose={() => undefined} render={(s) => render_(s.id)} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});
