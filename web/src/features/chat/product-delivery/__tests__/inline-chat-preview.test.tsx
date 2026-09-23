// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRevision: vi.fn(),
  getFixGuidance: vi.fn(),
  promote: vi.fn(),
  attach: vi.fn(),
  build: vi.fn(() => '<!doctype html><main>Login</main>'),
  fill: vi.fn(),
}));

vi.mock('@/features/chat-previews/api', () => ({
  getChatPreviewRevision: mocks.getRevision,
  getChatPreviewFixGuidance: mocks.getFixGuidance,
  promoteChatPreview: mocks.promote,
}));
vi.mock('@/features/chat-previews/runtime', () => ({
  attachChatPreviewChannel: mocks.attach,
  buildChatPreviewSrcDoc: mocks.build,
}));
vi.mock('@/features/chat/composer/fill-composer-dispatch', () => ({
  dispatchFillChatComposer: mocks.fill,
}));

import { InlineChatPreview } from '../inline-chat-preview';

describe('InlineChatPreview', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let runtimeMessage: (value: { type: 'ready' } | { type: 'error'; diagnostic: { kind: 'script_error'; message: string } }) => void;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.getRevision.mockResolvedValue({
      previewId: crypto.randomUUID(), sourceHash: 'a'.repeat(64), markup: '<main>Login</main>', styles: '', script: '', createdAt: 1,
    });
    mocks.getFixGuidance.mockResolvedValue({ prompt: 'Repair this preview' });
    mocks.promote.mockResolvedValue({ id: 'app-1' });
    mocks.attach.mockImplementation((_iframe, _channel, callback) => {
      runtimeMessage = callback;
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
            <InlineChatPreview
              leaseId="preview-delivery"
              reference={{ kind: 'chat_preview', id: crypto.randomUUID(), title: 'Login', capabilities: ['preview', 'fix'] }}
              sourceHash={'a'.repeat(64)}
              preferredHeight={420}
              language="en"
            />
          </MemoryRouter>
        </SWRConfig>,
      );
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('renders a sandboxed source document and offers explicit promotion', async () => {
    await render();
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(iframe?.getAttribute('srcdoc')).toContain('<main>Login</main>');
    act(() => runtimeMessage({ type: 'ready' }));
    expect(container.textContent).toContain('Running');

    await act(async () => {
      [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save as app'))?.click();
      await Promise.resolve();
    });
    expect(mocks.promote).toHaveBeenCalledWith(expect.any(String), 'a'.repeat(64));
  });

  it('turns runtime errors into a fix prompt', async () => {
    await render();
    act(() => runtimeMessage({ type: 'error', diagnostic: { kind: 'script_error', message: 'boom' } }));
    expect(container.textContent).toContain('boom');
    await act(async () => {
      [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Ask AI'))?.click();
      await Promise.resolve();
    });
    expect(mocks.getFixGuidance).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      sourceHash: 'a'.repeat(64), diagnostics: [{ kind: 'script_error', message: 'boom' }],
    }));
    expect(mocks.fill).toHaveBeenCalledWith('Repair this preview');
  });
});
