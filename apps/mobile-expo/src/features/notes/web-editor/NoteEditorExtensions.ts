import { mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

export const EMPTY_IMAGE_SRC = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%221%22%20height%3D%221%22/%3E';

export function isXopcAttachmentSrc(src: string): boolean {
  return src.startsWith('xopc-attachment://') || src.startsWith('xopc-local-attachment://');
}

export function createXopcImage(getDisplaySrc: (canonicalSrc: string) => string | undefined) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const canonicalSrc = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : '';
      const displaySrc = canonicalSrc ? getDisplaySrc(canonicalSrc) : undefined;
      const attrs = displaySrc
        ? { ...HTMLAttributes, src: displaySrc, 'data-xopc-src': canonicalSrc }
        : isXopcAttachmentSrc(canonicalSrc)
          ? { ...HTMLAttributes, src: EMPTY_IMAGE_SRC, 'data-xopc-src': canonicalSrc }
          : HTMLAttributes;
      return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
    },
  });
}
