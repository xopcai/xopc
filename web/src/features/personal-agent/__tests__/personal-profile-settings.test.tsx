// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchJson } from '@/lib/fetch';
import { PersonalProfileSettings } from '../personal-profile-settings';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('../personal-model-setting', () => ({ PersonalModelSetting: () => <div data-testid="chat-model" /> }));
vi.mock('../personal-voice-setting', () => ({ PersonalVoiceSetting: () => <div data-testid="assistant-voice" /> }));
vi.mock('../personal-avatar', () => ({ PersonalAvatar: ({ appearance }: { appearance: string }) => <span data-appearance={appearance} /> }));
vi.mock('@/components/ui/popover-select', () => ({
  Select: ({ children, ...props }: import('react').SelectHTMLAttributes<HTMLSelectElement>) => <select {...props}>{children}</select>,
  SelectOption: ({ children, ...props }: import('react').OptionHTMLAttributes<HTMLOptionElement>) => <option {...props}>{children}</option>,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let profile = { agentId: 'personal', conversationId: 'conversation-1', state: 'ready', displayName: 'Ada',
    appearance: 'loopi', voicePreference: null, voiceCallPreferences: { openingGreetingEnabled: true, enginePreference: 'natural' }, revision: 1 };
  vi.mocked(fetchJson).mockImplementation(async (url, options) => {
    if (String(url).includes('/api/voice/boson')) return { payload: { credentialSource: 'env', defaultForNatural: true, voice: 'default', legacyModel: null } };
    if (options?.method === 'PATCH') profile = { ...profile, ...JSON.parse(String(options.body)), revision: profile.revision + 1 };
    return { ok: true, payload: profile };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><PersonalProfileSettings zh={false} /></MemoryRouter></SWRConfig>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

it('edits the avatar on the settings page and saves the chosen appearance', async () => {
  const avatar = container.querySelector<HTMLButtonElement>('[aria-label="Choose avatar"]')!;
  expect(avatar).not.toBeNull();
  expect(container.querySelector('#personal-appearance-options')).toBeNull();
  await act(async () => avatar.click());
  const curious = [...container.querySelectorAll<HTMLButtonElement>('#personal-appearance-options button')].find(button => button.textContent === 'Curious')!;
  await act(async () => curious.click());
  const patch = vi.mocked(fetchJson).mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(String(patch?.[1]?.body)).appearance).toBe('loopi-curious');
  expect(avatar.getAttribute('aria-expanded')).toBe('false');
  expect(avatar.querySelector('[data-appearance]')?.getAttribute('data-appearance')).toBe('loopi-curious');
});

it('saves the assistant name on blur and keeps the call preferences available', async () => {
  const name = container.querySelector<HTMLInputElement>('[aria-label="Assistant name"]')!;
  await act(async () => { name.focus(); name.value = 'Nova'; name.blur(); });
  const patch = vi.mocked(fetchJson).mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(String(patch?.[1]?.body)).displayName).toBe('Nova');
  expect(container.querySelector('[data-testid="chat-model"]')).not.toBeNull();
  const engine = container.querySelector<HTMLSelectElement>('[aria-label="Call engine"]')!;
  expect(engine.closest('details')).toBeNull();
  await act(async () => { engine.value = 'assistant'; engine.dispatchEvent(new Event('change', { bubbles: true })); });
  const lastPatch = vi.mocked(fetchJson).mock.calls.filter(([, options]) => options?.method === 'PATCH').at(-1);
  expect(JSON.parse(String(lastPatch?.[1]?.body)).voiceCallPreferences).toEqual({ enginePreference: 'assistant' });
  expect(container.textContent).not.toContain('Privacy');
});

it('uses the latest profile revision when an earlier quick-setting save completes after navigation', async () => {
  await act(async () => window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: {
    agentId: 'personal', conversationId: 'conversation-1', state: 'ready', displayName: 'Nova', appearance: 'loopi',
    voicePreference: null, voiceCallPreferences: { openingGreetingEnabled: true, enginePreference: 'assistant' }, revision: 7,
  } })));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Assistant name"]')?.value).toBe('Nova');
  const engine = container.querySelector<HTMLSelectElement>('[aria-label="Call engine"]')!;
  expect(engine.value).toBe('assistant');
  await act(async () => { engine.value = 'auto'; engine.dispatchEvent(new Event('change', { bubbles: true })); });
  const patch = vi.mocked(fetchJson).mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(String(patch?.[1]?.body)).revision).toBe(7);
});
