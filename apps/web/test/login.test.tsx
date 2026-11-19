// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Login, type LoginClient } from '../components/Login';

afterEach(cleanup);

const client = (over: Partial<LoginClient> = {}) =>
  ({
    signInWithPasskey: vi.fn(async () => undefined),
    enrol: vi.fn(async () => undefined),
    addPasskey: vi.fn(async () => undefined),
    ...over,
  }) satisfies LoginClient;

describe('login page (S1-10)', () => {
  it('signs in with a passkey and goes on', async () => {
    const c = client();
    const done = vi.fn();
    render(<Login client={c} onSignedIn={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(c.signInWithPasskey).toHaveBeenCalledTimes(1);
  });

  it('shows why a passkey sign-in failed and stays on the page', async () => {
    const done = vi.fn();
    render(<Login client={client({ signInWithPasskey: vi.fn(async () => Promise.reject(new Error('No passkey found on this device.'))) })} onSignedIn={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    expect(await screen.findByText(/No passkey found/)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
  });

  it('takes a setup code, then offers to save a passkey on this device', async () => {
    const c = client();
    const done = vi.fn();
    render(<Login client={c} onSignedIn={done} />);
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'abcde-fghjk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use code' }));
    expect(await screen.findByRole('button', { name: 'Save a passkey on this device' })).toBeTruthy();
    expect(c.enrol).toHaveBeenCalledWith('abcde-fghjk');
    expect(done).not.toHaveBeenCalled(); // signed in, but not finished until a passkey is saved or skipped
    fireEvent.click(screen.getByRole('button', { name: 'Save a passkey on this device' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(c.addPasskey).toHaveBeenCalledTimes(1);
  });

  it('lets you skip saving a passkey', async () => {
    const done = vi.fn();
    render(<Login client={client()} onSignedIn={done} />);
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'abcde-fghjk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(done).toHaveBeenCalled();
  });

  it('shows a refused code plainly and ignores an empty one', async () => {
    const c = client({ enrol: vi.fn(async () => Promise.reject(new Error('That code did not work.'))) });
    render(<Login client={c} onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use code' }));
    expect(c.enrol).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use code' }));
    expect(await screen.findByText('That code did not work.')).toBeTruthy();
  });

  it('says where the setup code is', () => {
    render(<Login client={client()} onSignedIn={vi.fn()} />);
    expect(screen.getByText(/owner-setup-code\.txt/)).toBeTruthy();
  });
});
