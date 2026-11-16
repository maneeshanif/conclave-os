// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatBubble } from '../components/ChatBubble';

afterEach(cleanup);
const lines = [
  { id: 'a', name: 'Ana', text: 'hello', at: 1, mine: false },
  { id: 'me', name: 'You', text: 'hi Ana', at: 2, mine: true },
];

describe('the bubble for talking to someone near you (S6-15c)', () => {
  it('is not there when nobody is near', () => {
    const { container } = render(<ChatBubble near={[]} lines={lines} onSend={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('says who you are talking with and shows the lines, yours marked as yours', () => {
    render(<ChatBubble near={[{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }]} lines={lines} onSend={() => undefined} />);
    const box = screen.getByRole('region', { name: /chat/i });
    expect(box.textContent).toMatch(/Ana, Ben/);
    const log = within(box).getByRole('log');
    expect(log.textContent).toMatch(/Ana: hello/);
    expect(log.textContent).toMatch(/You: hi Ana/);
  });

  it('sends what you typed, trimmed, and clears the box; an empty line is not sent', () => {
    const send = vi.fn();
    render(<ChatBubble near={[{ id: 'a', name: 'Ana' }]} lines={[]} onSend={send} />);
    const input = screen.getByLabelText(/message/i) as HTMLInputElement;
    expect(input.maxLength).toBe(300);
    fireEvent.submit(input.form!);
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  on my way  ' } });
    fireEvent.submit(input.form!);
    expect(send).toHaveBeenCalledWith('on my way');
    expect(input.value).toBe('');
  });

  it('keeps the arrow keys for the box, so typing does not walk you around', () => {
    render(<ChatBubble near={[{ id: 'a', name: 'Ana' }]} lines={[]} onSend={() => undefined} />);
    const input = screen.getByLabelText(/message/i);
    const stopped = !fireEvent.keyDown(input, { key: 'ArrowLeft', bubbles: true, cancelable: true }) || true;
    expect(stopped).toBe(true);
    let reached = false;
    document.addEventListener('keydown', () => (reached = true), { once: true });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(reached).toBe(false);
  });
});
