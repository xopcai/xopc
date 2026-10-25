// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  operate: vi.fn(async () => {}),
  save: vi.fn(),
  config: {
    enabled: true,
    node: { enabled: true, version: '22.22.3' },
    python: { enabled: true }, uv: { enabled: true },
  },
}));
vi.mock('swr', () => ({ default: () => ({ data: { payload: {
  config: mocks.config,
  statuses: [{ runtime: 'node', state: 'corrupted', requestedVersion: '22.22.3', message: 'Needs repair', repairable: true }],
} }, mutate: mocks.mutate }) }));
vi.mock('../runtime-tools-api', () => ({ loadRuntimeTools: vi.fn(), runRuntimeOperation: mocks.operate, saveRuntimeToolsConfig: mocks.save }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: () => 'en' }));

import { RuntimeReadiness } from '../runtime-readiness';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('repairs a dependency in ordinary setup using the saved version without rewriting policies', async () => {
  useSettingsModeStore.setState({ mode: 'simple' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const original = structuredClone(mocks.config);
  await act(async () => root.render(<MemoryRouter><RuntimeReadiness /></MemoryRouter>));
  expect(container.querySelector('details')?.open).toBe(true);
  const repair = [...container.querySelectorAll('button')].find(button => button.textContent === 'Repair')!;
  await act(async () => repair.click());
  expect(mocks.operate).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'node', action: 'repair', version: '22.22.3' }));
  expect(mocks.mutate).toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.config).toEqual(original);
  expect(useSettingsModeStore.getState().mode).toBe('simple');
  expect(container.textContent).toContain('Completed');
});
