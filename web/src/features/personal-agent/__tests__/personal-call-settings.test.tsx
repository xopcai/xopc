// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VoiceCallPreferences, VoiceCallPreferencesPatch } from '@xopcai/realtime-protocol/voice';

import { PersonalCallSettings } from '../personal-call-settings';
vi.mock('@/components/ui/popover-select', () => ({
  Select: ({ children, ...props }: import('react').SelectHTMLAttributes<HTMLSelectElement>) => <select {...props}>{children}</select>,
  SelectOption: ({ children, ...props }: import('react').OptionHTMLAttributes<HTMLOptionElement>) => <option {...props}>{children}</option>,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const mounted = vi.fn();
const pending: Array<{ patch: VoiceCallPreferencesPatch; resolve: (saved: boolean) => void }> = [];

function Assistant() {
  useEffect(() => { mounted(); }, []);
  return <input aria-label="Assistant voice" defaultValue="Mia" />;
}

function Harness() {
  const [preferences, setPreferences] = useState<VoiceCallPreferences>({ enginePreference: 'auto', openingGreetingEnabled: true });
  const save = async (patch: VoiceCallPreferencesPatch) => {
    const saved = await new Promise<boolean>(resolve => pending.push({ patch, resolve }));
    if (saved) setPreferences(current => ({ ...current, enginePreference: patch.enginePreference ?? current.enginePreference }));
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

async function selectEngine(value: string) {
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Call engine"]')!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

it('shows call controls directly with automatic selection and preserves voice settings across engine changes', async () => {
  expect(container.querySelector('[aria-label="Call engine"]')?.closest('details')).toBeNull();
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Call engine"]')?.value).toBe('auto');
  const assistant = container.querySelector('[aria-label="Assistant voice"]');
  await selectEngine('natural');
  expect(assistant?.closest('[inert]')).not.toBeNull();
  await act(async () => pending[0].resolve(true));
  await selectEngine('assistant');
  await act(async () => pending[1].resolve(true));
  expect(pending.map(item => item.patch)).toEqual([{ enginePreference: 'natural' }, { enginePreference: 'assistant' }]);
  expect(container.querySelector('[aria-label="Assistant voice"]')).toBe(assistant);
  expect(mounted).toHaveBeenCalledOnce();
});

it('restores automatic selection when an advanced override fails to save', async () => {
  await selectEngine('natural');
  await act(async () => pending[0].resolve(false));
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Call engine"]')?.value).toBe('auto');
});

it('shows a published Cloud realtime model without a global model and saves its per-Ada selection', async () => {
  const save = vi.fn(async () => true);
  await act(async () => root.render(<PersonalCallSettings preferences={{ enginePreference: 'natural', openingGreetingEnabled: true,
    naturalModel: 'xopc-cloud/realtime' }} settings={{ credentialSource: 'env', defaultForNatural: true, voice: 'default', legacyModel: null,
      naturalModels: [{ id: 'xopc-cloud/realtime', name: 'XOPC Cloud Realtime', tools: false }] }}
    failed={false} disabled={false} zh onChange={save}>{() => null}</PersonalCallSettings>));
  const select = container.querySelector<HTMLSelectElement>('[aria-label="自然语音模型"]')!;
  expect([...select.options].map(option => option.textContent)).toContain('XOPC Cloud Realtime · 仅对话');
  expect(container.textContent).toContain('不能交办任务');
  expect(container.textContent).not.toContain('不可用');
  await act(async () => { select.value = 'inherit'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(save).toHaveBeenLastCalledWith({ naturalModel: null });
  await act(async () => { select.value = 'xopc-cloud/realtime'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(save).toHaveBeenLastCalledWith({ naturalModel: 'xopc-cloud/realtime' });
});
