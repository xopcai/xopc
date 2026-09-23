// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocalApp: vi.fn(),
  getLocalAppFixGuidance: vi.fn(),
  validateLocalApp: vi.fn(),
  attach: vi.fn(),
  fill: vi.fn(),
}));

vi.mock('@/features/local-apps/api', () => ({
  getLocalApp: mocks.getLocalApp,
  getLocalAppFixGuidance: mocks.getLocalAppFixGuidance,
  validateLocalApp: mocks.validateLocalApp,
}));
vi.mock('@/features/local-apps/preview-channel', () => ({
  attachLocalAppPreviewChannel: mocks.attach,
}));
vi.mock('@/features/chat/composer/fill-composer-dispatch', () => ({
  dispatchFillChatComposer: mocks.fill,
}));

import { InlineLocalApp } from '@/features/chat/product-delivery/inline-local-app';

describe('InlineLocalApp', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onRuntimeMessage: (value: unknown) => void;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.getLocalApp.mockResolvedValue({
      id: 'app-1', extensionId: 'local-app-1', projectId: 'project-1', name: 'Status board', idea: 'Board',
      status: 'preview_ready', workspaceRoot: '/tmp/app', draftVersion: 1, installationState: 'not_installed',
      enabled: false, createdAt: 1, updatedAt: 1, previewUrl: '/api/local-apps/preview/token/ui/index.html',
      permissions: [], releases: [], acceptanceRuns: [],
    });
    mocks.validateLocalApp.mockResolvedValue({
      status: 'healthy', checkedAt: 1, sourceHash: 'hash-1', hasDraftChanges: true,
      changedFiles: [], changedFileCount: 0, permissions: [], permissionDelta: { added: [], removed: [] },
      acceptanceScenarioCount: 0, acceptanceScenarios: [], issues: [],
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
  });

  async function render() {
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MemoryRouter>
            <InlineLocalApp
              reference={{ kind: 'local_app', id: 'app-1', title: 'Status board', capabilities: ['open', 'fix'] }}
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
    expect(iframe?.getAttribute('src')).toContain('/api/local-apps/preview/token/ui/index.html');

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
      sourceHash: 'hash-1',
      diagnostics: [expect.objectContaining({ phase: 'runtime', code: 'script_error' })],
    }));
    expect(mocks.fill).toHaveBeenCalledWith('Fix safely');
  });
});
