// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { OBJECT_PANELS, OBJECT_TYPES, panelFor } from '@conclave/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentsView, type DeploymentsClient } from '../components/DeploymentsView';
import type { Deployment } from '../lib/api';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);

const dep = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'd1',
  projectKey: 'acme-site',
  client: 'Acme',
  ref: 'abcdef1234567890',
  status: 'live',
  url: 'http://127.0.0.1:5001/',
  error: null,
  approvedBy: 'founder',
  createdAt: '2026-11-18T10:00:00Z',
  finishedAt: '2026-11-18T10:01:00Z',
  ...over,
});
const client = (rows: Deployment[] | Error): DeploymentsClient => ({ deployments: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)) });

describe('the Deployments panel (S7-9)', () => {
  it('lists every deployment with its client, project, status, who approved it, and a preview link for a live one', async () => {
    render(<DeploymentsView client={client([dep(), dep({ id: 'd2', projectKey: 'beta-site', client: null, status: 'failed', url: null, error: 'The build failed: boom' })])} />);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('acme-site')).toBeTruthy();
    expect(within(cards[0]!).getByText('Acme')).toBeTruthy();
    expect(within(cards[0]!).getByText(/live/i)).toBeTruthy();
    expect(within(cards[0]!).getByText(/founder/)).toBeTruthy();
    expect(within(cards[0]!).getByText(/abcdef12/)).toBeTruthy();
    expect(within(cards[0]!).getByRole('link', { name: /preview/i }).getAttribute('href')).toBe('http://127.0.0.1:5001/');
  });

  it('says why a failed one failed, and gives it no link', async () => {
    render(<DeploymentsView client={client([dep({ status: 'failed', url: null, error: 'The build failed: boom' })])} />);
    const card = await screen.findByRole('article');
    expect(within(card).getByText(/^Failed$/)).toBeTruthy();
    expect(within(card).getByText(/boom/)).toBeTruthy();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('shows text as text, links only loopback web addresses, and says plainly when there is nothing or the server cannot be reached', async () => {
    const { unmount } = render(<DeploymentsView client={client([dep({ client: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' })])} />);
    const card = await screen.findByRole('article');
    expect(card.querySelector('img')).toBeNull();
    expect(within(card).queryByRole('link')).toBeNull();
    unmount();
    render(<DeploymentsView client={client([])} />);
    expect(await screen.findByText(/nothing has been deployed/i)).toBeTruthy();
    cleanup();
    render(<DeploymentsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });
});

describe('opening the panel (S7-9)', () => {
  it('opens from an object in the world and from a link', () => {
    expect(OBJECT_TYPES).toContain('deploy-board');
    expect(panelFor('deploy-board')).toMatchObject({ panel: 'deployments', ready: true });
    expect(OBJECT_PANELS['deploy-board'].panel).toBe('deployments');
    expect(PANEL_IDS as readonly string[]).toContain('deployments');
    expect(panelHref('deployments')).toBe('/?panel=deployments');
    expect(parsePanel('?panel=deployments')).toEqual({ id: 'deployments' });
  });
});
