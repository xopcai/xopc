// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWorkDiscoveryOnboarding: vi.fn(),
}));

vi.mock('@/features/onboarding/use-needs-model-setup', () => ({
  useNeedsModelSetup: () => ({
    ready: true,
    needsSetup: false,
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
  OnboardingCard: () => <div data-testid="model-setup-stage">Model setup</div>,
}));

vi.mock('@/features/work-discovery/work-discovery-page', () => ({
  WorkDiscoveryPage: () => <div data-testid="work-understanding-stage">Work understanding</div>,
}));

vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (selector: (state: { token: string }) => unknown) => selector({ token: 'test-token' }),
}));

vi.mock('@/stores/locale-store', () => ({
  useLocaleStore: (selector: (state: { language: 'en' }) => unknown) => selector({ language: 'en' }),
}));

import { OnboardingDialog } from '../onboarding-dialog';

describe('OnboardingDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
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
});
