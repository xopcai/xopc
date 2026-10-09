// @vitest-environment jsdom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import type { GlobalDefaultsPayload } from '@/features/settings/global-defaults-api';

const api = vi.hoisted(() => ({ registry: vi.fn(), defaults: vi.fn(), update: vi.fn(), mutate: vi.fn() }));
vi.mock('@/features/chat/api/registry-api', () => ({ fetchConfiguredModelsCached: api.registry }));
vi.mock('@/features/settings/global-defaults-api', () => ({ fetchGlobalDefaults: api.defaults, updateGlobalDefaults: api.update }));
vi.mock('swr', () => ({ mutate: api.mutate }));
vi.mock('@/features/chat/model/model-selector', () => ({
  ModelSelector: ({ models, onChange }: { models: ConfiguredModel[]; onChange: (id: string) => void }) =>
    <div>{models.map(model => <button key={model.id} onClick={() => onChange(model.id)}>{model.id}</button>)}</div>,
}));

import { defaultModelCandidates, type DefaultModelTarget } from '../default-model-candidates';
import { DefaultModelSuccessStep } from '../default-model-success-step';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const done = vi.fn();
const model = (id: string): ConfiguredModel => ({ id, name: id, provider: 'New provider' });
const initial: GlobalDefaultsPayload = {
  defaults: {
    models: { chat: { primary: 'old/chat', fallbacks: ['old/backup'] }, intents: { coding: { primary: 'old/code', fallbacks: [] } } },
    skills: { mode: 'all-enabled', exclude: [] }, tools: {}, workflows: {}, runtime: { maxTurns: 12 },
  },
  builtinTools: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.registry.mockResolvedValue([model('new/chat')]);
  api.defaults.mockResolvedValue(initial);
  api.update.mockImplementation(async defaults => ({ ...initial, defaults }));
  api.mutate.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.useRealTimers();
});
async function render(target: DefaultModelTarget = { providerId: 'new' }) {
  await act(async () => root!.render(<Dialog.Root open><Dialog.Content>
    <DefaultModelSuccessStep target={target} zh onDone={done} />
  </Dialog.Content></Dialog.Root>));
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(entry => entry.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

it('limits candidates to this addition and excludes computer models and similar provider prefixes', () => {
  const gui = { ...model('new/gui'), computerUse: { profile: 'structured-tools-v1' as const } };
  expect(defaultModelCandidates([model('new/chat'), model('new/other'), model('new-other/chat'), gui], {
    providerId: 'new', modelIds: ['chat', 'gui'],
  })).toEqual([model('new/chat')]);
});

it('keeps the saved configuration when skipping or closing without updating defaults', async () => {
  await render();
  await click('暂不更改');
  expect(done).toHaveBeenCalledOnce();
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]');
  await act(async () => close!.click());
  expect(api.update).not.toHaveBeenCalled();
});

it('reads the latest defaults and preserves fallbacks, task routes and other settings', async () => {
  const latest = { ...initial, defaults: { ...initial.defaults, runtime: { maxTurns: 42 } } };
  api.defaults.mockResolvedValueOnce(initial).mockResolvedValue(latest);
  await render({ providerId: 'new', modelIds: ['chat'] });
  await click('设为全局默认');
  expect(api.update).toHaveBeenCalledWith({ ...latest.defaults, models: {
    ...latest.defaults.models, chat: { ...latest.defaults.models.chat, primary: 'new/chat' },
  } });
  expect(document.body.textContent).toContain('全局默认对话模型已更新');
  expect(api.mutate).toHaveBeenCalledWith('settings-agent-defaults', expect.objectContaining({ defaults: expect.objectContaining({ runtime: { maxTurns: 42 } }) }), false);
});

it('requires an explicit choice when multiple models are added', async () => {
  api.registry.mockResolvedValue([model('new/chat'), model('new/second')]);
  await render();
  const primary = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '设为全局默认');
  expect(primary?.disabled).toBe(true);
  await click('new/second');
  await click('设为全局默认');
  expect(api.update.mock.calls[0][0].models.chat.primary).toBe('new/second');
});

it('offers retry after an update failure without repeating the model configuration save', async () => {
  api.update.mockRejectedValueOnce(new Error('Network failed'));
  await render();
  await click('设为全局默认');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('模型已保存');
  expect(done).not.toHaveBeenCalled();
  await click('重试');
  expect(api.update).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('全局默认对话模型已更新');
});

it('does not write when the model is already the default', async () => {
  api.defaults.mockResolvedValue({ ...initial, defaults: { ...initial.defaults, models: { ...initial.defaults.models, chat: { primary: 'new/chat', fallbacks: [] } } } });
  await render();
  expect(document.body.textContent).toContain('已是全局默认对话模型');
  await click('完成');
  expect(done).toHaveBeenCalledOnce();
  expect(api.update).not.toHaveBeenCalled();
});

it('retries loading and allows completion when no eligible models exist', async () => {
  api.registry.mockRejectedValueOnce(new Error('Catalog unavailable')).mockResolvedValue([]);
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Catalog unavailable');
  await click('重试');
  expect(document.body.textContent).toContain('暂无可设为默认的对话模型');
  await click('完成');
  expect(api.update).not.toHaveBeenCalled();
});

it('rejects a model removed after the success step loaded', async () => {
  api.registry.mockResolvedValueOnce([model('new/chat')]).mockResolvedValue([]);
  await render();
  await click('设为全局默认');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('所选模型已不可用');
  expect(api.update).not.toHaveBeenCalled();
});

it('updates conversation and image understanding defaults together while preserving the image fallback', async () => {
  const vision = { ...model('new/vision'), vision: true };
  api.registry.mockResolvedValue([model('new/chat'), vision]);
  const latest = { ...initial, defaults: { ...initial.defaults, models: {
    ...initial.defaults.models, imageUnderstanding: { primary: 'old/vision', fallbacks: ['old/vision-backup'] },
  } } };
  api.defaults.mockResolvedValue(latest);
  await render();
  const visionCheckbox = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(input => input.parentElement?.textContent?.includes('同时设置图片理解模型'))!;
  expect(visionCheckbox.checked).toBe(false);
  await click('new/chat');
  await act(async () => visionCheckbox.click());
  await click('保存默认配置');
  expect(api.update).toHaveBeenCalledWith({ ...latest.defaults, models: {
    ...latest.defaults.models,
    chat: { primary: 'new/chat', fallbacks: ['old/backup'] },
    imageUnderstanding: { primary: 'new/vision', fallbacks: ['old/vision-backup'] },
  } });
  expect(document.body.textContent).toContain('全局默认模型配置已更新');
});

it('allows updating only image understanding and preserves the conversation route', async () => {
  api.registry.mockResolvedValue([{ ...model('new/vision'), vision: true }]);
  await render();
  const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => { checkboxes[0].click(); checkboxes[1].click(); });
  await click('保存默认配置');
  expect(api.update.mock.calls[0][0].models).toEqual({
    ...initial.defaults.models,
    imageUnderstanding: { primary: 'new/vision', fallbacks: [] },
  });
});

it('leaves image understanding unchanged unless the user opts in', async () => {
  api.registry.mockResolvedValue([{ ...model('new/vision'), vision: true }]);
  await render();
  await click('设为全局默认');
  expect(api.update.mock.calls[0][0].models.imageUnderstanding).toBeUndefined();
});


it('closes the existing dialog after displaying the successful update', async () => {
  vi.useFakeTimers();
  await render();
  await click('设为全局默认');
  expect(document.body.textContent).toContain('全局默认对话模型已更新');
  expect(done).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(done).toHaveBeenCalledOnce();
});
