// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardsView, type BoardsClient } from '../components/BoardsView';
import type { Board } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const t = (id: string, title: string, status: string, assignee: string | null = null) => ({ id, title, status, priority: 3, assignee });
const boards: Board[] = [
  { id: 'g1', key: 'rung-1', title: 'First thousand', kind: 'rung', status: 'active', tasks: [t('1', 'Write the page', 'todo', 'wren'), t('2', 'Find leads', 'in_progress', 'scout'), t('3', 'Old thing', 'done')] },
  { id: 'g2', key: 'rung-2', title: 'Ten thousand', kind: 'rung', status: 'planned', tasks: [] },
  { id: null, key: 'no-goal', title: 'No goal', kind: 'none', status: 'active', tasks: [t('4', 'Odd job', 'blocked')] },
];
const client = (rows: Board[] | Error): BoardsClient => ({ boards: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)) });

describe('the Boards panel', () => {
  it('has a tab for each goal and puts its tasks in the column for where they are', async () => {
    render(<BoardsView client={client(boards)} />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['First thousand (3)', 'Ten thousand (0)', 'No goal (1)']);
    expect(within(screen.getByRole('region', { name: 'To do' })).getByText('Write the page')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'In progress' })).getByText('Find leads')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('Old thing')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'To do' }).textContent).toMatch(/wren/);
    expect(screen.getByText(/A rung goal, active\./)).toBeTruthy();
  });

  it('shows another goal when its tab is picked, and the tasks that serve no goal on their own tab', async () => {
    render(<BoardsView client={client(boards)} />);
    fireEvent.click(await screen.findByRole('tab', { name: /No goal/ }));
    expect(within(screen.getByRole('region', { name: 'Blocked' })).getByText('Odd job')).toBeTruthy();
    expect(screen.getByText('Tasks that serve no goal.')).toBeTruthy();
    expect(screen.queryByText('Write the page')).toBeNull();
  });

  it('shows text as text, says plainly when there is nothing, and when the server cannot be reached', async () => {
    const { unmount } = render(<BoardsView client={client([{ ...boards[0]!, tasks: [t('9', '<img src=x onerror=alert(1)>', 'todo')] }])} />);
    expect((await screen.findByRole('region', { name: 'To do' })).querySelector('img')).toBeNull();
    unmount();
    const { unmount: u2 } = render(<BoardsView client={client([{ id: null, key: 'no-goal', title: 'No goal', kind: 'none', status: 'active', tasks: [] }])} />);
    expect(await screen.findByText('No tasks yet.')).toBeTruthy();
    u2();
    render(<BoardsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from a link', () => {
    expect(PANEL_IDS as readonly string[]).toContain('boards');
    expect(panelHref('boards')).toBe('/?panel=boards');
    expect(parsePanel('?panel=boards')).toEqual({ id: 'boards' });
  });
});
