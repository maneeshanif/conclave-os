// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanySwitcher, type CompanyClient } from '../components/CompanySwitcher';
import { api } from '../lib/api';
import { currentCompany, eventsUrl, setCurrentCompany } from '../lib/company';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // not available: the tests below do not need it for the default company
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('which company the browser is working in (S6-13a)', () => {
  it('is none until one is chosen, and then remembered', () => {
    expect(currentCompany()).toBeNull();
    setCurrentCompany(ID_A);
    expect(currentCompany()).toBe(ID_A);
    setCurrentCompany(null);
    expect(currentCompany()).toBeNull();
  });

  it('ignores a stored value that is not a company id', () => {
    localStorage.setItem('conclave.company', '<script>');
    expect(currentCompany()).toBeNull();
  });

  it('puts the company on every request, and nothing when there is none', async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return new Response('[]', { status: 200 });
    }));
    await api.tasks();
    expect(seen[0]!['x-company']).toBeUndefined();
    setCurrentCompany(ID_B);
    await api.tasks();
    expect(seen[1]!['x-company']).toBe(ID_B);
  });

  it('puts the company in the address of the live socket too, because a browser cannot add a header there', () => {
    expect(eventsUrl('http://127.0.0.1:3100')).toBe('ws://127.0.0.1:3100/events');
    setCurrentCompany(ID_B);
    expect(eventsUrl('http://127.0.0.1:3100')).toBe(`ws://127.0.0.1:3100/events?company=${ID_B}`);
  });
});

const list = [
  { id: ID_A, slug: 'local', name: 'First Co', isDefault: true },
  { id: ID_B, slug: 'acme', name: 'Acme Studio', isDefault: false },
];
const client = (over: Partial<CompanyClient> = {}): CompanyClient => ({
  list: vi.fn(async () => ({ companies: list, templates: ['starter'] })),
  create: vi.fn(async () => ({ id: ID_B, slug: 'new-one', name: 'New One', isDefault: false })),
  ...over,
});

describe('the company switcher (S6-13a)', () => {
  it('shows the current company, and lists the others when opened, with the current one ticked', async () => {
    setCurrentCompany(ID_B);
    render(<CompanySwitcher client={client()} onSwitch={() => undefined} />);
    const button = await screen.findByRole('button', { name: /company/i });
    expect(button.textContent).toMatch(/Acme Studio/);
    fireEvent.click(button);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['First Co', 'Acme Studio']);
    expect(items.find((i) => i.getAttribute('aria-checked') === 'true')!.textContent).toBe('Acme Studio');
  });

  it('uses the default company when none is chosen', async () => {
    render(<CompanySwitcher client={client()} onSwitch={() => undefined} />);
    expect((await screen.findByRole('button', { name: /company/i })).textContent).toMatch(/First Co/);
  });

  it('switching remembers the choice and tells the page, which reloads what it shows', async () => {
    const onSwitch = vi.fn();
    render(<CompanySwitcher client={client()} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: /company/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Acme Studio' }));
    expect(currentCompany()).toBe(ID_B);
    expect(onSwitch).toHaveBeenCalledWith(ID_B);
  });

  it('choosing the company you are already in does nothing', async () => {
    const onSwitch = vi.fn();
    render(<CompanySwitcher client={client()} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: /company/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'First Co' }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('makes a company from a template, then switches to it', async () => {
    const c = client();
    const onSwitch = vi.fn();
    render(<CompanySwitcher client={c} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: /company/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /new company/i }));
    const form = screen.getByRole('dialog', { name: /new company/i });
    const create = within(form).getByRole('button', { name: /^create$/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true); // no name yet
    fireEvent.change(within(form).getByLabelText(/name/i), { target: { value: 'New One' } });
    expect(within(form).getByLabelText(/template/i).textContent).toMatch(/starter/);
    fireEvent.click(create);
    await waitFor(() => expect(c.create).toHaveBeenCalledWith({ name: 'New One', template: 'starter' }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(ID_B));
    expect(currentCompany()).toBe(ID_B);
  });

  it('shows the reason when a company cannot be made, and stays where it is', async () => {
    const c = client({ create: vi.fn(async () => Promise.reject(new Error('The name needs some letters or numbers in it.'))) });
    const onSwitch = vi.fn();
    render(<CompanySwitcher client={c} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: /company/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /new company/i }));
    const form = screen.getByRole('dialog', { name: /new company/i });
    fireEvent.change(within(form).getByLabelText(/name/i), { target: { value: '!!!' } });
    fireEvent.click(within(form).getByRole('button', { name: /^create$/i }));
    expect(await within(form).findByText(/some letters or numbers/)).toBeTruthy();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('says plainly when the list cannot be loaded', async () => {
    render(<CompanySwitcher client={client({ list: vi.fn(async () => Promise.reject(new Error('down'))) })} onSwitch={() => undefined} />);
    expect(await screen.findByRole('button', { name: /company/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /company/i }));
    expect(await screen.findByText(/cannot load the companies/i)).toBeTruthy();
  });
});
