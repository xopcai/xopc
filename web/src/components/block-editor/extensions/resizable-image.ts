import Image from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { ImageBlock } from '../image-block';

const ALT_WIDTH_SUFFIX_RE = /\|(\d{2,4})$/;

interface MarkdownSerializerState {
  write(content: string): void;
  esc(text: string): string;
  closeBlock(node: ProseMirrorNode): void;
}

export function splitImageAltAndWidth(rawAlt: string | null | undefined): { alt: string; width: number | null } {
  const value = rawAlt ?? '';
  const match = ALT_WIDTH_SUFFIX_RE.exec(value);
  if (!match) return { alt: value, width: null };
  const parsed = Number.parseInt(match[1], 10);
  return {
    alt: value.slice(0, match.index),
    width: Number.isFinite(parsed) && parsed >= 60 ? parsed : null,
  };
}

/**
 * Extends the default Tiptap Image extension with:
 * - A `width` attribute persisted losslessly in Markdown via `![alt|width](src)`
 * - A React NodeView with pointer-based drag-to-resize handle
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alt: {
        default: null,
        parseHTML: (element) => splitImageAltAndWidth(element.getAttribute('alt')).alt,
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const explicit = element.getAttribute('width') || element.style.width;
          if (explicit) {
            const parsed = Number.parseInt(explicit, 10);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
          }
          return splitImageAltAndWidth(element.getAttribute('alt')).width;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width, style: `width: ${attributes.width}px` };
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const { alt: cleanAlt } = splitImageAltAndWidth(String(node.attrs.alt ?? ''));
          const width = Number(node.attrs.width);
          const serializedAlt =
            Number.isFinite(width) && width >= 60 ? `${cleanAlt}|${Math.round(width)}` : cleanAlt;
          const src = String(node.attrs.src ?? '');
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : '';
          state.write(`![${state.esc(serializedAlt)}](${src}${title})`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
