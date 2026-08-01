// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentTile } from '@/features/chat/attachments/attachment-tile';

describe('AttachmentTile image layout', () => {
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

  it('reserves the single-image frame before a persisted image is fetched', () => {
    act(() => {
      root.render(
        <AttachmentTile
          attachment={{
            type: 'image',
            mimeType: 'image/png',
            name: 'result.png',
            uri: 'media://outbound/result.png',
          }}
          imageSize="single"
          onOpen={vi.fn()}
        />,
      );
    });

    const button = container.querySelector('button');
    expect(button?.className).toContain('aspect-[4/3]');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
