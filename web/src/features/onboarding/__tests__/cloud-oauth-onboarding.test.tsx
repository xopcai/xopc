// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasGrant: false,
  refreshModels: vi.fn(),
  onConnected: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock('@/lib/electron-env', () => ({ isElectron: () => true }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/lib/fetch', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ payload: { status: 'unseen', hasGrant: mocks.hasGrant } }),
  })),
}));
vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en' }) => unknown) => selector({ language: 'en' }),
}));
vi.mock('@/features/settings/oauth-api', () => ({
  startAsyncOAuthLogin: vi.fn(async () => ({ sessionId: 'cloud-session' })),
  fetchOAuthSessionStatus: vi.fn(async () => {
    mocks.hasGrant = true;
    return { status: 'completed', authUrl: 'https://cloud.example/authorize' };
  }),
  cleanupOAuthSession: vi.fn(async () => {}),
}));
vi.mock('@/features/settings/models-hub/models-hub-cache', () => ({
  revalidateModelsHubCaches: mocks.refreshModels,
}));

import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { useCloudOnboarding } from '../cloud-onboarding';

function Experience() {
  const cloud = useCloudOnboarding(true);
  return <>
    <span data-testid="cloud-pending">{cloud.ready ? String(cloud.pending) : 'loading'}</span>
    <OAuthProviderConnect providerId="xopc-cloud" displayName="XOPC Cloud" connected={false} onConnected={mocks.onConnected} />
  </>;
}

describe('Electron Cloud OAuth onboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.hasGrant = false;
    mocks.openExternalUrl.mockResolvedValue({ ok: true });
    window.electronAPI = { shell: { openExternalUrl: mocks.openExternalUrl } } as unknown as NonNullable<Window['electronAPI']>;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.electronAPI;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('clears the cached Cloud prompt before refreshing models after authorization', async () => {
    const cache = new Map();
    mocks.refreshModels.mockImplementation(async () => {
      expect(cache.get('/api/models/cloud-onboarding')?.data.hasGrant).toBe(true);
    });
    await act(async () => {
      root.render(<SWRConfig value={{ provider: () => cache }}><Experience /></SWRConfig>);
    });
    expect(container.querySelector('[data-testid="cloud-pending"]')?.textContent).toBe('true');

    await act(async () => { container.querySelector('button')!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(container.querySelector('[data-testid="cloud-pending"]')?.textContent).toBe('false');
    expect(mocks.refreshModels).toHaveBeenCalledOnce();
    expect(mocks.onConnected).toHaveBeenCalledOnce();
    expect(mocks.openExternalUrl).toHaveBeenCalledOnce();
  });
});
