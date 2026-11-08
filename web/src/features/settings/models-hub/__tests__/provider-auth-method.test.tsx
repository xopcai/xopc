// @vitest-environment jsdom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeProviderRows, type ProviderRowModel } from '@/features/settings/providers-api';
import { messages } from '@/i18n/messages';
import { ProviderSetupPanel } from '../provider-setup-panel';
import { ProviderManageDialog } from '../provider-manage-dialog';

const api = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('../provider-setup-api', () => ({ previewModelSetup: api.preview, applyModelSetup: vi.fn() }));
vi.mock('../oauth-provider-connect', () => ({ OAuthProviderConnect: () => <button>Connect OAuth</button> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const row = (overrides: Partial<ProviderRowModel> = {}): ProviderRowModel => ({
  id: 'openai', name: 'OpenAI', category: 'common', configured: true,
  supportsApiKey: true, supportsOAuth: true, authMode: 'oauth', activeKeySource: 'oauth',
  authStatus: 'connected', apiKey: '', baseUrl: 'https://api.example.test/v1', ...overrides,
});
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(provider: ProviderRowModel) {
  await act(async () => root.render(<MemoryRouter><ProviderManageDialog open onOpenChange={vi.fn()}
    providerId={provider.id} isCustom={false} builtinRows={[provider]} allModels={[]} customConfig={null}
    labels={messages('zh').capabilitiesSettings.manageProviderDialog} language="zh" onSaved={vi.fn()}
  /></MemoryRouter>));
}
async function choose(method: string) {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${method}"]`)!;
  await act(async () => radio.click());
}

describe('provider credential presentation', () => {
  it.each([true, false])('separates authentication when setting up a connection (inline=%s)', async inline => {
    api.preview.mockResolvedValue({ providerId: 'openai', configured: false, revision: 'test',
      profile: { id: 'openai', name: 'OpenAI', credential: 'api-key' }, uses: [], taskModels: {} });
    await act(async () => root.render(<MemoryRouter><Dialog.Root open><ProviderSetupPanel inline={inline} providerId="openai"
      row={row({ configured: false, authMode: 'none', activeKeySource: 'none', authStatus: 'not_connected' })}
      language="zh" onDone={vi.fn()} /></Dialog.Root></MemoryRouter>));
    expect(document.querySelector('#provider-setup-key')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Connect OAuth');
    await choose('oauth');
    expect(document.querySelector('#provider-setup-key')).toBeNull();
    expect(document.body.textContent).toContain('Connect OAuth');
    await choose('api-key');
    expect(document.querySelector('#provider-setup-key')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Connect OAuth');
  });

  it.each(['openai', 'anthropic', 'kimi-coding'])('separates API and OAuth fields for %s without changing active authentication', async id => {
    await render(row({ id }));
    expect(document.querySelector('#manage-api-key')).toBeNull();
    expect(document.body.textContent).toContain('账号已连接');
    expect(document.body.textContent).toContain('当前认证来源：OAuth 授权');
    await choose('api-key');
    expect(document.querySelector<HTMLInputElement>('#manage-api-key')?.value).toBe('');
    expect(document.body.textContent).not.toContain('账号已连接');
    expect(document.body.textContent).toContain('当前认证来源：OAuth 授权');
    expect(document.querySelector('details')?.open).toBe(false);
    await choose('oauth');
    expect(document.querySelector('#manage-api-key')).toBeNull();
    expect(document.querySelector('details')).toBeNull();
  });

  it('shows environment credentials without a saved-key placeholder or missing-key warning', async () => {
    const provider = row({ authMode: 'env', activeKeySource: 'env' });
    const [merged] = mergeProviderRows([provider], {}, []);
    await render(merged);
    expect(document.querySelector<HTMLInputElement>('#manage-api-key')?.value).toBe('');
    expect(document.body.textContent).toContain('正在使用环境变量中的凭据');
    expect(document.body.textContent).not.toContain('未找到密钥');
  });

  it('shows expired authorization and keeps model-use configuration disabled', async () => {
    await render(row({ authStatus: 'expired', configured: false }));
    expect(document.body.textContent).toContain('授权已过期，请重新登录');
    const setup = [...document.querySelectorAll('button')].find(button => button.textContent === '配置模型用途');
    expect(setup?.disabled).toBe(true);
  });

  it('does not show an API key form or picker for OAuth-only providers', async () => {
    await render(row({ id: 'github-copilot', supportsApiKey: false }));
    expect(document.querySelector('input[type="radio"]')).toBeNull();
    expect(document.querySelector('#manage-api-key')).toBeNull();
    expect(document.body.textContent).toContain('账号已连接');
  });

  it.each(['oauth', 'env', 'none', 'extension'] as const)('does not invent saved keys from %s or the model catalog', source => {
    const [merged] = mergeProviderRows([row({ authMode: source, activeKeySource: source })], {}, []);
    expect(merged.apiKey).toBe('');
  });

  it.each(['agent', 'gateway', 'models_json'] as const)('preserves masked stored keys from %s', source => {
    const [merged] = mergeProviderRows([row({ authMode: source, activeKeySource: source })], {}, []);
    expect(merged.apiKey).toBe('••••••••••••');
  });
});
