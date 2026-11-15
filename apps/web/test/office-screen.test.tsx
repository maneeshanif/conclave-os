// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(query),
}));
// The world needs a canvas and the list needs the server: stand in for both, and keep what this test is about.
vi.mock('../components/OfficeWorld', () => ({
  OfficeWorld: ({ onPanel, onOpen, onOpenList, onFail }: { onPanel: (id: string) => void; onOpen: (id: string | null) => void; onOpenList?: () => void; onFail?: () => void }) => (
    <>
      <button type="button" onClick={() => onOpenList?.()}>
        open the list
      </button>
      <button type="button" onClick={() => onOpen('11111111-1111-4111-8111-111111111111')}>
        walk up to an agent
      </button>
      <button type="button" onClick={() => onOpen(null)}>
        walk away
      </button>
      <button type="button" onClick={() => onFail?.()}>
        the world cannot start
      </button>
      <button type="button" onClick={() => onPanel('approvals')}>
        use the approvals desk
      </button>
      <button type="button" onClick={() => onPanel('run-log')}>
        use the terminal
      </button>
    </>
  ),
}));
vi.mock('../components/OfficeView', () => ({
  realOfficeClient: {},
  OfficeView: ({ onPanel }: { onPanel?: (id: string, ctx?: { dept?: string }) => void }) => (
    <>
      <button type="button" onClick={() => onPanel?.('goals')}>
        goal ladder (list)
      </button>
      <button type="button" onClick={() => onPanel?.('department-board', { dept: 'outreach' })}>
        outreach board (list)
      </button>
    </>
  ),
}));
const tasks = vi.fn();
vi.mock('../lib/api', () => ({ api: { tasks: () => tasks() } }));
vi.mock('../components/PanelContent', () => ({ PanelContent: (s: { id: string; task?: string; dept?: string }) => <p>the {s.id} panel{s.task ? ` for ${s.task}` : ''}{s.dept ? ` of ${s.dept}` : ''}</p> }));

import { OfficeScreen } from '../components/OfficeScreen';

beforeEach(() => {
  push.mockReset();
  tasks.mockReset();
  query = '';
});
afterEach(cleanup);

describe('the office with its panels (S6-12a)', () => {
  it('opens no panel at first', () => {
    render(<OfficeScreen base="/office" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a panel when an object is used in the world, and again from the list, by changing the address', () => {
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /approvals desk/ }));
    expect(push).toHaveBeenLastCalledWith('/office?panel=approvals');
    cleanup();
    query = 'panel=rooms'; // the list is a panel now
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /goal ladder/ }));
    expect(push).toHaveBeenLastCalledWith('/office?panel=goals');
  });

  it('opens a department\'s board for the department the object is in', () => {
    query = 'panel=rooms';
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /outreach board/ }));
    expect(push).toHaveBeenLastCalledWith('/office?panel=department-board&dept=outreach');
  });

  it('opens the list of rooms and agents from the world\'s bar, as a panel with its own address', () => {
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /open the list/ }));
    expect(push).toHaveBeenLastCalledWith('/office?panel=rooms');
  });

  it('opens the list on an agent when you walk up to it, and closes it again when you walk away', () => {
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /walk up to an agent/ }));
    expect(push).toHaveBeenLastCalledWith('/office?panel=rooms&agent=11111111-1111-4111-8111-111111111111');
    cleanup();
    query = 'panel=rooms&agent=11111111-1111-4111-8111-111111111111';
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /walk away/ }));
    expect(push).toHaveBeenLastCalledWith('/office');
  });

  it('does not close a panel you opened yourself when you walk away from an agent', () => {
    query = 'panel=goals';
    render(<OfficeScreen base="/office" />);
    push.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /walk away/ }));
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the list as the page when the world cannot start, so the office is never only the canvas', () => {
    render(<OfficeScreen base="/office" />);
    expect(screen.queryByRole('region', { name: /rooms and agents/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /the world cannot start/ }));
    expect(screen.getByRole('region', { name: /rooms and agents/i })).toBeTruthy();
  });

  it('fills the screen with the world: nothing else takes room on the page', () => {
    const { container } = render(<OfficeScreen base="/office" />);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/fixed|h-dvh|h-screen/);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/inset-0|w-screen|w-full/);
  });

  it('shows the panel the address asks for, so a link or a reload opens it', () => {
    query = 'panel=needs-you';
    render(<OfficeScreen base="/office" />);
    expect(screen.getByRole('dialog', { name: 'Needs you' }).textContent).toMatch(/the needs-you panel/);
  });

  it('shows a run log for the task in the address', () => {
    query = 'panel=run-log&task=123e4567-e89b-12d3-a456-426614174000';
    render(<OfficeScreen base="/office" />);
    expect(screen.getByRole('dialog', { name: 'Run log' }).textContent).toMatch(/for 123e4567/);
  });

  it('shows nothing for a panel it does not know', () => {
    query = 'panel=vending-machine';
    render(<OfficeScreen base="/office" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing goes back to the office with nothing open', () => {
    query = 'panel=goals';
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(push).toHaveBeenLastCalledWith('/office');
  });

  it('opens the run log of the latest task that has a run when the terminal is used', async () => {
    tasks.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111', last_run_id: null },
      { id: '22222222-2222-4222-8222-222222222222', last_run_id: 'r1' },
      { id: '33333333-3333-4333-8333-333333333333', last_run_id: 'r2' },
    ]);
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /use the terminal/ }));
    await vi.waitFor(() => expect(push).toHaveBeenLastCalledWith('/office?panel=run-log&task=22222222-2222-4222-8222-222222222222'));
  });

  it('opens the tasks panel instead when the terminal is used and nothing has run yet, or the server cannot be reached', async () => {
    tasks.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', last_run_id: null }]);
    render(<OfficeScreen base="/office" />);
    fireEvent.click(screen.getByRole('button', { name: /use the terminal/ }));
    await vi.waitFor(() => expect(push).toHaveBeenLastCalledWith('/office?panel=tasks'));
    tasks.mockRejectedValue(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: /use the terminal/ }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    expect(push).toHaveBeenLastCalledWith('/office?panel=tasks');
  });

  it('ignores an object that has no panel here', () => {
    render(<OfficeScreen base="/office" />);
    expect(push).not.toHaveBeenCalled();
  });
});
