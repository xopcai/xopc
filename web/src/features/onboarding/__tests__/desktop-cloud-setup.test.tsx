// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  desktop: true,
  connected: false,
  preview: vi.fn(),
  apply: vi.fn(),
  profile: vi.fn(),
  complete: vi.fn(),
  ensurePersonal: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/lib/electron-env', () => ({ isElectron: () => api.desktop }));
vi.mock('@/lib/electron-window-chrome', () => ({ isElectronDarwin: () => false }));
vi.mock('@/components/brand/loopi', () => ({ Loopi: () => null }));
vi.mock('@/features/onboarding/desktop-onboarding-bootstrap', () => ({
  ensureDefaultPersonalAgent: api.ensurePersonal,
  prefetchDesktopOnboardingContext: api.prefetch,
}));
vi.mock('@/features/settings/models-hub/connected-providers-grid', () => ({
  useConnectedProviders: () => ({ cards: [{ id: 'xopc-cloud', configured: api.connected }], builtinRows: [], loading: false }),
}));
vi.mock('@/features/settings/models-hub/provider-setup-api', () => ({ previewModelSetup: api.preview, applyModelSetup: api.apply }));
vi.mock('@/features/settings/models-hub/oauth-provider-connect', () => ({
  OAuthProviderConnect: ({ providerId, onConnected, secondaryAction }: { providerId: string; onConnected: () => void; secondaryAction?: React.ReactNode }) => (
    <div>{secondaryAction}<button data-provider={providerId} onClick={onConnected}>Authorize Cloud</button></div>
  ),
}));
vi.mock('@/features/onboarding/onboarding-provider-grid', () => ({
  OnboardingProviderGrid: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect('deepseek')}>Choose provider</button>
  ),
}));
vi.mock('@/features/settings/models-hub/add-provider-dialog', () => ({
  AddProviderDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">Model configuration</div> : null),
}));
vi.mock('@/features/user-model/user-model-api', () => ({
  fetchUserProfile: async () => ({ profile: { callName: '' }, suggestedCallName: 'Mic' }),
  updateUserProfile: api.profile,
  detectBrowserTimezone: () => 'Asia/Shanghai',
}));

import { useLocaleStore } from '@/stores/locale-store';
import { OnboardingCard } from '../onboarding-card';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const renderCard = async (props?: Partial<React.ComponentProps<typeof OnboardingCard>>) => {
  await act(async () => root.render(<OnboardingCard onComplete={api.complete} onDismiss={() => {}} {...props} />));
};

