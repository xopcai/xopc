// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import type { PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('@/features/preview-runtime/preview-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/preview-runtime/preview-runtime')>();
  const { InteractiveImagePreview } = await import('@/features/preview-runtime/plugins/binary-plugins');
  return {
    ...original,
    PreviewRuntimeView: (props: PreviewRuntimeRenderProps & { controller: { controls: PreviewRuntimeRenderProps['controls'] } }) => (
      <InteractiveImagePreview {...props} controls={props.controller.controls} />
    ),
  };
});

import { AttachmentPreviewDialog } from '../attachment-preview-dialog';

const images: MessageAttachment[] = Array.from({ length: 25 }, (_, index) => ({
  id: `image-${index}`, name: `image-${index}.png`, type: 'image', mimeType: 'image/png', data: 'AQID',
}));

function Gallery({ start = 8, items = images }: { start?: number; items?: MessageAttachment[] }) {
  const [attachment, setAttachment] = useState<MessageAttachment | null>(items[start]);
  return <MemoryRouter><AttachmentPreviewDialog open={attachment !== null} attachment={attachment}
    images={items} onAttachmentChange={setAttachment} onClose={() => setAttachment(null)} /></MemoryRouter>;
}

function pointer(stage: Element, type: string, x: number, y: number, options = {}) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, ...options });
  act(() => stage.dispatchEvent(event));
}

describe('attachment image gallery', () => {
  let root: Root;
  let container: HTMLDivElement;
  const status = () => document.querySelector('[role="status"]')?.textContent;
  const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:image'), revokeObjectURL: vi.fn() }));
    Element.prototype.setPointerCapture = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('starts at the clicked overflow tile and browses every image with arrows and keys', async () => {
    await act(async () => root.render(<Gallery />));
    expect(status()).toBe('9 / 25');
    act(() => button('Next image').click());
    expect(status()).toBe('10 / 25');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('image-9.png');
    act(() => button('Previous image').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(status()).toBe('9 / 25');
    act(() => button('Previous image').click());
    expect(status()).toBe('8 / 25');
  });

  it('swipes horizontally, ignores vertical/cancelled/multitouch gestures, and pans when zoomed', async () => {
    await act(async () => root.render(<Gallery />));
    const stage = () => document.querySelector('.touch-none')!;
    pointer(stage(), 'pointerdown', 200, 100);
    pointer(stage(), 'pointerup', 100, 105);
    expect(status()).toBe('10 / 25');
    pointer(stage(), 'pointerdown', 100, 100);
    pointer(stage(), 'pointerup', 200, 105);
    expect(status()).toBe('9 / 25');
    pointer(stage(), 'pointerdown', 200, 100);
    pointer(stage(), 'pointerup', 150, 250);
    pointer(stage(), 'pointerdown', 200, 100);
    pointer(stage(), 'pointercancel', 100, 100);
    pointer(stage(), 'pointerup', 100, 100);
    pointer(stage(), 'pointerdown', 200, 100);
    pointer(stage(), 'pointerdown', 190, 100, { pointerId: 2, isPrimary: false });
    pointer(stage(), 'pointerup', 100, 100);
    expect(status()).toBe('9 / 25');
    const zoomIn = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
    expect(zoomIn).not.toBeNull();
    act(() => zoomIn!.click());
    pointer(stage(), 'pointerdown', 200, 100);
    pointer(stage(), 'pointermove', 100, 100);
    pointer(stage(), 'pointerup', 100, 100);
    expect(status()).toBe('9 / 25');
    expect(stage().querySelector('img')?.style.transform).toContain('translate(-100px');
  });

  it('disables navigation at the ends and closes with Escape', async () => {
    await act(async () => root.render(<Gallery start={24} />));
    expect(button('Next image').disabled).toBe(true);
    act(() => button('Previous image').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(status()).toBe('25 / 25');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('matches recreated inline images and disables the previous button on the first image', async () => {
    const inlineImages = images.slice(0, 2).map(({ id: _id, ...image }) => image);
    await act(async () => root.render(<Gallery start={0} items={inlineImages} />));
    expect(button('Previous image').disabled).toBe(true);
    await act(async () => root.render(<Gallery start={0} items={inlineImages.map(image => ({ ...image }))} />));
    expect(status()).toBe('1 / 2');
    act(() => button('Next image').click());
    expect(status()).toBe('2 / 2');
  });

  it('keeps single images free of gallery controls', async () => {
    await act(async () => root.render(<Gallery start={0} items={[images[0]]} />));
    expect(document.querySelector('[aria-label="Next image"]')).toBeNull();
  });
});
