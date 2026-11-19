// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementBanner, Megaphone } from '../components/Megaphone';
import { OfficeBar } from '../components/OfficeBar';

afterEach(cleanup);

describe('the megaphone (S6B-7)', () => {
  it('announces what you typed to everyone, trimmed, and waits for something to say', () => {
    const send = vi.fn();
    render(<Megaphone pinned={null} onSend={send} onClose={() => undefined} />);
    const announce = screen.getByRole('button', { name: /^announce$/i }) as HTMLButtonElement;
    expect(announce.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: '  Standup in five  ' } });
    fireEvent.click(announce);
    expect(send).toHaveBeenCalledWith('announce', 'Standup in five');
  });

  it('pins a message for the whole team, and clears the pin when there is one', () => {
    const send = vi.fn();
    const { rerender } = render(<Megaphone pinned={null} onSend={send} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'Demo at 4' } });
    fireEvent.click(screen.getByRole('button', { name: /pin it/i }));
    expect(send).toHaveBeenLastCalledWith('pin', 'Demo at 4');
    expect(screen.queryByRole('button', { name: /clear the pin/i })).toBeNull();
    rerender(<Megaphone pinned={{ text: 'Demo at 4', by: 'Ana' }} onSend={send} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /clear the pin/i }));
    expect(send).toHaveBeenLastCalledWith('pin', '');
  });

  it('limits the message to 200 characters', () => {
    render(<Megaphone pinned={null} onSend={() => undefined} onClose={() => undefined} />);
    expect((screen.getByLabelText(/message/i) as HTMLTextAreaElement).maxLength).toBe(200);
  });

  it('is offered in the bar', () => {
    const open = vi.fn();
    render(<OfficeBar people={[]} availability="available" onAvailability={() => undefined} onOpenAgent={() => undefined} onOverview={() => undefined} onMegaphone={open} />);
    fireEvent.click(screen.getByRole('button', { name: /megaphone/i }));
    expect(open).toHaveBeenCalled();
  });
});

describe('the banners for an announcement and a pinned message (S6B-7)', () => {
  it('shows who said what, and nothing when there is nothing', () => {
    const { container, rerender } = render(<AnnouncementBanner announcement={null} pinned={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<AnnouncementBanner announcement={{ name: 'Ana', text: 'Standup in five' }} pinned={{ text: 'Demo at 4', by: 'Ben' }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Ana.*Standup in five/);
    expect(screen.getByText(/Demo at 4/).textContent).toMatch(/Ben|Pinned/);
  });
});
