// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VoiceCallPreferences, VoiceCallPreferencesPatch } from '@xopcai/realtime-protocol/voice';

import { PersonalCallSettings } from '../personal-call-settings';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const mounted = vi.fn();
const pending: Array<{ patch: VoiceCallPreferencesPatch; resolve: (saved: boolean) => void }> = [];

function Assistant() {
  useEffect(() => { mounted(); }, []);
  return <input aria-label="Assistant voice" defaultValue="Mia" />;
}

function Harness() {
  const [preferences, setPreferences] = useState<VoiceCallPreferences>({ defaultMode: 'assistant', openingGreetingEnabled: true });
  const save = async (patch: VoiceCallPreferencesPatch) => {
    const saved = await new Promise<boolean>(resolve => pending.push({ patch, resolve }));
    if (saved) setPreferences(current => ({ ...current, defaultMode: patch.defaultMode ?? current.defaultMode }));
    return saved;
  };
  return <PersonalCallSettings preferences={preferences} settings={{ credentialSource: 'env', defaultForNatural: true, voice: 'default', legacyModel: null }}
    failed={false} disabled={pending.length > 0} zh={false} onChange={save}>
    {() => <Assistant />}
  </PersonalCallSettings>;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  pending.length = 0;
  mounted.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
}

it('switches immediately, retains the mounted assistant and keeps the latest choice during queued saves', async () => {
  const assistant = container.querySelector('[aria-label="Assistant voice"]');
  await act(async () => button('Natural voice').click());
  expect(button('Natural voice').getAttribute('aria-pressed')).toBe('true');
  expect(assistant?.closest('[inert]')).not.toBeNull();
  await act(async () => button('Current assistant').click());
  await act(async () => pending[0].resolve(true));
  expect(button('Current assistant').getAttribute('aria-pressed')).toBe('true');
  await act(async () => pending[1].resolve(true));
  expect(button('Current assistant').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('[aria-label="Assistant voice"]')).toBe(assistant);
  expect(mounted).toHaveBeenCalledOnce();
});

it('restores the saved call mode when the latest save fails', async () => {
  await act(async () => button('Natural voice').click());
  expect(button('Natural voice').getAttribute('aria-pressed')).toBe('true');
  await act(async () => pending[0].resolve(false));
  expect(button('Current assistant').getAttribute('aria-pressed')).toBe('true');
});
