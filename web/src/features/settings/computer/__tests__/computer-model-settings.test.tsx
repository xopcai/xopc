// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  defaults: { models: { chat: { primary: 'chat/model', fallbacks: [] }, computerUse: undefined as undefined | { primary: string; fallbacks: string[] } }, tools: { exec: { mode: 'deny' } } },
}));
vi.mock('@/features/settings/global-defaults-api', () => ({
  fetchGlobalDefaults: vi.fn(async () => ({ defaults: structuredClone(fixture.defaults), builtinTools: [] })),
  updateGlobalDefaults: vi.fn(async (defaults) => { fixture.defaults = defaults; return { defaults, builtinTools: [] }; }),
}));
vi.mock('@/features/chat/api/registry-api', () => ({ CONFIGURED_MODELS_SWR_KEY: 'gateway-configured-models', fetchConfiguredModelsCached: async () => [
  { id: 'xopc-cloud/gui', computerUse: { profile: 'gui-plus-2026-02-26' } },
  { id: 'byok/gui', computerUse: { profile: 'structured-tools-v1' } },
] }));
vi.mock('@/features/chat/model/model-selector', () => ({ ModelSelector: ({ value, onChange }: any) => <div>
  <span data-selected>{value || 'none'}</span>
  <button onClick={() => onChange('xopc-cloud/gui')}>Cloud</button>
  <button onClick={() => onChange('byok/gui')}>BYOK</button>
  <button onClick={() => onChange('')}>Clear</button>
</div> }));
import { ComputerModelSettings } from '../computer-model-settings';
import { updateGlobalDefaults } from '@/features/settings/global-defaults-api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  fixture.defaults.models.computerUse = undefined;
  vi.clearAllMocks();
});

it.each(['Cloud', 'BYOK'])('keeps both entry points synchronized when selecting %s and clearing', async provider => {
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter>
    <ComputerModelSettings zh /><ComputerModelSettings zh />
  </MemoryRouter></SWRConfig>));
  const first = container.querySelector('section')!;
  const click = async (label: string) => act(async () => [...first.querySelectorAll('button')].find(button => button.textContent === label)!.click());
  await click(provider);
  expect([...container.querySelectorAll('[data-selected]')].map(node => node.textContent)).toEqual([provider === 'Cloud' ? 'xopc-cloud/gui' : 'byok/gui', 'none']);
  await click('保存模型');
  const selected = provider === 'Cloud' ? 'xopc-cloud/gui' : 'byok/gui';
  expect([...container.querySelectorAll('[data-selected]')].map(node => node.textContent)).toEqual([selected, selected]);
  expect(updateGlobalDefaults).toHaveBeenCalledWith(expect.objectContaining({ tools: { exec: { mode: 'deny' } }, models: {
    chat: { primary: 'chat/model', fallbacks: [] }, computerUse: { primary: selected, fallbacks: [] },
  } }));
  await click('Clear'); await click('保存模型');
  expect(fixture.defaults.models.computerUse).toBeUndefined();
  expect([...container.querySelectorAll('[data-selected]')].map(node => node.textContent)).toEqual(['none', 'none']);
});
