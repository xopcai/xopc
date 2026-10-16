// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ModelSetupPreview, ModelSetupUse } from '@xopcai/gateway-contract';

const api = vi.hoisted(() => ({ fetch: vi.fn(), preview: vi.fn(), apply: vi.fn(), defaults: vi.fn(), voiceConfig: vi.fn<() => unknown>() }));
vi.mock('../provider-setup-api', () => ({ fetchModelSetup: api.fetch, previewModelSetup: api.preview, applyModelSetup: api.apply }));
vi.mock('@/features/settings/global-defaults-api', () => ({ fetchGlobalDefaults: api.defaults }));
vi.mock('@/features/gateway/gateway-config-swr', () => ({ useGatewayConfigSwr: () => ({ data: api.voiceConfig() }) }));
vi.mock('@/components/ui/popover-select', () => ({ PopoverSelect: ({ options, value, disabled, ariaLabel, onChange }: {
  options: Array<{ value: string; label: string }>; value: string; disabled: boolean; ariaLabel: string; onChange: (ref: string) => void;
}) => <fieldset aria-label={ariaLabel} data-value={value}>{options.map(option => <button key={option.value} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</fieldset> }));

import { ModelUsesList, modelUseOptions } from '../model-uses-list';
import type { ConnectedProvidersData } from '../connected-providers-grid';

const plan = 'qwen-token-plan-cn';
const cloud = 'xopc-cloud';
const preview = (provider: string): ModelSetupPreview => ({
  providerId: provider, profile: { id: provider, name: provider, brand: provider, access: 'api', credential: 'api-key', interactiveOnly: provider === plan },
  revision: 'a'.repeat(64), configured: true, mode: 'fill', taskModels: {},
  uses: (['chat', 'vision', 'image', 'background', 'transcription', 'speech', 'conversation'] as ModelSetupUse[]).map(id => ({
    id, selected: false, choices: id === 'background' && provider === plan ? [] : [{ id: `${provider}/${id}`, name: `${provider} ${id}` }],
  })),
});
const data = { cards: [plan, cloud].map(id => ({ id, configured: true })), builtinRows: [], allModels: [], loading: false } as unknown as ConnectedProvidersData;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let current: string;
beforeEach(() => {
  vi.clearAllMocks(); current = 'old/chat';
  api.voiceConfig.mockReturnValue(undefined);
  api.fetch.mockImplementation(async provider => preview(provider));
  api.preview.mockImplementation(async provider => preview(provider));
  api.apply.mockResolvedValue(undefined);
  api.defaults.mockImplementation(async () => ({ defaults: { models: { chat: { primary: current } } }, builtinTools: [] }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><ModelUsesList data={data} zh onChange={() => {}} /></SWRConfig>));
const choose = async (name: string) => {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === name)!;
  expect(button).toBeDefined(); await act(async () => button.click());
};

it('uses server capabilities for every use, including background restrictions', async () => {
  await render();
  expect(api.fetch.mock.calls.map(([provider]) => provider).sort()).toEqual([plan, cloud].sort());
  const background = container.querySelector('[aria-label="选择 自动与后台任务"]')!;
  expect(background.textContent).toContain(`${cloud} background`);
  expect(background.textContent).not.toContain(plan);
  expect(modelUseOptions([preview(plan)], 'speech')[0]?.value).toBe(`${plan}/speech`);
});

it('honors server restrictions for a model alias even when provider metadata looks unrestricted', async () => {
  api.defaults.mockResolvedValue({ defaults: { models: { chat: { primary: 'alias/plan' }, background: { primary: 'alias/plan' } } }, builtinTools: [] });
  await render();
  expect(container.querySelector('[aria-label="选择 自动与后台任务"]')?.getAttribute('data-value')).toBe('');
});

it.each([[false, 'omni'], [true, 'agent']] as const)('does not show dormant Omni settings when enabled=%s and engine=%s', async (enabled, defaultEngine) => {
  api.voiceConfig.mockReturnValue({ payload: { config: { voice: { realtime: { enabled, defaultEngine, omni: { provider: plan, model: 'conversation' } } } } } });
  await render();
  expect(container.querySelector('[aria-label="选择 实时语音对话"]')?.getAttribute('data-value')).toBe(enabled && defaultEngine === 'agent' ? 'agent' : '');
  await choose(`${plan} conversation`);
  expect(api.apply).toHaveBeenCalledExactlyOnceWith(plan, { mode: 'replace', selected: ['conversation'], overrides: { conversation: `${plan}/conversation` } }, 'a'.repeat(64));
});

it.each([['chat', plan], ['transcription', plan], ['background', cloud]] as const)('switches only %s with a fresh server revision', async (use, provider) => {
  await render(); await choose(`${provider} ${use}`);
  const request = { mode: 'replace', selected: [use], overrides: { [use]: `${provider}/${use}` } };
  expect(api.preview).toHaveBeenCalledExactlyOnceWith(provider, request);
  expect(api.apply).toHaveBeenCalledExactlyOnceWith(provider, request, 'a'.repeat(64));
  expect(container.textContent).toContain('已切换');
});

it('keeps the current model and shows a concurrent-write error without retrying the write', async () => {
  api.apply.mockRejectedValue(new Error('Settings changed; refresh and retry'));
  await render(); await choose(`${plan} chat`);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Settings changed');
  expect(container.querySelector('[aria-label="选择 对话与任务"]')?.getAttribute('data-value')).toBe('old/chat');
  expect(api.apply).toHaveBeenCalledOnce();
});

it('blocks concurrent selections until saving finishes and refreshes the saved selection', async () => {
  let finish!: () => void;
  api.apply.mockImplementation(() => new Promise<void>(resolve => { finish = () => { current = `${plan}/chat`; resolve(); }; }));
  await render(); await choose(`${plan} chat`);
  expect(container.textContent).toContain('正在切换');
  expect([...container.querySelectorAll('fieldset button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await act(async () => finish());
  expect(container.querySelector('[aria-label="选择 对话与任务"]')?.getAttribute('data-value')).toBe(`${plan}/chat`);
});


it('keeps direct model switching and separate modal actions on every capability', async () => {
  const settings = vi.fn(); const connect = vi.fn();
  await act(async () => root.render(<MemoryRouter><SWRConfig value={{ provider: () => new Map() }}><ModelUsesList data={data} zh onChange={connect} onSettings={settings} /></SWRConfig></MemoryRouter>));
  expect(container.querySelectorAll('[aria-label^="选择 "]')).toHaveLength(7);
  expect(container.querySelector('a')).toBeNull();
  const row = container.querySelector('[data-capability="speech"]')!;
  await act(async () => [...row.querySelectorAll('button')].find(button => button.textContent === '设置')!.click());
  expect(settings).toHaveBeenCalledExactlyOnceWith('speech');
  await act(async () => [...row.querySelectorAll('button')].find(button => button.textContent === '管理服务')!.click());
  expect(connect).toHaveBeenCalledExactlyOnceWith('speech');
});
it('shows only three capabilities in the voice overview', async () => {
  await act(async () => root.render(<MemoryRouter><SWRConfig value={{ provider: () => new Map() }}><ModelUsesList data={data} zh voiceOverview onChange={() => {}} onSettings={() => {}} /></SWRConfig></MemoryRouter>));
  expect(container.querySelectorAll('[data-capability]')).toHaveLength(3);
  expect(container.querySelector('[data-capability="chat"]')).toBeNull();
});

it('does not query a preset whose model registry connection has not been created', async () => {
  const pendingPreset = { ...data, cards: [...data.cards, { id: 'dashscope-cn', configured: true }] } as ConnectedProvidersData;
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><ModelUsesList data={pendingPreset} zh onChange={() => {}} /></SWRConfig>));
  expect(api.fetch.mock.calls.map(([provider]) => provider)).not.toContain('dashscope-cn');
});
