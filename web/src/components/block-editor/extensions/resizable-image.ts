import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { ImageBlock } from '../image-block';

/**
 * Extends the default Tiptap Image extension with:
 * - A `width` attribute for persistent resize state
 * - A React NodeView with drag-to-resize handle
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width, style: `width: ${attributes.width}px` };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
