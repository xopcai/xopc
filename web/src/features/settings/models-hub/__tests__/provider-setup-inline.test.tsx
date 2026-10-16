// @vitest-environment jsdom
import { Activity, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), key: vi.fn() }));
vi.mock('../provider-setup-api', () => ({ previewModelSetup: api.preview, applyModelSetup: api.apply }));
vi.mock('@/features/settings/providers-api', () => ({ patchProviderApiKeys: api.key }));
vi.mock('@/components/ui/popover-select', () => ({ Select: (props: any) => <select {...props} />, SelectOption: (props: any) => <option {...props} /> }));
import { ProviderSetupPanel } from '../provider-setup-panel';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const snapshot = () => ({ providerId: 'future-plan', configured: true, revision: 'revision', profile: { id: 'future-plan', name: 'Future plan', access: 'subscription', credential: 'api-key' }, taskModels: {}, uses: [
  { id: 'chat', current: 'old/chat', recommended: 'future-plan/chat', selected: false, choices: [{ id: 'future-plan/chat', name: 'Chat model' }] },
  { id: 'speech', current: 'old/speech', recommended: 'future-plan/a', selected: true, choices: [{ id: 'future-plan/a', name: 'Speech A' }, { id: 'future-plan/b', name: 'Speech B' }] },
] });
beforeEach(() => { vi.clearAllMocks(); api.preview.mockImplementation(async () => snapshot()); api.apply.mockResolvedValue(undefined); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('connects and applies only the current capability inline, including a non-recommended model', async () => {
  const applied = vi.fn();
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} onApplied={applied} />));
  expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.textContent).not.toContain('对话与任务');
  const select = container.querySelector('select')!;
  await act(async () => { select.value = 'future-plan/b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent === '使用此模型')!;
  await act(async () => apply.click());
  expect(api.key).not.toHaveBeenCalled();
  expect(api.apply).toHaveBeenCalledExactlyOnceWith('future-plan', { mode: 'replace', modelIds: undefined, selected: ['speech'], overrides: { speech: 'future-plan/b' } }, 'revision');
  expect(applied).toHaveBeenCalledOnce();
});
it('keeps the form and reports conflicts without applying a stale choice', async () => {
  let calls = 0; api.preview.mockImplementation(async () => ({ ...snapshot(), revision: ++calls === 1 ? 'old' : 'new' }));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '使用此模型')!.click());
  expect(api.apply).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('核对后再次应用');
});
it('coalesces repeated apply clicks while a request is running', async () => {
  let finish!: () => void; api.apply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent === '使用此模型')!;
  await act(async () => { apply.click(); apply.click(); });
  expect(api.apply).toHaveBeenCalledOnce();
  await act(async () => finish());
});

it('reuses a saved key by default and can discard a replacement without applying', async () => {
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  expect(container.querySelector('#provider-setup-key')).toBeNull();
  expect(container.textContent).toContain('使用已有连接');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '更换')!.click());
  expect(container.querySelector('#provider-setup-key')).not.toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '保留原 Key')!.click());
  expect(container.querySelector('#provider-setup-key')).toBeNull();
  expect(api.apply).not.toHaveBeenCalled(); expect(api.key).not.toHaveBeenCalled();
});
it('does not claim an existing credential was newly saved after a failed model change', async () => {
  api.apply.mockRejectedValue(new Error('upstream unavailable'));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '使用此模型')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('未能应用配置');
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain('已保存');
  expect(container.querySelector('details')?.textContent).toContain('upstream unavailable');
});

it('preserves a specific model when a retained dialog resumes its effects', async () => {
  const render = (visible: boolean) => root.render(<Activity mode={visible ? 'visible' : 'hidden'}><ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} /></Activity>);
  await act(async () => render(true));
  const select = container.querySelector('select')!;
  await act(async () => { select.value = 'future-plan/b'; select.dispatchEvent(new Event('change', {bubbles:true})); });
  await act(async () => render(false)); await act(async () => render(true));
  expect(container.querySelector('select')?.value).toBe('future-plan/b');
  expect(api.apply).not.toHaveBeenCalled();
});

it('shows the existing OAuth connection and applies without requesting an API key', async () => {
  api.preview.mockImplementation(async () => ({ ...snapshot(), profile: { ...snapshot().profile, credential: 'oauth' } }));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  expect(container.textContent).toContain('使用已有连接');
  expect(container.querySelector('#provider-setup-key')).toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '使用此模型')!.click());
  expect(api.apply).toHaveBeenCalledOnce();
  expect(api.key).not.toHaveBeenCalled();
});

it('returns to the saved connection summary if key replacement succeeds but model application fails', async () => {
  api.apply.mockRejectedValue(new Error('upstream unavailable'));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '更换')!.click());
  const input = container.querySelector<HTMLInputElement>('#provider-setup-key')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'fixture-replacement-key');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '连接并使用')!.click());
  expect(api.key).toHaveBeenCalledExactlyOnceWith({ 'future-plan': 'fixture-replacement-key' });
  expect(container.querySelector('#provider-setup-key')).toBeNull();
  expect(container.textContent).toContain('使用已有连接');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接信息已保存');
});
