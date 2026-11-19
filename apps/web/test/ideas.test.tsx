// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdeasView, type IdeasClient } from '../components/IdeasView';
import type { VideoIdea } from '../lib/api';

afterEach(cleanup);

const idea = (over: Partial<VideoIdea> = {}): VideoIdea => ({ id: 'i1', idea: 'A clip of a booking page losing a patient', kind: 'line', url: null, source: 'founder', stage: 'idea', hookId: null, createdAt: '2026-11-13T05:00:00Z', ...over });
const client = (rows: VideoIdea[] | Error) =>
  ({
    ideas: vi.fn(async (stage?: string) => (rows instanceof Error ? Promise.reject(rows) : rows.filter((r) => !stage || r.stage === stage))),
    add: vi.fn(async () => undefined),
    shelve: vi.fn(async () => undefined),
    unshelve: vi.fn(async () => undefined),
    toBrief: vi.fn(async () => undefined),
  }) satisfies IdeasClient;

describe('the Video Ideas page (S5-7)', () => {
  it('has a quick-add box that sends the line and clears itself', async () => {
    const c = client([]);
    render(<IdeasView client={c} />);
    const box = (await screen.findByLabelText(/new idea/i)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Show the phone-first problem' } });
    fireEvent.click(screen.getByRole('button', { name: /^add idea$/i }));
    await waitFor(() => expect(c.add).toHaveBeenCalledWith('Show the phone-first problem', 'line'));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('does not send an empty box', async () => {
    const c = client([]);
    render(<IdeasView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /^add idea$/i }));
    expect(c.add).not.toHaveBeenCalled();
  });

  it('can add a spoken idea as a transcript', async () => {
    const c = client([]);
    render(<IdeasView client={c} />);
    fireEvent.change(await screen.findByLabelText(/new idea/i), { target: { value: 'So I was thinking about the booking page' } });
    fireEvent.click(screen.getByLabelText(/this is a voice note/i));
    fireEvent.click(screen.getByRole('button', { name: /^add idea$/i }));
    await waitFor(() => expect(c.add).toHaveBeenCalledWith('So I was thinking about the booking page', 'voice'));
  });

  it('lists ideas, shows a link as a link and a hook-scout idea as one, and the empty state', async () => {
    render(<IdeasView client={client([idea(), idea({ id: 'i2', idea: 'https://youtube.test/watch?v=1', kind: 'link', url: 'https://youtube.test/watch?v=1' }), idea({ id: 'i3', idea: 'Use the list pattern', source: 'hook_scout', hookId: 'h1' })])} />);
    expect(await screen.findByText('A clip of a booking page losing a patient')).toBeTruthy();
    const link = screen.getByRole('link', { name: /youtube\.test/ }) as HTMLAnchorElement;
    expect(link.href).toBe('https://youtube.test/watch?v=1');
    expect(link.rel).toContain('noopener');
    expect(screen.getByText(/from the hook scout/i)).toBeTruthy();
    cleanup();
    render(<IdeasView client={client([])} />);
    expect(await screen.findByText(/no ideas yet/i)).toBeTruthy();
  });

  it('shelves an idea, brings one back, and turns one into a brief', async () => {
    const c = client([idea(), idea({ id: 'i9', idea: 'shelved one', stage: 'shelved' })]);
    render(<IdeasView client={c} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn into a brief/i }));
    await waitFor(() => expect(c.toBrief).toHaveBeenCalledWith('i1'));
    fireEvent.click(screen.getByRole('button', { name: /shelve/i }));
    await waitFor(() => expect(c.shelve).toHaveBeenCalledWith('i1'));
    fireEvent.click(screen.getByRole('tab', { name: /shelved/i }));
    fireEvent.click(await screen.findByRole('button', { name: /bring back/i }));
    await waitFor(() => expect(c.unshelve).toHaveBeenCalledWith('i9'));
  });

  it('shows text from outside as text, never markup, and a bad link as plain text', async () => {
    render(<IdeasView client={client([idea({ idea: '<img src=x onerror=alert(1)> hi' }), idea({ id: 'x', idea: 'javascript:alert(1)', kind: 'link', url: 'javascript:alert(1)' })])} />);
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> hi/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull();
  });

  it('says so, with the address, when the server cannot be reached', async () => {
    render(<IdeasView client={client(new Error('Failed to fetch'))} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot reach the server/i);
  });
});
