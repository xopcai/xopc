// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deliverExternalIntake: vi.fn(async () => undefined),
  loadAttachment: vi.fn(async (file: File) => ({
    id: 'att-1',
    type: 'image' as const,
    name: file.name,
    mimeType: 'image/png',
    size: file.size,
    content: 'AQID',
  })),
  quickCaptureImage: vi.fn(async () => ({
    id: 'note-42',
    markdown: '![shot.png](note-attachment://note-42/a1)',
    attachments: [{ id: 'a1', type: 'image', fileName: 'shot.png' }],
  })),
  updateNote: vi.fn(async (_id: string, patch: { markdown: string }) => ({
    id: 'note-42',
    markdown: patch.markdown,
  })),
}));

vi.mock('@/features/chat/composer/external-intake-receiver', () => ({
  deliverExternalIntake: mocks.deliverExternalIntake,
}));
vi.mock('@/features/chat/attachments/attachment-load', () => ({
  loadAttachment: mocks.loadAttachment,
}));
vi.mock('@/features/notes/notes-api', () => ({
  quickCaptureImage: mocks.quickCaptureImage,
  updateNote: mocks.updateNote,
}));
vi.mock('@/stores/gateway-store', () => ({
  useGatewayStore: (selector: (s: { conversationId: string }) => unknown) =>
    selector({ conversationId: 'principal-1' }),
}));

import { FILL_CHAT_COMPOSER_EVENT } from '@/features/chat/composer/fill-composer-dispatch';
import { GlobalScreenshotHost } from '../global-screenshot-host';

describe('GlobalScreenshotHost', () => {
  let root: ReturnType<typeof createRoot>;
  let node: HTMLDivElement;
  let listener: ((payload: any) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    listener = undefined;
    window.electronAPI = {
      screenshot: {
        start: vi.fn(),
        getPreferences: vi.fn(async () => ({ hideMainWindow: false })),
        setPreferences: vi.fn(async () => ({ hideMainWindow: false })),
        getHistory: vi.fn(async () => []),
        takePendingDeliveries: vi.fn(async () => []),
        onDeliverToChat: vi.fn((cb) => {
          listener = cb;
          return () => {
            listener = undefined;
          };
        }),
      },
    } as unknown as Window['electronAPI'];
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
  });

  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    delete window.electronAPI;
    vi.useRealTimers();
  });

  it('delivers annotated screenshot and optional AI prompt into the active chat composer', async () => {
    const receivedPrompts: string[] = [];
    const onFill = (e: Event) => {
      receivedPrompts.push((e as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener(FILL_CHAT_COMPOSER_EVENT, onFill);

    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/chat/11111111-1111-4111-8111-111111111111']}>
            <GlobalScreenshotHost />
          </MemoryRouter>,
        );
      });

      expect(listener).toBeTypeOf('function');
      await act(async () => {
        const duplicate = {
          id: 'shot-1',
          createdAt: Date.now(),
          pngBase64: btoa('pngbytes'),
          fileName: 'screenshot-1.png',
          width: 640,
          height: 480,
          prompt: '帮我解释下这张报错截图',
          targetMode: 'chat' as const,
        };
        listener!(duplicate);
        listener!(duplicate); // duplicate event must be deduplicated
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mocks.deliverExternalIntake).toHaveBeenCalledTimes(1);
      expect(mocks.deliverExternalIntake).toHaveBeenCalledWith(
        JSON.stringify(['principal-1', '11111111-1111-4111-8111-111111111111']),
        'screenshot:shot-1',
        [expect.objectContaining({ id: 'screenshot:shot-1', name: 'screenshot-1.png' })],
      );
      expect(receivedPrompts).toContain('帮我解释下这张报错截图');
    } finally {
      window.removeEventListener(FILL_CHAT_COMPOSER_EVENT, onFill);
    }
  });

  it('saves screenshot to Quick Note when targetMode is note', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/chat/11111111-1111-4111-8111-111111111111']}>
          <GlobalScreenshotHost />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      listener!({
        id: 'shot-note',
        createdAt: Date.now(),
        pngBase64: btoa('pngbytes'),
        fileName: 'note-shot.png',
        width: 400,
        height: 300,
        targetMode: 'note',
      });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(mocks.quickCaptureImage).toHaveBeenCalledTimes(1);
  });
});
