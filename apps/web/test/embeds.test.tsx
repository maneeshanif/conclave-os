// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedsView, type EmbedsClient } from '../components/EmbedsView';
import { PANEL_IDS, panelHref, parsePanel } from '../lib/panels';

afterEach(cleanup);
const client = (rows: { name: string; url: string }[] | Error): EmbedsClient => ({ tools: vi.fn(async () => (rows instanceof Error ? Promise.reject(rows) : rows)) });
const tools = [{ name: 'Notion', url: 'https://www.notion.so/team' }, { name: 'Miro', url: 'https://miro.com/app/board/1' }];

describe('the embedded tools panel', () => {
  it('shows each tool in a sandboxed frame, with no cookies or referrer sent, and switches between them', async () => {
    render(<EmbedsView client={client(tools)} />);
    const frame = (await screen.findByTitle('Notion')) as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://www.notion.so/team');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toMatch(/allow-top-navigation|allow-modals|allow-downloads/); // it cannot send you away or open dialogs
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('allow')).toBe(''); // no camera, microphone or location
    fireEvent.click(screen.getByRole('tab', { name: 'Miro' }));
    expect((screen.getByTitle('Miro') as HTMLIFrameElement).getAttribute('src')).toBe('https://miro.com/app/board/1');
    expect(screen.queryByTitle('Notion')).toBeNull();
    expect(screen.getByRole('link', { name: /own tab/ }).getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('says plainly when there are none, and when the server cannot be reached', async () => {
    const { unmount } = render(<EmbedsView client={client([])} />);
    expect(await screen.findByText(/No tools yet/)).toBeTruthy();
    unmount();
    render(<EmbedsView client={client(new Error('down'))} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
  });

  it('opens from a link', () => {
    expect(PANEL_IDS as readonly string[]).toContain('embeds');
    expect(panelHref('embeds')).toBe('/?panel=embeds');
    expect(parsePanel('?panel=embeds')).toEqual({ id: 'embeds' });
  });
});
