// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import { MessageBubble } from '@/features/chat/messages/message-bubble';

describe('persisted user image message rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

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
  });

  it('renders an image tile after reloading an attachment-only message from history', () => {
    const [message] = normalizeAgentMessages([
      {
        id: 'row-1',
        role: 'user',
        kind: 'message',
        content: '[Image description: A blue interface.]',
        media: [
          {
            id: 'photo---id.png',
            bucket: 'inbound',
            type: 'image',
            mimeType: 'image/png',
            name: 'photo.png',
            size: 1_024,
            uri: 'media://inbound/photo---id.png',
            path: '/state/media/inbound/photo---id.png',
          },
        ],
        timestamp: 100,
      },
    ]);

    expect(message).toBeDefined();

    act(() => {
      root.render(
        <MemoryRouter>
          <MessageBubble
            message={message}
            isStreaming={false}
            progress={null}
            readonly
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('button[aria-label^="photo.png"]')).not.toBeNull();
    expect(container.textContent).not.toContain('[Image description:');
  });
});
