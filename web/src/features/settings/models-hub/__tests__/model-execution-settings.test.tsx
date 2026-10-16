// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ data: null as any, fetch: vi.fn(), update: vi.fn(), refresh: vi.fn() }));
vi.mock('swr', () => ({ default: () => ({ data: mocks.data }) }));
vi.mock('../../global-defaults-api', () => ({ fetchGlobalDefaults: mocks.fetch, updateGlobalDefaults: mocks.update }));
vi.mock('../models-hub-cache', () => ({ revalidateModelsHubCaches: mocks.refresh }));
vi.mock('../model-execution-settings-fields', () => ({
  ModelExecutionSettingsFields: ({ draft, setDraft }: any) => <button onClick={() => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models.imageGeneration, timeoutMs: 123456 } } })}>Change timeout</button>,
}));
import { ModelExecutionSettings } from '../model-execution-settings';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); vi.useFakeTimers();
  mocks.data = { defaults: { models: { chat: { primary: 'plan/chat', fallbacks: [] }, background: { primary: 'xopc-cloud/auto', fallbacks: [] }, imageGeneration: { primary: 'plan/image', fallbacks: [], autoProviderFallback: false }, intents: {} }, runtime: { maxTurns: 10 } } };
  mocks.fetch.mockResolvedValue(structuredClone(mocks.data));
  mocks.update.mockImplementation(async defaults => ({ defaults }));
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it('preserves current non-model settings and all untouched model routes when saving advanced parameters', async () => {
  const latest = structuredClone(mocks.data); latest.defaults.runtime.maxTurns = 99;
  mocks.fetch.mockResolvedValue(latest);
  await act(async () => root.render(<ModelExecutionSettings capability="image" zh disabled={false} onPendingChange={() => {}} />));
  await act(async () => { container.querySelector('button')!.click(); });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(mocks.update).toHaveBeenCalledWith({ ...latest.defaults, models: { ...latest.defaults.models, imageGeneration: { ...latest.defaults.models.imageGeneration, timeoutMs: 123456 } } }, { scope: 'models', expectedModels: mocks.data.defaults.models });
});

it('rejects stale advanced settings instead of restoring a model switched elsewhere', async () => {
  const latest = structuredClone(mocks.data); latest.defaults.models.chat.primary = 'new/chat';
  mocks.fetch.mockResolvedValue(latest);
  await act(async () => root.render(<ModelExecutionSettings capability="image" zh disabled={false} onPendingChange={() => {}} />));
  await act(async () => { container.querySelector('button')!.click(); });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(container.textContent).toContain('模型设置已变化');
});
