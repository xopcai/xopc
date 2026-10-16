// @vitest-environment jsdom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ModelSetupPreview } from '@xopcai/gateway-contract';

const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), key: vi.fn() }));
vi.mock('../provider-setup-api', () => ({ previewModelSetup: api.preview, applyModelSetup: api.apply }));
vi.mock('@/features/settings/providers-api', async original => ({ ...await original<typeof import('@/features/settings/providers-api')>(), patchProviderApiKeys: api.key }));
vi.mock('../oauth-provider-connect', () => ({ OAuthProviderConnect: ({ onConnected }: { onConnected: () => void }) => <button onClick={onConnected}>Connect account</button> }));
vi.mock('@/components/ui/popover-select', () => ({ SelectOption: ({children}: {children: React.ReactNode}) => children,
  Select: ({onChange,children}: {onChange: (e: {target: {value: string}}) => void;children: React.ReactNode}) => <div>{children}<button onClick={() => onChange({target:{value:'custom/second'}})}>Choose second</button></div> }));

import { DefaultModelSuccessStep } from '../default-model-success-step';
import { ProviderSetupPanel } from '../provider-setup-panel';
import { defaultModelCandidates } from '../default-model-candidates';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const done = vi.fn();
const applied = vi.fn();
function preview(provider = 'qwen-token-plan-cn'): ModelSetupPreview {
  const cloud = provider === 'xopc-cloud';
  return { providerId: provider, profile: { id: provider, brand: provider, name: provider, access: cloud ? 'account' : 'subscription', credential: cloud ? 'oauth' : 'api-key', interactiveOnly: !cloud },
    revision: 'a'.repeat(64), configured: true, mode: 'fill', taskModels: {}, uses: [
      { id: 'chat', current: 'existing/chat', recommended: `${provider}/fast`, selected: false, choices: [{ id: `${provider}/fast`, name: 'Fast' }] },
      { id: 'vision', recommended: `${provider}/fast`, selected: true, choices: [{ id: `${provider}/fast`, name: 'Fast' }] },
      { id: 'image', selected: false, choices: [], reason: 'not_supported' },
      { id: 'background', selected: false, choices: [], reason: 'interactive_only' },
    ] };
}
beforeEach(() => {
  vi.clearAllMocks(); api.preview.mockImplementation(async provider => preview(provider)); api.apply.mockResolvedValue(undefined); api.key.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(provider = 'qwen-token-plan-cn', connect = false) {
  await act(async () => root.render(<Dialog.Root open><Dialog.Content>{connect
    ? <ProviderSetupPanel providerId={provider} language="zh" onDone={done} onApplied={applied} />
    : <DefaultModelSuccessStep target={{ providerId: provider }} zh onDone={done} onApplied={applied} />}</Dialog.Content></Dialog.Root>));
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
  expect(button, text).toBeDefined(); await act(async () => button!.click());
}
async function fillKey(value: string) {
  const input = document.querySelector<HTMLInputElement>('#provider-setup-key')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); });
}
it.each(['qwen-token-plan-cn','xopc-cloud','xiaomi-token-plan-cn'])('uses the same one-page model flow for %s', async provider => {
  await render(provider); await click('连接并应用');
  expect(api.apply).toHaveBeenCalledExactlyOnceWith(provider, expect.objectContaining({ selected: ['vision'], mode: 'fill' }), 'a'.repeat(64));
  expect(document.querySelector('[role="status"]')?.textContent).toContain('已保存'); expect(applied).toHaveBeenCalledOnce();
});
it('shows the replacement and changes only explicitly selected uses', async () => {
  await render(); expect(document.body.textContent).toContain('保留：existing/chat');
  await click('改用此服务'); expect(document.body.textContent).toContain('existing/chat → Fast');
  await click('连接并应用'); expect(api.apply.mock.calls[0][1].selected).toEqual(['chat','vision']);
});
it('does not write configuration on close', async () => { await render(); await click('关闭'); expect(done).toHaveBeenCalledOnce(); expect(api.apply).not.toHaveBeenCalled(); });
it('keeps API key access available for services supporting both OAuth and keys', async () => {
  const data = preview('dual-auth'); data.profile.credential = 'oauth'; data.configured = false;
  api.preview.mockResolvedValue(data);
  await act(async () => root.render(<Dialog.Root open><Dialog.Content><ProviderSetupPanel providerId="dual-auth" language="zh" onDone={done}
    row={{ id:'dual-auth', name:'Dual auth', category:'common', supportsOAuth:true, supportsApiKey:true, configured:false, apiKey:'' }} /></Dialog.Content></Dialog.Root>));
  expect(document.body.textContent).toContain('Connect account');
  expect(document.querySelector('#provider-setup-key')).toBeTruthy();
  await fillKey('test-key');
  await click('连接并应用');
  expect(api.key).toHaveBeenCalledExactlyOnceWith({'dual-auth':'test-key'});
});
it('saves one credential, and retries configuration without saving the key again', async () => {
  await render('qwen-token-plan-cn', true); await fillKey('sk-sp-fixture'); api.apply.mockRejectedValueOnce(new Error('Save failed'));
  await click('连接并应用'); expect(document.querySelector('[role="alert"]')?.textContent).toContain('服务已保存');
  expect(applied).not.toHaveBeenCalled(); await click('连接并应用'); expect(api.key).toHaveBeenCalledExactlyOnceWith({'qwen-token-plan-cn':'sk-sp-fixture'}); expect(applied).toHaveBeenCalledOnce();
});
it('requires a renewed review when a preview changes before saving', async () => {
  api.preview.mockResolvedValueOnce(preview()).mockResolvedValue({...preview(), revision:'b'.repeat(64)});
  await render(); await click('连接并应用'); expect(api.apply).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('再次应用');
  await click('连接并应用'); expect(api.apply).toHaveBeenCalledOnce(); expect(api.apply.mock.calls[0][2]).toBe('b'.repeat(64));
});
it('offers retry for a failed preview load', async () => {
  api.preview.mockRejectedValueOnce(new Error('Network failed')); await render(); await click('重试'); expect(document.body.textContent).toContain('模型用途');
});
it('restricts model additions to the supplied candidate IDs', async () => {
  await act(async () => root.render(<Dialog.Root open><Dialog.Content><DefaultModelSuccessStep target={{providerId:'custom',modelIds:['new']}} zh onDone={done}/></Dialog.Content></Dialog.Root>));
  expect(api.preview).toHaveBeenCalledWith('custom',{modelIds:['new']});
});
it('still filters dedicated computer models and unrelated providers for legacy picker consumers', () => {
  const model = {id:'custom/model',name:'Model',provider:'custom'};
  expect(defaultModelCandidates([model,{...model,id:'custom/gui',computerUse:{profile:'structured-tools-v1'}},{...model,id:'other/model',provider:'other'}],{providerId:'custom'})).toEqual([model]);
});
