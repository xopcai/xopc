// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ desktop: true, connected: false, preview: vi.fn(), apply: vi.fn(), profile: vi.fn(), complete: vi.fn() }));
vi.mock('@/lib/electron-env', () => ({ isElectron: () => api.desktop }));
vi.mock('@/components/brand/loopi', () => ({ Loopi: () => null }));
vi.mock('@/features/settings/models-hub/connected-providers-grid', () => ({ useConnectedProviders: () => ({ cards: [{ id: 'xopc-cloud', configured: api.connected }], builtinRows: [], loading: false }) }));
vi.mock('@/features/settings/models-hub/provider-setup-api', () => ({ previewModelSetup: api.preview, applyModelSetup: api.apply }));
vi.mock('@/features/settings/models-hub/oauth-provider-connect', () => ({ OAuthProviderConnect: ({ providerId, onConnected }: { providerId: string; onConnected: () => void }) => <button data-provider={providerId} onClick={onConnected}>Authorize Cloud</button> }));
vi.mock('@/features/onboarding/onboarding-provider-grid', () => ({ OnboardingProviderGrid: ({ onSelect }: { onSelect: (id: string) => void }) => <button onClick={() => onSelect('deepseek')}>Choose provider</button> }));
vi.mock('@/features/settings/models-hub/add-provider-dialog', () => ({ AddProviderDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">Model configuration</div> : null }));
vi.mock('@/features/user-model/user-model-api', () => ({ fetchUserProfile: async () => ({ profile: { callName: '' } }), updateUserProfile: api.profile, detectBrowserTimezone: () => 'Asia/Shanghai' }));

import { useLocaleStore } from '@/stores/locale-store';
import { OnboardingCard } from '../onboarding-card';
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.clearAllMocks(); api.desktop = true; api.connected = false;
  api.preview.mockResolvedValue({ configured: true, revision: 'fresh', uses: [{ id: 'chat', recommended: 'xopc-cloud/auto' }] });
  api.apply.mockResolvedValue(undefined); api.profile.mockResolvedValue(undefined);
  useLocaleStore.setState({ language: 'zh' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<OnboardingCard onComplete={api.complete} onDismiss={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const click = async (name: string) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === name)!.click());

it('takes Electron directly to Cloud authorization and applies its default without a configuration dialog', async () => {
  await click('继续');
  expect(container.textContent).toContain('连接 XOPC Cloud');
  expect(container.textContent).not.toContain('Choose provider');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('Authorize Cloud');
  expect(api.preview).toHaveBeenCalledExactlyOnceWith('xopc-cloud', { mode: 'replace', selected: ['chat'] });
  expect(api.apply).toHaveBeenCalledExactlyOnceWith('xopc-cloud', { mode: 'replace', selected: ['chat'] }, 'fresh');
  expect(container.textContent).toContain('一切准备好了');
  await click('开始使用 XOPC'); expect(api.complete).toHaveBeenCalledOnce();
});

it('reuses an existing Cloud connection without requiring authorization again', async () => {
  api.connected = true;
  await click('继续'); await click('继续');
  expect(api.apply).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('一切准备好了');
});

it('keeps the connection step retryable when applying the default fails', async () => {
  api.apply.mockRejectedValueOnce(new Error('temporary failure'));
  await click('继续'); await click('Authorize Cloud');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporary failure');
  expect(container.textContent).not.toContain('一切准备好了');
  await click('重试');
  expect(api.apply).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('一切准备好了');
});

it('does not report success when Cloud has no usable default model', async () => {
  api.preview.mockResolvedValue({ configured: true, revision: 'fresh', uses: [{ id: 'chat', choices: [] }] });
  await click('继续'); await click('Authorize Cloud');
  expect(api.apply).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未就绪');
});

it('retains the browser provider configuration flow', async () => {
  api.desktop = false;
  await click('继续'); await click('Choose provider');
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Model configuration');
  expect(container.querySelector('[data-provider="xopc-cloud"]')).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

it('coalesces default application and reports pending state until it finishes', async () => {
  let finish!: () => void;
  const pending = vi.fn();
  api.apply.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<OnboardingCard onComplete={api.complete} onDismiss={() => {}} onPendingChange={pending} />));
  await click('继续');
  const authorize = container.querySelector<HTMLButtonElement>('[data-provider="xopc-cloud"]')!;
  await act(async () => { authorize.click(); authorize.click(); });
  expect(api.apply).toHaveBeenCalledOnce();
  expect(pending).toHaveBeenLastCalledWith(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="跳过 — 稍后再设置"]')!.disabled).toBe(true);
  await act(async () => finish());
  expect(pending).toHaveBeenLastCalledWith(false);
  expect(container.textContent).toContain('一切准备好了');
});

it('shows completion errors and lets the user retry without applying the default again', async () => {
  api.complete.mockRejectedValueOnce(new Error('Refresh failed'));
  await click('继续'); await click('Authorize Cloud'); await click('开始使用 XOPC');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Refresh failed');
  api.complete.mockResolvedValueOnce(undefined);
  await click('开始使用 XOPC');
  expect(api.complete).toHaveBeenCalledTimes(2);
  expect(api.apply).toHaveBeenCalledOnce();
});
