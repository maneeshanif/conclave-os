// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { OBJECT_PANELS, panelFor } from '@conclave/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullsView, type PullsClient } from '../components/PullsView';
import type { PullRequest } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({ id: 'p1', project: 'acme-site', number: 1, title: 'Add the page', summary: 'A page for Acme.', branch: 'task/1', base: 'main', head: 'aaaaaaaaaaaa', status: 'open', connector: 'local', url: null, approvedBy: 'founder', mergedBy: null, createdAt: '2026-11-20T10:00:00Z', mergedAt: null, testsPassed: true, mergeRequest: null, ...over });
const client = (rows: PullRequest[] | Error): PullsClient => ({ pulls: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)) });

describe('the Pull requests panel', () => {
  it('lists each pull request with its branch, its tests, who approved it and where a merge stands', async () => {
    render(<PullsView client={client([pr({ mergeRequest: 'pending' }), pr({ id: 'p2', number: 2, title: 'Fix it', status: 'merged', mergedBy: 'founder', testsPassed: false })])} />);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toMatch(/acme-site #1: Add the page/);
    expect(cards[0]!.textContent).toMatch(/task\/1 into main · commit aaaaaaaaaaaa · tests passed/);
    expect(cards[0]!.textContent).toMatch(/A merge is waiting for your yes/);
    expect(cards[1]!.textContent).toMatch(/Merged/);
    expect(cards[1]!.textContent).toMatch(/tests not shown as passed/);
    expect(cards[1]!.textContent).toMatch(/merged by founder/);
  });

  it('links only to a web address, shows text as text, and says plainly when there is nothing or the server is down', async () => {
    const { unmount } = render(<PullsView client={client([pr({ url: 'javascript:alert(1)', title: '<img src=x onerror=alert(1)>' })])} />);
    const card = await screen.findByRole('article');
    expect(card.querySelector('a')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
    unmount();
    const { unmount: u2 } = render(<PullsView client={client([pr({ url: 'https://github.com/acme/site/pull/1' })])} />);
    expect((await screen.findByRole('link', { name: 'Open on the host' })).getAttribute('href')).toBe('https://github.com/acme/site/pull/1');
    u2();
    const { unmount: u3 } = render(<PullsView client={client([])} />);
    expect(await screen.findByText(/No pull requests yet/)).toBeTruthy();
    u3();
    render(<PullsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from the board in the Hall and from a link', () => {
    expect(panelFor('pr-board')).toMatchObject({ panel: 'pulls', ready: true });
    expect(OBJECT_PANELS['pr-board'].label).toBe('Pull requests');
    expect(PANEL_IDS as readonly string[]).toContain('pulls');
    expect(panelHref('pulls')).toBe('/?panel=pulls');
    expect(parsePanel('?panel=pulls')).toEqual({ id: 'pulls' });
  });
});
