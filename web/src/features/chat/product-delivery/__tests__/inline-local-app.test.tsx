// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocalAppFixGuidance: vi.fn(),
  getLocalAppSnapshot: vi.fn(),
  attach: vi.fn(),
  fill: vi.fn(),
}));

vi.mock('@/features/local-apps/api', () => ({
  getLocalAppFixGuidance: mocks.getLocalAppFixGuidance,
  getLocalAppSnapshot: mocks.getLocalAppSnapshot,
}));
vi.mock('@/features/local-apps/preview-channel', () => ({
  attachLocalAppPreviewChannel: mocks.attach,
}));
vi.mock('@/features/chat/composer/fill-composer-dispatch', () => ({
  dispatchFillChatComposer: mocks.fill,
}));

import { InlineLocalApp } from '@/features/chat/product-delivery/inline-local-app';
import { InlinePreviewSchedulerProvider } from '@/features/chat/product-delivery/inline-preview-scheduler';

describe('InlineLocalApp', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onRuntimeMessage: (value: unknown) => void;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.getLocalAppSnapshot.mockResolvedValue({
      appId: 'app-1', sourceHash: 'a'.repeat(64), status: 'ready', createdAt: 1,
      entryPath: 'ui/index.html', previewUrl: `/api/local-apps/preview/token/snapshots/${'a'.repeat(64)}/ui/index.html`,
      validation: {
        status: 'healthy', checkedAt: 1, sourceHash: 'a'.repeat(64), hasDraftChanges: true,
        changedFiles: [], changedFileCount: 0, permissions: [], permissionDelta: { added: [], removed: [] },
        acceptanceScenarioCount: 0, acceptanceScenarios: [], issues: [],
      },
    });
    mocks.getLocalAppFixGuidance.mockResolvedValue({ prompt: 'Fix safely', diagnostics: [] });
    mocks.attach.mockImplementation((_iframe: HTMLIFrameElement, onMessage: (value: unknown) => void) => {
      onRuntimeMessage = onMessage;
      return vi.fn();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MemoryRouter>
            <InlineLocalApp
              previewId="delivery-1"
              reference={{ kind: 'local_app', id: 'app-1', title: 'Status board', capabilities: ['open', 'fix'] }}
              sourceHash={'a'.repeat(64)}
              preferredHeight={480}
              language="en"
            />
          </MemoryRouter>
        </SWRConfig>,
      );
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('renders an isolated interactive preview and reports healthy runtime state', async () => {
    await render();
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(iframe?.getAttribute('src')).toContain(`/api/local-apps/preview/token/snapshots/${'a'.repeat(64)}/ui/index.html`);

    act(() => onRuntimeMessage({ source: 'xopc-local-app-preview', version: 1, type: 'ready', detail: {} }));
    expect(container.textContent).toContain('Running');
    expect(container.querySelector('[data-inline-local-app="app-1"]')).not.toBeNull();
  });

  it('turns runtime failures into server-generated Coder guidance', async () => {
    await render();
    act(() => onRuntimeMessage({
      source: 'xopc-local-app-preview', version: 1, type: 'error',
      detail: { kind: 'script_error', message: 'Widget crashed', filename: 'app.js', line: 7 },
    }));
    expect(container.textContent).toContain('Runtime error');
    expect(container.textContent).toContain('Widget crashed');

    await act(async () => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Ask Coder'));
      button?.click();
      await Promise.resolve();
    });

    expect(mocks.getLocalAppFixGuidance).toHaveBeenCalledWith('app-1', expect.objectContaining({
      sourceHash: 'a'.repeat(64),
      diagnostics: [expect.objectContaining({ phase: 'runtime', code: 'script_error' })],
    }));
    expect(mocks.fill).toHaveBeenCalledWith('Fix safely');
  });

  it('does not request or mount a preview until the scheduler grants a lease', async () => {
    class IdleIntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', IdleIntersectionObserver);
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MemoryRouter>
            <InlinePreviewSchedulerProvider>
              <InlineLocalApp
                previewId="scheduled-delivery"
                reference={{ kind: 'local_app', id: 'app-1', title: 'Status board', capabilities: ['open'] }}
                sourceHash={'a'.repeat(64)}
                preferredHeight={480}
                language="en"
              />
            </InlinePreviewSchedulerProvider>
          </MemoryRouter>
        </SWRConfig>,
      );
      await Promise.resolve();
    });

    expect(mocks.getLocalAppSnapshot).not.toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBeNull();

    await act(async () => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Load interactive'));
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getLocalAppSnapshot).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')).not.toBeNull();
  });
});
