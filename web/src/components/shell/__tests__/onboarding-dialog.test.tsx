// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWorkDiscoveryOnboarding: vi.fn(),
  cloudPending: false,
  needsSetup: false,
  desktop: false,
  refreshCloud: vi.fn(),
}));

vi.mock('@/lib/electron-env', () => ({ isElectron: () => mocks.desktop }));

vi.mock('@/features/onboarding/use-needs-model-setup', () => ({
  useNeedsModelSetup: () => ({
    ready: true,
    needsSetup: mocks.needsSetup,
    guideDismissed: false,
    refresh: vi.fn(),
    dismissPermanently: vi.fn(),
  }),
}));

vi.mock('@/features/work-discovery/api', () => ({
  fetchWorkDiscoveryOnboarding: mocks.fetchWorkDiscoveryOnboarding,
  dismissWorkDiscoveryOnboarding: vi.fn(),
}));

vi.mock('@/features/onboarding/onboarding-card', () => ({
  OnboardingCard: ({ onComplete }: { onComplete: () => Promise<void> }) => <button data-testid="model-setup-stage" onClick={() => void onComplete()}>Model setup</button>,
}));

vi.mock('@/features/onboarding/cloud-onboarding', () => ({
  useCloudOnboarding: () => ({
    ready: true,
    pending: mocks.cloudPending,
    refresh: mocks.refreshCloud,
    dismiss: vi.fn(),
  }),
  CloudOnboardingCard: ({ context }: { context: string }) => <div data-testid="cloud-onboarding-stage" data-context={context}>Connect XOPC Cloud</div>,
}));

vi.mock('@/features/work-discovery/work-discovery-page', () => ({
  WorkDiscoveryPage: () => <div data-testid="work-understanding-stage">Work understanding</div>,
}));

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (selector: (state: { conversationId: string }) => unknown) => selector({ conversationId: 'browser:test' }),
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en' }) => unknown) => selector({ language: 'en' }),
}));

import { OnboardingDialog } from '../onboarding-dialog';

describe('OnboardingDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.cloudPending = false;
    mocks.needsSetup = false;
    mocks.desktop = false;
    mocks.refreshCloud.mockResolvedValue({ status: 'unseen', hasGrant: true });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it('keeps Electron setup open through OAuth model refresh and enters chat without another Cloud guide', async () => {
    mocks.desktop = true;
    mocks.needsSetup = true;
    mocks.cloudPending = true;
    mocks.fetchWorkDiscoveryOnboarding.mockResolvedValue(null);
    const render = () => root.render(<MemoryRouter initialEntries={['/chat']}><OnboardingDialog /></MemoryRouter>);
    await act(async () => { render(); });
    expect(document.body.querySelector('[data-testid="model-setup-stage"]')).not.toBeNull();

    mocks.needsSetup = false;
    await act(async () => { render(); });
    expect(document.body.querySelector('[data-testid="model-setup-stage"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="cloud-onboarding-stage"]')).toBeNull();

    mocks.cloudPending = false;
    await act(async () => {
      (document.body.querySelector('[data-testid="model-setup-stage"]') as HTMLButtonElement).click();
    });
    expect(mocks.refreshCloud).toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="model-setup-stage"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="cloud-onboarding-stage"]')).toBeNull();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('opens work understanding when model setup is already complete', async () => {
    mocks.fetchWorkDiscoveryOnboarding.mockResolvedValue({
      enabled: true,
      state: { status: 'not_started' },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/chat']}>
          <OnboardingDialog />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(document.body.querySelector('[data-testid="work-understanding-stage"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="model-setup-stage"]')).toBeNull();
  });

  it('shows Cloud authorization on the Gateway home route when a model is already configured', async () => {
    mocks.cloudPending = true;
    mocks.fetchWorkDiscoveryOnboarding.mockResolvedValue(null);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <OnboardingDialog />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(document.body.querySelector('[data-testid="cloud-onboarding-stage"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="cloud-onboarding-stage"]')?.getAttribute('data-context')).toBe('general');
  });

  it.each([
    ['/chat', 'chat'],
    ['/personal', 'personal'],
  ])('uses %s context for the global Cloud guide', async (route, context) => {
    mocks.cloudPending = true;
    mocks.fetchWorkDiscoveryOnboarding.mockResolvedValue(null);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <OnboardingDialog />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(document.body.querySelector('[data-testid="cloud-onboarding-stage"]')?.getAttribute('data-context')).toBe(context);
  });
});
