// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { ComposerAttachmentChips } from '../composer-attachment-chips';

const previewSpy = vi.fn();

vi.mock('@/features/chat/attachments/attachment-preview-dialog', () => ({
  AttachmentPreviewDialog: (props: { open: boolean; attachment: Attachment | null; conversationId?: string | null }) => {
    previewSpy(props);
    return props.open ? <div role="dialog">{props.attachment?.name}</div> : null;
  },
}));

describe('ComposerAttachmentChips', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const image: Attachment = {
    type: 'image',
    name: 'diagram.png',
    mimeType: 'image/png',
    size: 12,
    content: 'aGVsbG8=',
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    previewSpy.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the shared attachment preview from the selected file chip', () => {
    act(() => root.render(
      <ComposerAttachmentChips
        attachments={[image]}
        conversationId="session-a"
        topPadded={false}
        onRemove={() => {}}
      />,
    ));

    const previewButton = container.querySelector<HTMLButtonElement>('[aria-label*="diagram.png"]');
    act(() => previewButton?.click());

    expect(container.querySelector('[role="dialog"]')?.textContent).toBe('diagram.png');
    expect(previewSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      open: true,
      attachment: image,
      conversationId: 'session-a',
    }));
  });

  it('removes an attachment without opening its preview', () => {
    const onRemove = vi.fn();
    act(() => root.render(
      <ComposerAttachmentChips
        attachments={[image]}
        topPadded={false}
        onRemove={onRemove}
      />,
    ));

    const buttons = container.querySelectorAll('button');
    act(() => buttons[1]?.click());

    expect(onRemove).toHaveBeenCalledWith(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