beforeEach(async () => {
  vi.clearAllMocks();
  api.desktop = true;
  api.connected = false;
  api.preview.mockResolvedValue({
    configured: true,
    revision: 'fresh',
    uses: ['chat', 'vision', 'image', 'background', 'transcription', 'speech', 'conversation']
      .map((id) => ({ id, recommended: `xopc-cloud/${id}`, selected: true })),
  });
  api.apply.mockResolvedValue(undefined);
  api.profile.mockResolvedValue(undefined);
  api.complete.mockResolvedValue(undefined);
  api.ensurePersonal.mockResolvedValue(true);
  api.prefetch.mockResolvedValue({ candidates: [], recentFiles: [], processingTarget: null, importSources: [] });
  useLocaleStore.setState({ language: 'zh' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await renderCard();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const click = async (name: string) => act(async () => {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(name));
  if (!button) throw new Error(`Button not found: ${name}`);
  button.click();
});

it('keeps setup dismissal beside the current desktop primary action', async () => {
  const onDismiss = vi.fn();
  await renderCard({ onDismiss });
  expect([...container.querySelectorAll('header button')].map(button => button.textContent)).toEqual(['EN', '中文']);
  const authorize = container.querySelector('[data-provider="xopc-cloud"]');
  expect(authorize?.previousElementSibling?.textContent).toBe('跳过引导');
  await click('跳过引导');
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(api.complete).not.toHaveBeenCalled();

  api.connected = true;
  await renderCard({ onDismiss });
  const buttons = [...container.querySelectorAll('button')];
  expect(buttons.filter(button => button.textContent === '跳过引导')).toHaveLength(1);
  expect(buttons.find(button => button.textContent === '继续')?.previousElementSibling?.textContent).toBe('跳过引导');
});

it('takes Electron directly to single-screen Cloud setup, auto-initializes Ada, and completes without a dead success screen', async () => {
  expect(container.querySelector('h1')?.textContent).toBe('配置模型');
  expect(container.textContent).toContain('你好，Mic');
  expect(container.textContent).not.toContain('Choose provider');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('Authorize Cloud');
  expect(api.preview).toHaveBeenCalledExactlyOnceWith('xopc-cloud', { mode: 'replace' });
  expect(api.apply).toHaveBeenCalledExactlyOnceWith(
    'xopc-cloud',
    { mode: 'replace', selected: ['chat', 'vision', 'image', 'background', 'transcription', 'speech', 'conversation'] },
    'fresh',
  );
  expect(api.profile).toHaveBeenCalledWith({ callName: 'Mic', timezone: 'Asia/Shanghai', locale: 'zh-CN' });
  expect(api.ensurePersonal).toHaveBeenCalledOnce();
  expect(api.prefetch).toHaveBeenCalledOnce();
  expect(api.complete).toHaveBeenCalledOnce();
});

it('reuses an existing Cloud connection with a single click on Electron', async () => {
  api.connected = true;
  await renderCard();
  await click('继续');
  expect(api.apply).toHaveBeenCalledOnce();
  expect(api.complete).toHaveBeenCalledOnce();
});

it('keeps the connection step retryable when applying the default fails', async () => {
  api.apply.mockRejectedValueOnce(new Error('temporary failure'));
  await click('Authorize Cloud');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporary failure');
  expect(api.complete).not.toHaveBeenCalled();
  await click('重试');
  expect(api.apply).toHaveBeenCalledTimes(2);
  expect(api.complete).toHaveBeenCalledOnce();
});

it('does not report success when Cloud has no usable default model', async () => {
  api.preview.mockResolvedValue({ configured: true, revision: 'fresh', uses: [{ id: 'chat', choices: [] }] });
  await click('Authorize Cloud');
  expect(api.apply).not.toHaveBeenCalled();
  expect(api.complete).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未就绪');
});

it('lets Electron users open custom API key / local model setup on demand', async () => {
  await click('使用 API Key 或本地模型');
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Model configuration');
});

it('retains the browser multi-step provider configuration flow', async () => {
  api.desktop = false;
  await renderCard();
  await click('继续');
  await click('Choose provider');
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Model configuration');
  expect(container.querySelector('[data-provider="xopc-cloud"]')).toBeNull();
  expect(api.apply).not.toHaveBeenCalled();
});

it('coalesces default application and reports pending state until it finishes', async () => {
  let finish!: () => void;
  const pending = vi.fn();
  api.apply.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await renderCard({ onPendingChange: pending });
  const authorize = container.querySelector<HTMLButtonElement>('[data-provider="xopc-cloud"]')!;
  await act(async () => { authorize.click(); authorize.click(); });
  expect(api.apply).toHaveBeenCalledOnce();
  expect(pending).toHaveBeenLastCalledWith(true);
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '跳过引导')?.disabled).toBe(true);
  await act(async () => finish());
  expect(pending).toHaveBeenLastCalledWith(false);
  expect(api.complete).toHaveBeenCalledOnce();
});

it('shows completion errors and retries onComplete without applying the default again', async () => {
  api.complete.mockRejectedValueOnce(new Error('Refresh failed'));
  await click('Authorize Cloud');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Refresh failed');
  api.complete.mockResolvedValueOnce(undefined);
  await click('重试');
  expect(api.complete).toHaveBeenCalledTimes(2);
  expect(api.apply).toHaveBeenCalledOnce();
});

it('finishes with partial capabilities without submitting unsupported uses', async () => {
  api.preview.mockResolvedValue({
    configured: true,
    revision: 'partial',
    uses: [
      { id: 'chat', selected: true, recommended: 'xopc-cloud/auto' },
      { id: 'image', selected: false, choices: [], reason: 'not_supported' },
    ],
  });
  await click('Authorize Cloud');
  expect(api.apply).toHaveBeenCalledExactlyOnceWith('xopc-cloud', { mode: 'replace', selected: ['chat'] }, 'partial');
  expect(api.complete).toHaveBeenCalledOnce();
});

it('never blocks Electron setup if optional profile save fails', async () => {
  api.profile.mockRejectedValueOnce(new Error('HTTP 500'));
  await click('Authorize Cloud');
  expect(api.apply).toHaveBeenCalledOnce();
  expect(api.complete).toHaveBeenCalledOnce();
});

it.each(['network timeout', 'HTTP 500', 'HTTP 401'])('lets browser optional name setup recover cleanly (%s)', async (reason) => {
  api.desktop = false;
  await renderCard();
  api.profile.mockRejectedValueOnce(new Error(reason));
  await click('继续');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('称呼暂未保存');
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(reason);
  await click('稍后设置称呼');
  expect(container.textContent).toContain('选择模型服务');
  expect(api.apply).not.toHaveBeenCalled();
  expect(api.complete).not.toHaveBeenCalled();
});
