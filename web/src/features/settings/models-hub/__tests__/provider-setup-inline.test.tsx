// @vitest-environment jsdom
import { act } from 'react';
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
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent === '连接并用于语音合成')!;
  await act(async () => apply.click());
  expect(api.key).not.toHaveBeenCalled();
  expect(api.apply).toHaveBeenCalledExactlyOnceWith('future-plan', { mode: 'replace', modelIds: undefined, selected: ['speech'], overrides: { speech: 'future-plan/b' } }, 'revision');
  expect(applied).toHaveBeenCalledOnce();
});
it('keeps the form and reports conflicts without applying a stale choice', async () => {
  let calls = 0; api.preview.mockImplementation(async () => ({ ...snapshot(), revision: ++calls === 1 ? 'old' : 'new' }));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '连接并用于语音合成')!.click());
  expect(api.apply).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('核对后再次应用');
});
it('coalesces repeated apply clicks while a request is running', async () => {
  let finish!: () => void; api.apply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<ProviderSetupPanel inline providerId="future-plan" targetUse="speech" language="zh" onDone={() => {}} />));
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent === '连接并用于语音合成')!;
  await act(async () => { apply.click(); apply.click(); });
  expect(api.apply).toHaveBeenCalledOnce();
  await act(async () => finish());
});
